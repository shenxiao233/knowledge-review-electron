const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('reviewBridge', {
  openCardsFile: () => ipcRenderer.invoke('dialog:openCards'),
  saveExportFile: (payload) => ipcRenderer.invoke('dialog:saveExport', payload),
  chooseDataDirectory: () => ipcRenderer.invoke('dialog:chooseDataDirectory'),
  writeStorageSnapshot: (payload) => ipcRenderer.invoke('storage:writeSnapshot', payload),
  readStorageSnapshot: (directory) => ipcRenderer.invoke('storage:readSnapshot', directory),
  windowControls: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
    close: () => ipcRenderer.invoke('window:close')
  }
});
