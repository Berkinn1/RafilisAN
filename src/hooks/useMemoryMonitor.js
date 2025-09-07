import { useEffect, useRef } from 'react';

const useMemoryMonitor = () => {
  const intervalRef = useRef(null);
  
  useEffect(() => {
    // DISABLE ALL CONSOLE LOGS IN PRODUCTION
    const isDev = process.env.NODE_ENV === 'development';
    
    if (isDev) console.log('🧠 Memory Monitor: Started tracking');
    
    // Clear any existing interval before starting new one
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    
    const monitorMemory = () => {
      if (performance.memory) {
        const used = (performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(2);
        const total = (performance.memory.totalJSHeapSize / 1024 / 1024).toFixed(2);
        const limit = (performance.memory.jsHeapSizeLimit / 1024 / 1024).toFixed(2);
        
        // DISABLE CONSOLE LOGS IN PRODUCTION
        if (isDev) {
          console.log(`🧠 Memory: Used ${used}MB / Total ${total}MB / Limit ${limit}MB`);
        }
        
        // Warning threshold: 80% of limit
        const usagePercent = (performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit) * 100;
        if (usagePercent > 80) {
          if (isDev) console.warn(`⚠️  Memory Warning: ${usagePercent.toFixed(1)}% usage - potential leak!`);
        }
        
        // Critical threshold: 90% of limit  
        if (usagePercent > 90) {
          console.error(`🚨 Memory Critical: ${usagePercent.toFixed(1)}% usage - system may freeze!`); // Always log critical memory errors
        }
      } else {
        if (isDev) console.log('🧠 Memory Monitor: performance.memory not available');
      }
    };

    // Initial measurement
    monitorMemory();
    
    // Monitor every 5 seconds - store in ref
    intervalRef.current = setInterval(monitorMemory, 5000);
    
    return () => {
      if (isDev) console.log('🧠 Memory Monitor: Stopped tracking');
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);
};

export default useMemoryMonitor;