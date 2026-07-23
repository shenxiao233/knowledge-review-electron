/**
 * preload.js - Electron 预加载脚本（安全桥接层）
 *
 * 概述：
 *   本文件在渲染进程加载前执行，通过 contextBridge 将主进程功能
 *   安全地暴露给渲染进程。使用 contextIsolation 确保安全隔离，
 *   渲染进程无法直接访问 Node.js API 或 Electron 主进程 API。
 *
 * 暴露的 API（通过 window.reviewBridge）：
 *
 *   reviewBridge.app
 *     - getInfo() -> Promise<{version, dataPath, isPackaged}>
 *       获取应用基本信息
 *
 *   reviewBridge.updates
 *     - check() -> Promise<{ok, ...}>
 *       检查是否有新版本可用
 *     - install() -> Promise<{ok, ...}>
 *       安装已下载的新版本
 *
 *   reviewBridge.data
 *     - load() -> Promise<{ok, data, savedAt}>
 *       从持久化存储加载应用状态
 *     - save(state) -> Promise<{ok}>
 *       将应用状态保存到持久化存储
 *
 *   reviewBridge.market
 *     - downloadDeck({baseUrl, token, deckId}) -> Promise<{ok, zipPath}>
 *       从牌组市场下载牌组
 *     - uploadDeck({baseUrl, token, deckId, ...}) -> Promise<{ok}>
 *       上传牌组到市场
 *
 *   reviewBridge.webdav
 *     - test(config) -> Promise<{ok}>
 *     - save(config) -> Promise<{ok}>
 *     - sync(config) -> Promise<{ok}>
 *       WebDAV 云同步相关操作
 *
 *   reviewBridge.windowControls
 *     - minimize() - 最小化窗口
 *     - toggleMaximize() -> Promise<boolean> - 切换最大化状态
 *     - close() - 关闭窗口
 *
 * 安全策略：
 *   - contextIsolation: true（默认）
 *   - nodeIntegration: false（默认）
 *   - 仅暴露白名单 API，不暴露 ipcRenderer 本身
 *
 * 依赖：electron (contextBridge, ipcRenderer)
 */
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
  market: {
    downloadDeck: (payload) => ipcRenderer.invoke('market:downloadDeck', payload),
    uploadDeck: (payload) => ipcRenderer.invoke('market:uploadDeck', payload),
    getCredentials: () => ipcRenderer.invoke('market:getCredentials'),
    saveCredentials: (payload) => ipcRenderer.invoke('market:saveCredentials', payload),
    clearCredentials: () => ipcRenderer.invoke('market:clearCredentials'),
    fetch: (payload) => ipcRenderer.invoke('market:fetch', payload)
  },
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
