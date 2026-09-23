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
  sendTitlebarCommand: (command: string) => ipcRenderer.send('titlebar-command', command),
  /** A downloaded update waiting for a restart, or null. */
  getUpdateState: (): Promise<{ version: string } | null> => ipcRenderer.invoke('update-state'),
  onUpdateReady: (callback: (info: { version: string }) => void) => {
    const listener = (_event: IpcRendererEvent, info: { version: string }) => callback(info);
    ipcRenderer.on('update-ready', listener);
    return () => ipcRenderer.removeListener('update-ready', listener);
  },
  installUpdate: () => ipcRenderer.send('install-update'),
});
