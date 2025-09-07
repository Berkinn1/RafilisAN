import React, { useState, useEffect, useRef } from 'react';
import { Upload, FolderOpen, Play, Square, Settings } from 'lucide-react';
import axios from 'axios';
import useMemoryMonitor from './hooks/useMemoryMonitor';
import { logger } from './utils/logger';
import rafilisLogo from './assets/icon.png';
import './App.css';

interface AudioFile {
  name: string;
  path: string;
  status: 'pending' | 'analyzing' | 'analyzed' | 'processing' | 'finalizing' | 'normalized' | 'completed' | 'stopped' | 'error';
  currentLUFS?: number;
  newLUFS?: number;
  progress?: number;
}

interface BackendStatus {
  status: string;
  isProcessing: boolean;
  progress: number;
  version: string;
  completedFiles?: number;
  normalizedSongs?: number;
  totalFiles?: number;
  currentFileIndex?: number;
  fileProgress?: number[];
  currentFiles?: any[];
}

interface LicenseInfo {
  status: string;
  license_key: string;
  trial_usage: number;
  max_trial_usage: number;
  remaining_trial_files: number;
  can_process_more: boolean;
  device_fingerprint: string;
  offline_grace_time: number;
}

const API_BASE = 'http://localhost:8080/api';

function App() {
  const [audioFiles, setAudioFiles] = useState<AudioFile[]>([]);
  const [outputFolder, setOutputFolder] = useState<string>('');
  const [targetLUFS, setTargetLUFS] = useState<number>(-12);
  const [lufsMode, setLufsMode] = useState<'preset' | 'custom'>('preset');
  const [customLUFS, setCustomLUFS] = useState<string>('');
  const [onlyAnalyze, setOnlyAnalyze] = useState<boolean>(false);
  const [includeSubfolders, setIncludeSubfolders] = useState<boolean>(false);
  const [backendStatus, setBackendStatus] = useState<BackendStatus | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [selectedFileIndex, setSelectedFileIndex] = useState<number | null>(null);
  const [shouldStopPolling, setShouldStopPolling] = useState<boolean>(false);
  const [licenseInfo, setLicenseInfo] = useState<LicenseInfo | null>(null);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [showTrialExpired, setShowTrialExpired] = useState<boolean>(false);
  // Enhanced progress tracking states
  const [completedFiles, setCompletedFiles] = useState<number>(0);
  const [totalFiles, setTotalFiles] = useState<number>(0);
  const [estimatedTimeRemaining, setEstimatedTimeRemaining] = useState<number | null>(null);
  const [defaultOutputFolder, setDefaultOutputFolder] = useState<string>('');
  
  // License activation states
  const [licenseKey, setLicenseKey] = useState<string>('');
  const [isActivating, setIsActivating] = useState<boolean>(false);
  const [activationError, setActivationError] = useState<string>('');
  const [lastActivationAttempt, setLastActivationAttempt] = useState<number>(0);
  const [activationAttempts, setActivationAttempts] = useState<number>(0);
  const [lockoutUntil, setLockoutUntil] = useState<number>(0);
  const [lockoutCountdown, setLockoutCountdown] = useState<number>(0);

  // License deactivation states
  const [showDeactivationModal, setShowDeactivationModal] = useState<boolean>(false);

  // Memory monitoring - ENABLE FOR FINAL TEST
  useMemoryMonitor();
  
  // Polling cleanup refs
  const pollingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const licenseIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Refs for IPC handlers to access current state
  const audioFilesRef = useRef<AudioFile[]>([]);
  const licenseInfoRef = useRef<any>(null);
  const remainingTrialFilesRef = useRef<number>(10);
  
  // Trial quota management states
  const [remainingTrialFiles, setRemainingTrialFiles] = useState<number>(10);
  const [maxSelectableFiles, setMaxSelectableFiles] = useState<number>(10);
  const [showUpgradeModal, setShowUpgradeModal] = useState<boolean>(false);

  // Load default output folder from localStorage on component mount
  useEffect(() => {
    const savedOutputFolder = localStorage.getItem('rafilisai-default-output-folder');
    if (savedOutputFolder) {
      setDefaultOutputFolder(savedOutputFolder);
      setOutputFolder(savedOutputFolder); // Set as current output folder
    }
  }, []);

  // Component unmount cleanup
  useEffect(() => {
    return () => {
      process.env.NODE_ENV === 'development' && console.log('🧹 App: Cleaning up on unmount');
      
      // Clear all polling timeouts
      if (pollingTimeoutRef.current) {
        clearTimeout(pollingTimeoutRef.current);
        pollingTimeoutRef.current = null;
      }
      
      // Stop all processing
      setIsProcessing(false);
      setBackendStatus(prev => prev ? {...prev, isProcessing: false} : null);
      
      process.env.NODE_ENV === 'development' && console.log('🧹 App: Cleanup completed');
    };
  }, []);


  // Function to send output folder to backend
  const updateOutputFolder = async (folderPath: string) => {
    try {
      const response = await axios.post(`${API_BASE}/output-folder`, {
        path: folderPath
      });
      
      if (response.data.success) {
        process.env.NODE_ENV === 'development' && console.log('✅ Output folder updated:', response.data.outputFolder);
      }
    } catch (error) {
      console.error('❌ Failed to update output folder:', error);
    }
  };

  // Function to fetch license information
  const fetchLicenseInfo = async () => {
    try {
      const response = await axios.get(`${API_BASE}/license/status`);
      if (response.data.success) {
        const license = response.data.license;
        setLicenseInfo(license);
        process.env.NODE_ENV === 'development' && console.log('📄 License info updated:', license);
        
        // Update quota states based on license info
        if (license.status && license.status.startsWith('Trial')) {
          const remaining = license.remaining_trial_files || 0;
          setRemainingTrialFiles(remaining);
          setMaxSelectableFiles(remaining);
          process.env.NODE_ENV === 'development' && console.log(`📊 Trial quota updated: ${remaining} files remaining`);
        } else {
          // Pro license or other - unlimited
          setRemainingTrialFiles(999);
          setMaxSelectableFiles(999);
          process.env.NODE_ENV === 'development' && console.log(`🚀 Pro license: Unlimited file selection`);
        }
        
        // Check if trial has expired and show modal
        if (license.status === 'Trial Expired' && license.remaining_trial_files <= 0) {
          setShowTrialExpired(true);
        }
      }
    } catch (error) {
      console.error('❌ Failed to fetch license info:', error);
      setLicenseInfo(null);
    }
  };

  // Check backend status on component mount
  useEffect(() => {
    checkBackendStatus();
    fetchLicenseInfo();
    const interval = setInterval(checkBackendStatus, 2000);
    
    // License validation frequency based on license type
    const getLicenseCheckInterval = async () => {
      try {
        const response = await axios.get(`${API_BASE}/license/status`);
        if (response.data.success && response.data.license) {
          const isProLicense = response.data.license.status === 'Pro' || 
                              response.data.license.status === 'Pro (Offline)';
          
          if (isProLicense) {
            return 30000; // Pro: Every 30 seconds (less frequent)
          } else {
            return 5000;  // Trial: Every 5 seconds (strict monitoring)
          }
        }
        return 5000; // Default: Trial frequency
      } catch (error) {
        return 5000; // Error durumunda Trial frequency
      }
    };
    
    // Set initial interval with proper cleanup reference
    getLicenseCheckInterval().then(intervalTime => {
      // Clear any existing interval
      if (licenseIntervalRef.current) {
        clearInterval(licenseIntervalRef.current);
      }
      
      licenseIntervalRef.current = setInterval(fetchLicenseInfo, intervalTime);
      process.env.NODE_ENV === 'development' && console.log(`📄 License check interval set to: ${intervalTime}ms`);
    });
    
    // Electron file handling
    if (window.require) {
      const { ipcRenderer } = window.require('electron');
      
      // Remove any existing listeners to prevent duplicates
      ipcRenderer.removeAllListeners('files-selected');
      ipcRenderer.removeAllListeners('output-folder-selected');
      ipcRenderer.removeAllListeners('file-dropped');
      
      // Handle files selected from menu
      ipcRenderer.on('files-selected', (event: any, filePaths: string[]) => {
        process.env.NODE_ENV === 'development' && console.log('🚨 FILES-SELECTED IPC CALLED WITH:', filePaths.length, 'files');
        process.env.NODE_ENV === 'development' && console.log('🔍 DEBUG - Current licenseInfo:', licenseInfoRef.current);
        process.env.NODE_ENV === 'development' && console.log('🔍 DEBUG - audioFiles.length:', audioFilesRef.current.length);
        process.env.NODE_ENV === 'development' && console.log('🔍 DEBUG - remainingTrialFiles:', remainingTrialFilesRef.current);
        
        // Apply trial quota limiting
        let finalFilePaths = filePaths;
        if (licenseInfoRef.current && licenseInfoRef.current.status && licenseInfoRef.current.status.startsWith('Trial')) {
          const currentCount = audioFilesRef.current.length;
          const availableSlots = Math.max(0, remainingTrialFilesRef.current - currentCount);
          
          if (filePaths.length > availableSlots) {
            finalFilePaths = filePaths.slice(0, availableSlots);
            
            // Show trial limit warning
            if (availableSlots > 0) {
              alert(`⚠️ Trial License Limit\n\nYou tried to add ${filePaths.length} files, but you have ${availableSlots} slots remaining in your trial.\n\n✅ Added first ${finalFilePaths.length} files for processing.\n\n🚀 Upgrade to Pro for unlimited file processing!`);
            } else {
              alert(`🔒 Trial Quota Exhausted\n\nYou have used all ${remainingTrialFilesRef.current} files in your trial.\n\n🚀 Upgrade to Pro for unlimited file processing!`);
              setShowUpgradeModal(true);
              return;
            }
          }
        }
        
        const newFiles: AudioFile[] = finalFilePaths.map(filePath => ({
          name: filePath.split('/').pop() || filePath,
          path: filePath, // Already absolute path from Electron dialog
          status: 'pending'
        }));
        setAudioFiles(prev => [...prev, ...newFiles]);
      });
      
      // Handle output folder selected from menu  
      ipcRenderer.on('output-folder-selected', (event: any, folderPath: string) => {
        process.env.NODE_ENV === 'development' && console.log('📁 Output folder selected via IPC:', folderPath);
        setOutputFolder(folderPath);
        updateOutputFolder(folderPath); // Send to backend
      });
      
      // Handle default output folder selected from settings
      ipcRenderer.on('default-output-folder-selected', (event: any, folderPath: string) => {
        process.env.NODE_ENV === 'development' && console.log('📁 Default output folder selected via IPC:', folderPath);
        setDefaultOutputFolder(folderPath);
        localStorage.setItem('rafilisai-default-output-folder', folderPath);
      });
      
      // Handle dropped files (keep for compatibility)
      ipcRenderer.on('file-dropped', (event: any, filePath: string) => {
        process.env.NODE_ENV === 'development' && console.log('📁 File dropped via IPC:', filePath);
        
        // Apply trial quota limiting
        if (licenseInfoRef.current && licenseInfoRef.current.status && licenseInfoRef.current.status.startsWith('Trial')) {
          const currentCount = audioFilesRef.current.length;
          const availableSlots = Math.max(0, remainingTrialFilesRef.current - currentCount);
          
          if (availableSlots <= 0) {
            alert(`🔒 Trial Quota Exhausted\n\nYou have used all ${remainingTrialFilesRef.current} files in your trial.\n\n🚀 Upgrade to Pro for unlimited file processing!`);
            setShowUpgradeModal(true);
            return;
          }
        }
        
        const newFile: AudioFile = {
          name: filePath.split('/').pop() || filePath,
          path: filePath,
          status: 'pending'
        };
        setAudioFiles(prev => [...prev, newFile]);
      });
    }
    
    return () => {
      clearInterval(interval);
      // Clean up license interval
      if (licenseIntervalRef.current) {
        clearInterval(licenseIntervalRef.current);
        licenseIntervalRef.current = null;
      }
      // Cleanup IPC listeners
      if (window.require) {
        const { ipcRenderer } = window.require('electron');
        ipcRenderer.removeAllListeners('files-selected');
        ipcRenderer.removeAllListeners('output-folder-selected');
        ipcRenderer.removeAllListeners('default-output-folder-selected');
        ipcRenderer.removeAllListeners('file-dropped');
      }
    };
  }, []); // FIXED: Remove problematic dependencies to prevent infinite re-runs

  // Keep refs updated
  useEffect(() => {
    audioFilesRef.current = audioFiles;
  }, [audioFiles]);
  
  useEffect(() => {
    licenseInfoRef.current = licenseInfo;
  }, [licenseInfo]);
  
  useEffect(() => {
    remainingTrialFilesRef.current = remainingTrialFiles;
  }, [remainingTrialFiles]);

  // DEBUG: Track audioFiles changes
  useEffect(() => {
    process.env.NODE_ENV === 'development' && console.log('🔍 DEBUG - audioFiles changed:', audioFiles.length, audioFiles.map(f => f.name));
  }, [audioFiles]);

  // Countdown timer for lockout period
  useEffect(() => {
    if (lockoutUntil > 0) {
      const timer = setInterval(() => {
        const now = Date.now();
        const remaining = Math.max(0, Math.ceil((lockoutUntil - now) / 1000));
        setLockoutCountdown(remaining);
        
        if (remaining === 0) {
          setLockoutUntil(0);
          setActivationAttempts(0);
          setActivationError('');
        }
      }, 1000);
      
      return () => clearInterval(timer);
    }
  }, [lockoutUntil]);

  const checkBackendStatus = async () => {
    try {
      const response = await axios.get(`${API_BASE}/status`);
      setBackendStatus(response.data);
      setIsProcessing(response.data.isProcessing);
    } catch (error) {
      console.error('Backend not connected:', error);
      setBackendStatus(null);
    }
  };

  // Remove drag & drop - use only native Electron dialog
  // const onDrop = () => {}; - Disabled
  // const { getRootProps, getInputProps, isDragActive } = useDropzone() - Disabled

  const selectFiles = async () => {
    // Electron integration for file selection
    if (window.require) {
      const { ipcRenderer } = window.require('electron');
      
      // Send message to main process to open file dialog
      ipcRenderer.send('request-files-selection');
      process.env.NODE_ENV === 'development' && console.log('🎵 Requesting audio files selection...');
    } else {
      // Web version fallback
      process.env.NODE_ENV === 'development' && console.log('Select files - Web version not supported');
      alert('Please use the desktop version to select files');
    }
  };


  const selectOutputFolder = async () => {
    // Electron integration for file dialogs
    if (window.require) {
      const { ipcRenderer } = window.require('electron');
      
      // Send message to main process to open folder dialog
      ipcRenderer.send('request-output-folder-selection');
      process.env.NODE_ENV === 'development' && console.log('📁 Requesting output folder selection...');
    } else {
      // Web version fallback - could implement HTML5 file API
      process.env.NODE_ENV === 'development' && console.log('Select output folder - Web version');
    }
  };

  const selectDefaultOutputFolder = () => {
    if (window.require) {
      const { ipcRenderer } = window.require('electron');
      
      // Send message to main process to open folder dialog for default folder
      ipcRenderer.send('request-default-output-folder-selection');
      process.env.NODE_ENV === 'development' && console.log('📁 Requesting default output folder selection...');
    } else {
      alert('❌ Folder selection requires Electron');
    }
  };

  const stopProcessing = async () => {
    try {
      process.env.NODE_ENV === 'development' && console.log('🛑 Stop processing requested');
      
      // Stop polling immediately - force stop
      setShouldStopPolling(true);
      setIsProcessing(false);
      
      // Call backend stop API
      const response = await axios.post(`${API_BASE}/stop`);
      
      if (response.data.success) {
        process.env.NODE_ENV === 'development' && console.log('⏹️ Processing stopped successfully');
      } else {
        process.env.NODE_ENV === 'development' && console.log('⚠️ Backend stop response:', response.data);
      }
      
      // Force update file statuses immediately regardless of backend response
      setAudioFiles(prev => prev.map(file => {
        // Keep completed and normalized files as-is, others become stopped
        if (file.status === 'completed' || file.status === 'normalized') {
          return file;
        } else {
          return {
            ...file,
            status: 'stopped' as const,
            progress: 0,
            // Keep existing LUFS data if available
            currentLUFS: file.currentLUFS,
            newLUFS: undefined
          };
        }
      }));
      
    } catch (error) {
      console.error('❌ Failed to stop processing:', error);
      // Force stop even if backend call fails
      setShouldStopPolling(true);
      setIsProcessing(false);
    }
  };

  const startProcessing = async () => {
    if (audioFiles.length === 0) {
      alert('Please add audio files first');
      return;
    }

    try {
      // Reset polling flag and start processing
      process.env.NODE_ENV === 'development' && console.log('🚀 Starting processing - resetting stop flag');
      setShouldStopPolling(false);
      setIsProcessing(true);
      
      // Reset all files to pending
      
      setAudioFiles(prev => prev.map(file => ({
        ...file,
        status: 'pending' as const,
        progress: 0,
        currentLUFS: undefined,
        newLUFS: undefined
      })));

      process.env.NODE_ENV === 'development' && console.log('🚀 Debug - Starting processing with files:', audioFiles);
      process.env.NODE_ENV === 'development' && console.log('🚀 Debug - Each file path:', audioFiles.map(f => ({ name: f.name, path: f.path })));
      
      const response = await axios.post(`${API_BASE}/process`, {
        files: audioFiles,
        targetLUFS,
        onlyAnalyze,
        includeSubfolders,
        outputFolder
      });
      
      process.env.NODE_ENV === 'development' && console.log('Processing started:', response.data);
      
      // Start polling for individual file updates
      const pollForUpdates = async () => {
        try {
          
          const statusResponse = await axios.get(`${API_BASE}/progress`);
          const data = statusResponse.data;
          process.env.NODE_ENV === 'development' && console.log('📡 Status polling response:', data);
          
          // Check if processing completed
          if (!data.isProcessing) {
            setIsProcessing(false);
            
            // Use processed files data if available
            if (data.processedFiles && data.processedFiles.length > 0) {
              setAudioFiles(prev => prev.map((file, index) => {
                const processedFile = data.processedFiles.find((pf: any) => pf.name === file.name);
                return {
                  ...file,
                  status: 'completed' as const,
                  progress: 1,
                  currentLUFS: processedFile?.currentLUFS || file.currentLUFS || 0,
                  newLUFS: targetLUFS
                };
              }));
            } else {
              // Fallback: mark all files as completed with existing LUFS values
              setAudioFiles(prev => prev.map(file => ({
                ...file,
                status: 'completed' as const,
                progress: 1,
                currentLUFS: file.currentLUFS || 0,
                newLUFS: targetLUFS
              })));
            }
            return;
          }
          
          // Update file status with real-time progress data (NEW ENHANCED SYSTEM)
          if (data.isProcessing) {
            const fileProgressArray = data.fileProgress || [];
            const fileStatuses = data.fileStatuses || {};  // NEW: Individual file statuses
            const currentFiles = data.currentFiles || [];
            
            // Update enhanced progress states
            setCompletedFiles(data.completedFiles || 0);
            setTotalFiles(data.totalFiles || 0);
            setEstimatedTimeRemaining(data.estimatedTimeRemaining || null);
            
            // Log enhanced progress data
            if (data.estimatedTimeRemaining) {
              process.env.NODE_ENV === 'development' && console.log(`⏰ ETA: ${Math.round(data.estimatedTimeRemaining)}s, Completed: ${data.completedFiles}/${data.totalFiles}`);
            }
            
            setAudioFiles(prev => prev.map((file, index) => {
              const fileProgress = fileProgressArray[index] || 0;
              const fileStatus = fileStatuses[index.toString()] || 'pending';  // NEW: Get individual status
              const currentFileData = currentFiles[index];
              const realCurrentLUFS = currentFileData?.currentLUFS || file.currentLUFS;
              
              // Use direct status from backend (NEW REAL-TIME SYSTEM)
              let mappedStatus: 'pending' | 'analyzing' | 'analyzed' | 'processing' | 'finalizing' | 'normalized' | 'completed' | 'stopped' | 'error';
              
              switch (fileStatus) {
                case 'Analyzing':
                  mappedStatus = 'analyzing';
                  break;
                case 'Normalizing':
                  // Determine sub-status based on progress
                  if (fileProgress >= 0.95) {
                    mappedStatus = 'finalizing';
                  } else {
                    mappedStatus = 'processing';
                  }
                  break;
                case 'completed':
                  mappedStatus = 'completed';
                  break;
                case 'error':
                  mappedStatus = 'error';
                  break;
                default:
                  // Smart status detection based on available data
                  if (realCurrentLUFS && realCurrentLUFS !== 0) {
                    // If we have currentLUFS, file has been analyzed
                    if (fileProgress >= 1.0 && !data.isProcessing) {
                      // Individual file completed normalization but overall process continues
                      mappedStatus = 'normalized';
                    } else if (fileStatus === 'Normalizing' || fileProgress > 0.5) {
                      // In normalization phase
                      mappedStatus = fileProgress >= 0.95 ? 'finalizing' : 'processing';
                    } else {
                      // Just analyzed
                      mappedStatus = 'analyzed';
                    }
                  } else {
                    mappedStatus = fileProgress > 0 ? 'analyzing' : 'pending';
                  }
              }
              
              return {
                ...file,
                status: mappedStatus,
                progress: fileProgress,
                currentLUFS: realCurrentLUFS,
                newLUFS: (mappedStatus === 'finalizing' || mappedStatus === 'normalized' || mappedStatus === 'completed') ? targetLUFS : file.newLUFS
              };
            }));
          }
          
          // Continue polling if still processing
          if (data.isProcessing) {
            // Clear any existing timeout before setting new one
            if (pollingTimeoutRef.current) {
              clearTimeout(pollingTimeoutRef.current);
            }
            pollingTimeoutRef.current = setTimeout(pollForUpdates, 250); // 250ms for smooth progress updates
          }
        } catch (error) {
          console.error('Failed to poll status:', error);
          // Retry with shorter interval on error if still processing
          if (pollingTimeoutRef.current) {
            clearTimeout(pollingTimeoutRef.current);
          }
          pollingTimeoutRef.current = setTimeout(pollForUpdates, 1000); // 1 second retry on error
        }
      };
      
      pollForUpdates();
      
    } catch (error) {
      console.error('Failed to start processing:', error);
      setIsProcessing(false);
    }
  };

  const clearFiles = () => {
    setAudioFiles([]);
  };

  // LUFS validation functions
  const validateLUFS = (value: string): boolean => {
    const num = parseFloat(value);
    return !isNaN(num) && num >= -70 && num <= 0;
  };

  const handleLUFSChange = (value: string) => {
    if (value === 'custom') {
      setLufsMode('custom');
      setCustomLUFS('');
    } else {
      setLufsMode('preset');
      setTargetLUFS(parseFloat(value));
    }
  };

  const handleCustomLUFSChange = (value: string) => {
    setCustomLUFS(value);
    if (validateLUFS(value)) {
      setTargetLUFS(parseFloat(value));
    }
  };

  // License validation functions
  const isValidLicenseKeyFormat = (key: string): boolean => {
    // Must start with RAFILIS- and be at least 20 characters long
    process.env.NODE_ENV === 'development' && console.log('🔍 License key validation:', {
      key: `"${key}"`,
      trimmed: `"${key.trim()}"`,
      length: key.length,
      startsWithRafilis: key.startsWith('RAFILIS-'),
      isValid: key.startsWith('RAFILIS-') && key.length >= 20
    });
    return key.startsWith('RAFILIS-') && key.length >= 20;
  };


  const canAttemptActivation = (): boolean => {
    const now = Date.now();
    
    // Check if we're still in lockout period
    if (now < lockoutUntil) {
      return false;
    }
    
    // Reset attempt counter if lockout period is over
    if (now >= lockoutUntil && activationAttempts >= 3) {
      setActivationAttempts(0);
      setLockoutUntil(0);
    }
    
    return true;
  };

  const activateLicense = async () => {
    // Clear previous errors
    setActivationError('');

    // Validate input
    if (!licenseKey.trim()) {
      setActivationError('Please enter a license key');
      return;
    }

    if (!isValidLicenseKeyFormat(licenseKey)) {
      setActivationError('Please enter a valid license key.');
      return;
    }

    if (!canAttemptActivation()) {
      setActivationError(`Too many attempts. Please wait ${lockoutCountdown} seconds before trying again`);
      return;
    }

    setIsActivating(true);
    setLastActivationAttempt(Date.now());

    try {
      const response = await axios.post(`${API_BASE}/license/activate`, {
        licenseKey: licenseKey.trim()
      });

      if (response.data.success) {
        // Success - reset counters, clear license key, close modal
        setActivationAttempts(0);
        setLockoutUntil(0);
        setLicenseKey('');
        setActivationError('');
        
        // Show success message
        alert('✅ License activated successfully! Welcome to Pro!');
        
        // Immediately refresh license info
        await fetchLicenseInfo();
        
        // Close both modals
        setShowSettings(false);
        setShowTrialExpired(false);
      } else {
        // Failed activation - increment attempt counter
        const newAttempts = activationAttempts + 1;
        setActivationAttempts(newAttempts);
        
        if (newAttempts >= 3) {
          // Lock out for 1 minute after 3 failed attempts
          const lockoutTime = Date.now() + (60 * 1000); // 60 seconds
          setLockoutUntil(lockoutTime);
          setActivationError('Too many failed attempts. Please wait 1 minute before trying again');
        } else {
          setActivationError(response.data.error || 'Activation failed');
        }
      }
    } catch (error) {
      console.error('License activation error:', error);
      
      // Failed activation - increment attempt counter
      const newAttempts = activationAttempts + 1;
      setActivationAttempts(newAttempts);
      
      let errorMessage = '';
      if (axios.isAxiosError(error)) {
        if (error.code === 'NETWORK_ERROR') {
          errorMessage = 'Network error. Please check your connection';
        } else if (error.response?.status === 400) {
          errorMessage = 'Invalid license key';
        } else {
          errorMessage = 'Server error. Please try again later';
        }
      } else {
        errorMessage = 'Activation failed. Please try again';
      }
      
      if (newAttempts >= 3) {
        // Lock out for 1 minute after 3 failed attempts
        const lockoutTime = Date.now() + (60 * 1000); // 60 seconds
        setLockoutUntil(lockoutTime);
        setActivationError('Too many failed attempts. Please wait 1 minute before trying again');
      } else {
        setActivationError(errorMessage);
      }
    } finally {
      setIsActivating(false);
    }
  };

  // License deactivation function
  const deactivateLicense = async () => {
    setIsActivating(true);
    setActivationError('');

    try {
      const response = await axios.post(`${API_BASE}/license/deactivate`, {});

      if (response.data.success) {
        // Success - refresh license info and close modal
        alert('✅ License deactivated successfully! You can now activate it on another device.');
        
        // Immediately refresh license info
        await fetchLicenseInfo();
        
        // Close modal
        setShowDeactivationModal(false);
      } else {
        setActivationError(response.data.error || 'Deactivation failed');
      }
    } catch (error) {
      console.error('License deactivation error:', error);
      
      let errorMessage = '';
      if (axios.isAxiosError(error)) {
        if (error.code === 'NETWORK_ERROR') {
          errorMessage = 'Network error. Please check your connection';
        } else if (error.response?.status === 400) {
          errorMessage = 'Deactivation request invalid';
        } else {
          errorMessage = 'Server error. Please try again later';
        }
      } else {
        errorMessage = 'Deactivation failed. Please try again';
      }
      
      setActivationError(errorMessage);
    } finally {
      setIsActivating(false);
    }
  };

  // Generate consistent waveform data based on file name
  const generateWaveformData = (fileName: string, seed: number = 0) => {
    const hash = fileName.split('').reduce((a, b) => {
      a = ((a << 5) - a) + b.charCodeAt(0);
      return a & a;
    }, seed);
    
    // Use hash as seed for consistent random generation
    let seedValue = Math.abs(hash);
    const random = () => {
      seedValue = (seedValue * 9301 + 49297) % 233280;
      return seedValue / 233280;
    };
    
    return Array.from({length: 120}, (_, i) => {
      return Math.sin(i * 0.08 + hash * 0.001) * random() * 0.8 + 0.2;
    });
  };

  return (
    <div className="App">
      {/* Header */}
      <header className="app-header" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <div className="header-content">
          <div className="brand-section">
            <div className="brand-icon">
              <img src={rafilisLogo} alt="Rafilis Logo" width="32" height="32" />
            </div>
            <div className="brand-text">
              <h1 className="brand-title">Rafilis AN</h1>
              <p className="brand-subtitle">Audio Normalizer</p>
            </div>
          </div>
          <div className="header-status">
            <div className="license-status">
              {licenseInfo && (
                <>
                  <span className={`license-badge ${licenseInfo.status.toLowerCase().includes('trial') ? 'trial' : 'pro'}`}>
                    {licenseInfo.status === 'Pro' && '💎 '}
                    {licenseInfo.status === 'Pro (Offline)' && '💎 '}
                    {licenseInfo.status}
                    {licenseInfo.status === 'Pro' && ' License'}
                    {licenseInfo.status === 'Pro (Offline)' && ' License'}
                  </span>
                  
                  {/* Trial Quota Display */}
                  {licenseInfo.status && licenseInfo.status.startsWith('Trial') && (
                    <div className="trial-quota">
                      <div className="quota-text">
                        Files: {10 - remainingTrialFiles}/10
                      </div>
                      <div className="quota-bar">
                        <div 
                          className="quota-fill" 
                          style={{width: `${((10 - remainingTrialFiles)/10)*100}%`}}
                        ></div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
            <div className={`status-indicator ${backendStatus ? 'connected' : 'disconnected'}`}>
              <div className="status-dot"></div>
            </div>
            <button 
              className="settings-button"
              onClick={() => {
                setShowSettings(true);
                setActivationError('');
              }}
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              <Settings size={16} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="main-content">
        {/* Controls Section */}
        <div className="controls-section">
          <div className="controls-row-top">
            <div className="control-group">
              <button 
                className="control-btn primary"
                onClick={selectFiles}
              >
                <Upload size={20} />
                Add Files
              </button>
              
              <button 
                className="control-btn secondary"
                onClick={selectOutputFolder}
                title={outputFolder || 'Select output folder'}
              >
                <FolderOpen size={20} />
                {outputFolder ? 'Output Set' : 'Output Folder'}
              </button>
            </div>

            <div className="settings-group">
              <div className="setting-item vertical">
                <label htmlFor="targetLUFS" className="setting-label">Target LUFS:</label>
                <div className="lufs-selector">
                  <select
                    id="targetLUFS"
                    value={lufsMode === 'preset' ? targetLUFS.toString() : 'custom'}
                    onChange={(e) => handleLUFSChange(e.target.value)}
                    className="lufs-select"
                    disabled={isProcessing}
                  >
                    <option value={-12}>Spotify (-12 LUFS)</option>
                    <option value={-16}>Apple Music (-16 LUFS)</option>
                    <option value={-14}>YouTube (-14 LUFS)</option>
                    <option value={-18}>Amazon Music (-18 LUFS)</option>
                    <option value={-23}>Broadcast (-23 LUFS)</option>
                    <option value={-13}>SoundCloud (-13 LUFS)</option>
                    <option value={-15}>Deezer (-15 LUFS)</option>
                    <option value={-20}>Podcast (-20 LUFS)</option>
                    <option value={-10}>Club/DJ (-10 LUFS)</option>
                    <option value="custom">Custom...</option>
                  </select>
                  
                  {lufsMode === 'custom' && (
                    <input
                      type="number"
                      step="0.1"
                      min="-70"
                      max="0"
                      placeholder="Enter LUFS (-70 to 0)"
                      value={customLUFS}
                      onChange={(e) => handleCustomLUFSChange(e.target.value)}
                      className={`lufs-custom-input ${validateLUFS(customLUFS) ? '' : 'invalid'}`}
                      disabled={isProcessing}
                    />
                  )}
                </div>
              </div>
            </div>

            <div className="action-group">
              <button 
                className={`control-btn ${isProcessing ? 'danger' : 'success'}`}
                onClick={isProcessing ? stopProcessing : startProcessing}
                disabled={!isProcessing && audioFiles.length === 0}
              >
                {isProcessing ? <Square size={20} /> : <Play size={20} />}
                {isProcessing ? 'Stop' : 'Start'}
              </button>

              <button 
                className="control-btn danger"
                onClick={clearFiles}
                disabled={isProcessing}
              >
                Clear
              </button>
            </div>
          </div>

          <div className="controls-row-bottom">
            <div className="toggle-section">
              <div className="toggle-group">
                <div className="toggle-item">
                  <label className="toggle-label compact">
                    <input
                      type="checkbox"
                      checked={onlyAnalyze}
                      onChange={(e) => setOnlyAnalyze(e.target.checked)}
                      className="toggle-input"
                    />
                    <span className="toggle-slider small"></span>
                    <span className="toggle-text">Only Analyze</span>
                  </label>
                </div>
                
                <div className="toggle-item">
                  <label className="toggle-label compact">
                    <input
                      type="checkbox"
                      checked={includeSubfolders}
                      onChange={(e) => setIncludeSubfolders(e.target.checked)}
                      className="toggle-input"
                    />
                    <span className="toggle-slider small"></span>
                    <span className="toggle-text">Include Subfolders</span>
                  </label>
                </div>
              </div>
            </div>
            <div className="spacer"></div>
            <div className="spacer"></div>
          </div>
        </div>

        {/* Stats Section */}
        <div className="stats-section">
          <div className="stat-card">
            <div className="stat-number">{audioFiles.length}</div>
            <div className="stat-label">Total Songs</div>
          </div>
          
          <div className="stat-card">
            <div className="stat-number">{audioFiles.filter(f => f.status === 'analyzed' || f.status === 'processing' || f.status === 'finalizing' || f.status === 'normalized' || f.status === 'completed').length}</div>
            <div className="stat-label">Analyzed Songs</div>
          </div>
          
          <div className="stat-card">
            <div className="stat-number">{!onlyAnalyze ? (backendStatus?.normalizedSongs || 0) : 0}</div>
            <div className="stat-label">Normalized Songs</div>
          </div>
        </div>


        {/* File List */}
        <div className="file-list-container">
          <div className="file-list">
            <div className="file-list-header">
              <span>Name</span>
              <span>Status</span>
              <span>Current LUFS</span>
              <span>Target</span>
            </div>
            
            <div className="file-list-content">
              {audioFiles.length === 0 ? (
                <div className="empty-state">
                  <Upload size={32} className="empty-icon" />
                  <p>No files added yet. Use "Add Files" button above.</p>
                </div>
              ) : (
                audioFiles.map((file, index) => (
                  <div 
                    key={index} 
                    className={`file-item ${file.status} ${selectedFileIndex === index ? 'selected' : ''}`}
                    onClick={() => setSelectedFileIndex(index)}
                  >
                    <span className="file-name" title={file.name}>{file.name}</span>
                    <span className="file-status">
                      <div className={`status-badge ${file.status}`}>
                        {file.status}
                      </div>
                    </span>
                    <span className="file-lufs">
                      {file.currentLUFS ? `${file.currentLUFS.toFixed(1)}` : '--'}
                    </span>
                    <span className="file-target">
                      {targetLUFS.toFixed(1)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Dual Waveform Visualization */}
        <div className="waveform-section">
          <div className="waveform-container">
            <div className="waveform-panel">
              <h4 className="waveform-title">Current</h4>
              <div className="soundcloud-waveform">
                <div className="waveform-container-sc">
                  {(() => {
                    const selectedFile = selectedFileIndex !== null ? audioFiles[selectedFileIndex] : null;
                    const fileName = selectedFile?.name || 'default';
                    const currentLUFS = selectedFile?.currentLUFS || -20;
                    const waveformData = generateWaveformData(fileName, 1);
                    
                    // Apply LUFS scaling to the consistent waveform
                    const lufsMultiplier = Math.abs(currentLUFS) / 25; // Convert LUFS to amplitude multiplier
                    
                    return waveformData.map((amplitude, i) => (
                      <div 
                        key={i}
                        className="wave-peak current"
                        style={{
                          height: `${Math.min(amplitude * lufsMultiplier * 100, 95)}%`,
                          animationDelay: `${i * 0.02}s`
                        }}
                      ></div>
                    ));
                  })()}
                </div>
              </div>
            </div>
            
            <div className="waveform-panel">
              <h4 className="waveform-title">Normalized</h4>
              <div className="soundcloud-waveform">
                <div className="waveform-container-sc">
                  {(() => {
                    const selectedFile = selectedFileIndex !== null ? audioFiles[selectedFileIndex] : null;
                    const fileName = selectedFile?.name || 'default';
                    const waveformData = generateWaveformData(fileName, 2); // Different seed for normalized
                    
                    // Apply target LUFS scaling - more consistent for normalized audio
                    const targetMultiplier = Math.abs(targetLUFS) / 25;
                    
                    return waveformData.map((amplitude, i) => (
                      <div 
                        key={i}
                        className="wave-peak target"
                        style={{
                          height: `${Math.min((amplitude * 0.7 + 0.3) * targetMultiplier * 100, 85)}%`,
                          animationDelay: `${i * 0.025}s`
                        }}
                      ></div>
                    ));
                  })()}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div className="modal-overlay" onClick={() => {
          setShowSettings(false);
          setActivationError('');
        }}>
          <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Settings</h2>
              <button 
                className="modal-close-button"
                onClick={() => {
                  setShowSettings(false);
                  setActivationError('');
                }}
              >
                ✕
              </button>
            </div>
            
            <div className="modal-content">
              <div className="settings-tabs">

                {/* License Tab */}
                <div className="settings-section">
                  <h3>🔑 License</h3>
                  <div className="setting-item">
                    <label>Status</label>
                    <span className="license-status-text">
                      {licenseInfo?.status || 'Loading...'}
                    </span>
                  </div>
                  
                  {licenseInfo?.status?.toLowerCase().includes('trial') && (
                    <div className="setting-item">
                      <label>Remaining Files</label>
                      <span className="trial-remaining">
                        {licenseInfo?.remaining_trial_files || 0} files left
                      </span>
                    </div>
                  )}

                  <div className="setting-item">
                    <label>License Management</label>
                    
                    {/* Pro License - Show deactivation option */}
                    {licenseInfo?.status?.toLowerCase().includes('pro') ? (
                      <>
                        <div className="license-input-group">
                          <input 
                            type="text" 
                            value={licenseInfo.license_key || ''}
                            className="license-input readonly"
                            disabled={true}
                            readOnly
                          />
                          <button 
                            className="deactivate-button"
                            onClick={() => setShowDeactivationModal(true)}
                            disabled={isActivating}
                          >
                            {isActivating ? 'Deactivating...' : 'Deactivate This Device'}
                          </button>
                        </div>
                      </>
                    ) : (
                      /* Trial - Show activation option */
                      <>
                        <div className="license-input-group">
                          <input 
                            type="text" 
                            placeholder="Enter license key..."
                            className={`license-input ${activationError ? 'error' : ''}`}
                            value={licenseKey}
                            onChange={(e) => {
                              setLicenseKey(e.target.value);
                              setActivationError(''); // Clear error on input change
                            }}
                            disabled={isActivating}
                            maxLength={50}
                          />
                          <button 
                            className="activate-button"
                            onClick={activateLicense}
                            disabled={isActivating || !licenseKey.trim() || !canAttemptActivation()}
                          >
                            {isActivating ? 'Activating...' : 'Activate'}
                          </button>
                        </div>
                        
                        {/* Error message directly under input group */}
                        {activationError && (
                          <div className="activation-error" style={{marginTop: '10px', textAlign: 'center', width: '100%'}}>
                            {activationError}
                          </div>
                        )}
                        
                        {activationAttempts > 0 && activationAttempts < 3 && !lockoutUntil && (
                          <div className="activation-attempts">
                            {3 - activationAttempts} attempts remaining
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* Output Folder Tab */}
                <div className="settings-section">
                  <h3>📁 Default Output Folder</h3>
                  <div className="setting-item">
                    <label>Default Folder</label>
                    <div className="folder-display">
                      {defaultOutputFolder || 'Not selected'}
                    </div>
                  </div>
                  <div className="setting-item">
                    <button 
                      className="folder-button"
                      onClick={selectDefaultOutputFolder}
                    >
                      Choose Default Folder
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Trial Expired Modal */}
      {showTrialExpired && !showSettings && (
        <div className="modal-overlay">
          <div className="trial-expired-modal">
            <div className="modal-header">
              <button 
                className="modal-close-button"
                onClick={() => setShowTrialExpired(false)}
                title="Close"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
              <div className="trial-expired-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="m15 9-6 6"/>
                  <path d="m9 9 6 6"/>
                </svg>
              </div>
              <h2>Trial Period Expired</h2>
              <p>You have used your 10-file limit</p>
            </div>
            <div className="modal-content">
              <div className="pro-features-highlight">
                <h3>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="12,2 15.09,8.26 22,9 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9 8.91,8.26"/>
                  </svg>
                  Pro Features
                </h3>
                <div className="features-grid">
                  <div className="feature-item">
                    <div className="feature-icon unlimited">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
                      </svg>
                    </div>
                    <div className="feature-text">
                      <h4>Unlimited File Processing</h4>
                      <p>Normalize unlimited audio files</p>
                    </div>
                  </div>
                  <div className="feature-item">
                    <div className="feature-icon batch">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14,2 14,8 20,8"/>
                        <line x1="16" y1="13" x2="8" y2="13"/>
                        <line x1="16" y1="17" x2="8" y2="17"/>
                        <polyline points="10,9 9,9 8,9"/>
                      </svg>
                    </div>
                    <div className="feature-text">
                      <h4>Batch Folder Processing</h4>
                      <p>Process hundreds of files automatically by selecting folders</p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="trial-actions">
                <button 
                  className="enter-license-button"
                  onClick={() => {
                    setShowTrialExpired(false);
                    setShowSettings(true);
                    setActivationError('');
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                    <circle cx="12" cy="16" r="1"/>
                    <path d="m7 11V7a5 5 0 0 1 10 0v4"/>
                  </svg>
                  Enter License
                </button>
                <button 
                  className="purchase-button"
                  onClick={() => {
                    // Open purchase link in system browser
                    if (window.require) {
                      const { shell } = window.require('electron');
                      shell.openExternal('https://rafilisai.com/purchase');
                    } else {
                      window.open('https://rafilisai.com/purchase', '_blank');
                    }
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="9" cy="21" r="1"/>
                    <circle cx="20" cy="21" r="1"/>
                    <path d="m1 1 4 4 13 13v4a2 2 0 0 1-2 2H6"/>
                    <path d="M3 3l18 18"/>
                  </svg>
                  Buy Pro
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Deactivation Confirmation Modal */}
      {showDeactivationModal && (
        <div className="modal-overlay">
          <div className="trial-expired-modal">
            <div className="modal-header">
              <button 
                className="modal-close-button"
                onClick={() => {
                  setShowDeactivationModal(false);
                  setActivationError('');
                }}
                title="Close"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
              <div className="trial-expired-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M8 12h8"/>
                </svg>
              </div>
              <h2>Deactivate License</h2>
              <p>This will deactivate your Pro license on this device</p>
            </div>
            <div className="modal-content">
              <div className="pro-features-highlight">
                <h3>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="m9 12 2 2 4-4"/>
                    <path d="M21 12c.552 0 1-.448 1-1V5c0-.552-.448-1-1-1H3c-.552 0-1 .448-1 1v6c0 .552.448 1 1 1h18z"/>
                  </svg>
                  Deactivation Benefits
                </h3>
                <div className="features-grid">
                  <div className="feature-item">
                    <div className="feature-icon unlimited">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M9 12l2 2 4-4"/>
                        <circle cx="12" cy="12" r="10"/>
                      </svg>
                    </div>
                    <div className="feature-text">
                      <h4>Activate on Another Device</h4>
                      <p>Use your Pro license on a different computer</p>
                    </div>
                  </div>
                  <div className="feature-item">
                    <div className="feature-icon batch">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M8 2v4"/>
                        <path d="M16 2v4"/>
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                        <path d="M3 10h18"/>
                      </svg>
                    </div>
                    <div className="feature-text">
                      <h4>Keep Your License</h4>
                      <p>Your Pro license remains valid for reactivation</p>
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="trial-actions">
                <button 
                  className="enter-license-button"
                  onClick={() => {
                    setShowDeactivationModal(false);
                    setActivationError('');
                  }}
                  disabled={isActivating}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6L6 18"/>
                    <path d="M6 6l12 12"/>
                  </svg>
                  Cancel
                </button>
                <button 
                  className="purchase-button"
                  onClick={deactivateLicense}
                  disabled={isActivating}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M8 12h8"/>
                  </svg>
                  {isActivating ? 'Deactivating...' : 'Deactivate License'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
