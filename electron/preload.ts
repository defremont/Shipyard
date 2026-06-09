import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

// Expose safe APIs to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,
  /**
   * Subscribe to application-menu actions (e.g. 'navigate:/settings',
   * 'toggle-search'). Returns an unsubscribe function.
   */
  onMenuAction: (callback: (action: string) => void) => {
    const listener = (_event: IpcRendererEvent, action: string) => callback(action);
    ipcRenderer.on('menu-action', listener);
    return () => ipcRenderer.removeListener('menu-action', listener);
  },
});
