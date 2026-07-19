const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('reviewBridge', {
  openCardsFile: () => ipcRenderer.invoke('dialog:openCards'),
  saveExportFile: (payload) => ipcRenderer.invoke('dialog:saveExport', payload),
  webdav: {
    getConfig: () => ipcRenderer.invoke('webdav:getConfig'),
    saveConfig: (payload) => ipcRenderer.invoke('webdav:saveConfig', payload),
    test: (payload) => ipcRenderer.invoke('webdav:test', payload),
    push: (payload) => ipcRenderer.invoke('webdav:push', payload)
  },
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  windowControls: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
    close: () => ipcRenderer.invoke('window:close')
  }
});
