const { app, BrowserWindow, dialog, Menu, shell, ipcMain } = require('electron');
const path = require('path');
const isDev = require('electron-is-dev');
const { spawn } = require('child_process');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

let mainWindow;
let backendProcess;

// Backend startup function
function startBackend() {
  console.log('🚀 Starting RafilisAI Backend...');
  
  // Check if we're in a packaged app (more reliable than isDev)
  const isPackaged = !__dirname.includes('node_modules') && __dirname.includes('app.asar');
  
  const backendPath = (isDev && !isPackaged)
    ? path.join(__dirname, '..', '..', 'RafilisAI-Backend', 'rafilisai-backend')
    : path.join(process.resourcesPath, 'backend', 'rafilisai-backend');
    
  // .env is now removed from production builds (secure licensing via Cloudflare Tunnel)
  const envPath = (isDev && !isPackaged)
    ? path.join(__dirname, '..', '..', 'RafilisAI-Backend', '.env')
    : null; // No .env file in production builds

  // Check if backend binary exists
  if (!fs.existsSync(backendPath)) {
    console.error('❌ Backend binary not found:', backendPath);
    dialog.showErrorBox('Backend Error', 'RafilisAI backend not found');
    return;
  }

  // Load .env variables (development only)
  const envVars = {};
  if (envPath && fs.existsSync(envPath)) {
    console.log('🔧 Loading development .env file');
    const envContent = fs.readFileSync(envPath, 'utf8');
    
    envContent.split('\n').forEach(line => {
      if (line.trim() && !line.startsWith('#')) {
        const [key, ...valueParts] = line.split('=');
        if (key && valueParts.length > 0) {
          let value = valueParts.join('=');
          // Remove quotes if present
          if ((value.startsWith('"') && value.endsWith('"')) || 
              (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          envVars[key.trim()] = value;
        }
      }
    });
    
    // Merge with process.env
    Object.assign(process.env, envVars);
    console.log('✅ Development environment variables loaded');
  } else if (!isDev || isPackaged) {
    console.log('🔒 Production mode - using secure license validation (no .env required)');
  }

  // Start backend process
  backendProcess = spawn(backendPath, [], {
    env: process.env,
    detached: false,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  backendProcess.stdout.on('data', (data) => {
    console.log(`[Backend] ${data.toString().trim()}`);
  });

  backendProcess.stderr.on('data', (data) => {
    console.log(`[Backend] ${data.toString().trim()}`);
  });

  backendProcess.on('error', (error) => {
    console.error('❌ Backend failed to start:', error);
    dialog.showErrorBox('Backend Error', `Failed to start backend: ${error.message}`);
  });

  backendProcess.on('exit', (code) => {
    console.log(`[Backend] Process exited with code ${code}`);
    if (code !== 0 && code !== null) {
      console.error('❌ Backend crashed');
    }
  });

  console.log('✅ Backend started with PID:', backendProcess.pid);
}

// Stop backend function
function stopBackend() {
  if (backendProcess && !backendProcess.killed) {
    console.log('🛑 Stopping backend...');
    backendProcess.kill();
    backendProcess = null;
  }
}

// Enable live reload for Electron in development
if (isDev && process.env.NODE_ENV !== 'production') {
  try {
    require('electron-reload')(__dirname, {
      electron: path.join(__dirname, '..', 'node_modules', '.bin', 'electron'),
      hardResetMethod: 'exit'
    });
  } catch (error) {
    console.log('Electron reload disabled in production');
  }
}

function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 1080,
    minHeight: 720,
    maxWidth: 1080,
    maxHeight: 720,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
      webSecurity: false
    },
    titleBarStyle: 'hiddenInset', // macOS style
    vibrancy: 'dark', // macOS blur effect
    show: false, // Don't show until ready
    icon: path.join(__dirname, '../src/assets/icon.png') // App icon
  });

  // Load the React app
  // Check if we're in a packaged app for URL determination
  const isAppPackaged = !__dirname.includes('node_modules') && __dirname.includes('app.asar');
  const startUrl = isAppPackaged || process.env.NODE_ENV === 'production'
    ? `file://${path.join(__dirname, '../build/index.html')}`
    : 'http://localhost:3000';
    
  // Keep startup log for production debugging
  console.log('Loading URL:', startUrl);
  mainWindow.loadURL(startUrl);

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    
    // Focus on window
    // DevTools disabled for production
  });

  // Kırmızı butona basıldığında pencereyi gizle, backend'i çalıştırmaya devam et
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      return false;
    }
  });

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Create application menu
  createMenu();
}

function createMenu() {
  const template = [
    {
      label: 'RafilisAI',
      submenu: [
        {
          label: 'About RafilisAI',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About RafilisAI',
              message: 'RafilisAI',
              detail: 'Professional Audio Normalization Tool\nVersion 2.0.0\n\nBuilt with React + Electron',
              buttons: ['OK']
            });
          }
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'Add Audio Files',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow, {
              properties: ['openFile', 'multiSelections'],
              filters: [
                { name: 'Audio Files', extensions: ['mp3', 'wav', 'flac', 'm4a', 'aac'] },
                { name: 'All Files', extensions: ['*'] }
              ]
            });

            if (!result.canceled) {
              // Send selected files to renderer process
              mainWindow.webContents.send('files-selected', result.filePaths);
            }
          }
        },
        {
          label: 'Select Output Folder',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow, {
              properties: ['openDirectory']
            });

            if (!result.canceled) {
              mainWindow.webContents.send('output-folder-selected', result.filePaths[0]);
            }
          }
        },
        { type: 'separator' },
        { role: 'close' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectall' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// App event handlers
// Auto-updater configuration
if (!isDev) {
  autoUpdater.checkForUpdatesAndNotify();
  
  autoUpdater.on('update-available', (info) => {
    console.log('🔄 Update available, downloading...');
    // Optional: Show download notification
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Available',
      message: `RafilisAI ${info.version} is available. Downloading now...`,
      buttons: ['OK'],
      defaultId: 0
    });
  });
  
  autoUpdater.on('download-progress', (progressObj) => {
    let log_message = `Download speed: ${progressObj.bytesPerSecond}`;
    log_message = log_message + ` - Downloaded ${progressObj.percent}%`;
    log_message = log_message + ` (${progressObj.transferred}/${progressObj.total})`;
    console.log(log_message);
    // Optional: Update progress bar in UI
  });
  
  autoUpdater.on('update-downloaded', (info) => {
    console.log('✅ Update downloaded');
    dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: '🚀 Update Ready - RafilisAI',
      message: `RafilisAI ${info.version} has been downloaded and is ready to install.`,
      detail: `Current version: ${app.getVersion()}\nNew version: ${info.version}\n\nYour license and settings will be preserved.`,
      buttons: ['Install & Restart', 'Install Later'],
      defaultId: 0,
      cancelId: 1,
      icon: null
    }).then((result) => {
      if (result.response === 0) {  // "Install & Restart"
        autoUpdater.quitAndInstall();
      }
      // result.response === 1 ise "Install Later" - user next restart'te update alır
    });
  });
  
  autoUpdater.on('error', (err) => {
    console.error('❌ Auto-updater error:', err);
  });
}

app.whenReady().then(() => {
  startBackend();
  createWindow();
  
  // Check for updates after app is ready (not in dev)
  if (!isDev) {
    setTimeout(() => {
      autoUpdater.checkForUpdatesAndNotify();
    }, 3000); // 3 second delay to let app fully load
  }
});

app.on('window-all-closed', () => {
  stopBackend();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Memory cleanup before quit
app.on('before-quit', () => {
  app.isQuitting = true;
  process.env.NODE_ENV === 'development' && console.log('🧹 Electron: Cleaning up memory before quit');
  
  // Stop backend first
  stopBackend();
  
  // Force garbage collection if available
  if (global.gc) {
    global.gc();
    process.env.NODE_ENV === 'development' && console.log('🧹 Electron: Garbage collection triggered');
  }
  
  // Clear main window reference
  if (mainWindow) {
    mainWindow.removeAllListeners();
    mainWindow = null;
    process.env.NODE_ENV === 'development' && console.log('🧹 Electron: Main window cleaned up');
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else if (mainWindow) {
    // Eğer pencere gizliyse tekrar göster
    mainWindow.show();
  }
});

// Security: Prevent navigation to external URLs
app.on('web-contents-created', (event, contents) => {
  contents.on('will-navigate', (navigationEvent, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    
    if (parsedUrl.origin !== 'http://localhost:3000') {
      navigationEvent.preventDefault();
    }
  });
});

// Handle file drops (optional enhancement)
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (mainWindow) {
    mainWindow.webContents.send('file-dropped', filePath);
  }
});

// Handle IPC messages from renderer process

// Handle output folder selection request from renderer
ipcMain.on('request-output-folder-selection', async (event) => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Output Folder',
      buttonLabel: 'Select Folder'
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const selectedFolder = result.filePaths[0];
      process.env.NODE_ENV === 'development' && console.log('📁 User selected output folder:', selectedFolder);
      
      // Send selected folder back to renderer
      mainWindow.webContents.send('output-folder-selected', selectedFolder);
    }
  } catch (error) {
    console.error('Error opening folder dialog:', error);
  }
});

// Handle file/folder selection request from renderer
ipcMain.on('request-files-selection', async (event) => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'openDirectory', 'multiSelections'],
      filters: [
        { name: 'Audio Files', extensions: ['mp3', 'wav', 'flac', 'm4a', 'aac'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      title: 'Select Audio Files or Folders',
      buttonLabel: 'Add Files/Folders'
    });

    if (!result.canceled && result.filePaths.length > 0) {
      process.env.NODE_ENV === 'development' && console.log('🎵 User selected paths:', result.filePaths);
      
      // Import required modules for folder scanning
      const fs = require('fs');
      const pathModule = require('path');
      
      // Process all selected paths
      const audioExtensions = ['.mp3', '.wav', '.flac', '.m4a', '.aac'];
      const allAudioFiles = [];
      
      function scanDirectory(dirPath, includeSubfolders = true) {
        try {
          const items = fs.readdirSync(dirPath);
          
          for (const item of items) {
            const fullPath = pathModule.join(dirPath, item);
            const stats = fs.statSync(fullPath);
            
            if (stats.isFile()) {
              const ext = pathModule.extname(item).toLowerCase();
              if (audioExtensions.includes(ext)) {
                allAudioFiles.push(fullPath);
              }
            } else if (stats.isDirectory() && includeSubfolders) {
              scanDirectory(fullPath, includeSubfolders);
            }
          }
        } catch (error) {
          console.error(`Error scanning directory ${dirPath}:`, error);
        }
      }
      
      // Process each selected path
      for (const selectedPath of result.filePaths) {
        try {
          const stats = fs.statSync(selectedPath);
          
          if (stats.isFile()) {
            // If it's a file, check if it's an audio file
            const ext = pathModule.extname(selectedPath).toLowerCase();
            if (audioExtensions.includes(ext)) {
              allAudioFiles.push(selectedPath);
            }
          } else if (stats.isDirectory()) {
            // If it's a directory, scan it for audio files
            scanDirectory(selectedPath, true);
          }
        } catch (error) {
          console.error(`Error processing path ${selectedPath}:`, error);
        }
      }
      
      if (allAudioFiles.length > 0) {
        process.env.NODE_ENV === 'development' && console.log(`🎵 Found ${allAudioFiles.length} audio files:`, allAudioFiles);
        
        // Send found audio files back to renderer
        mainWindow.webContents.send('files-selected', allAudioFiles);
      } else {
        process.env.NODE_ENV === 'development' && console.log('📁 No audio files found in selection');
        
        // Show info dialog to user
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'No Audio Files Found',
          message: 'No audio files were found in your selection.',
          detail: 'Supported formats: MP3, WAV, FLAC, M4A, AAC',
          buttons: ['OK']
        });
      }
    }
  } catch (error) {
    console.error('Error opening files/folders dialog:', error);
    
    // Show error dialog to user
    dialog.showErrorBox('Error', 'Failed to open dialog. Please try again.');
  }
});

// Handle default output folder selection request from renderer (for settings)
ipcMain.on('request-default-output-folder-selection', async (event) => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Default Output Folder',
      buttonLabel: 'Set as Default'
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const selectedFolder = result.filePaths[0];
      process.env.NODE_ENV === 'development' && console.log('📁 User set default output folder:', selectedFolder);
      
      // Send selected folder back to renderer
      mainWindow.webContents.send('default-output-folder-selected', selectedFolder);
    }
  } catch (error) {
    console.error('Error opening default folder dialog:', error);
  }
});

