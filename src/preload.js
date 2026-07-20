const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('reviewBridge', {
  app: {
    getInfo: () => ipcRenderer.invoke('app:getInfo')
  },
  updates: {
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    onEvent: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('update:event', listener);
      return () => ipcRenderer.removeListener('update:event', listener);
    }
  },
  openCardsFile: () => ipcRenderer.invoke('dialog:openCards'),
  data: {
    load: () => ipcRenderer.invoke('data:load'),
    save: (data) => ipcRenderer.invoke('data:save', data)
  },
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
