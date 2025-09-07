// Electron types for TypeScript
declare global {
  interface Window {
    require: (module: string) => any;
  }
}

export interface ElectronAPI {
  ipcRenderer: {
    on: (channel: string, listener: (...args: any[]) => void) => void;
    send: (channel: string, ...args: any[]) => void;
    removeAllListeners: (channel: string) => void;
  };
}

export {};