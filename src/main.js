const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');

const runtimeDataPath = path.join(__dirname, '..', 'runtime-data');
fsSync.mkdirSync(path.join(runtimeDataPath, 'session'), { recursive: true });
fsSync.mkdirSync(path.join(runtimeDataPath, 'logs'), { recursive: true });
app.setPath('userData', runtimeDataPath);
app.setPath('sessionData', path.join(runtimeDataPath, 'session'));
app.setPath('logs', path.join(runtimeDataPath, 'logs'));

if (process.env.KR_DISABLE_GPU !== '0') {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
}

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    frame: false,
    resizable: true,
    title: '知识管理与复习工具',
    backgroundColor: '#fbfaf8',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'index.html'));
};

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('dialog:openCards', async () => {
  const result = await dialog.showOpenDialog({
    title: '导入卡片',
    properties: ['openFile'],
    filters: [
      { name: 'Card Files', extensions: ['json', 'md', 'markdown'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) return null;

  const filePath = result.filePaths[0];
  const content = await fs.readFile(filePath, 'utf8');
  return {
    name: path.basename(filePath),
    extension: path.extname(filePath).toLowerCase(),
    content
  };
});

ipcMain.handle('dialog:saveExport', async (_event, payload) => {
  const extension = payload.format === 'markdown' ? 'md' : 'json';
  const defaultPath = `${payload.filename || 'knowledge-cards'}.${extension}`;
  const result = await dialog.showSaveDialog({
    title: '导出卡片',
    defaultPath,
    filters: [
      payload.format === 'markdown'
        ? { name: 'Markdown', extensions: ['md'] }
        : { name: 'JSON', extensions: ['json'] }
    ]
  });

  if (result.canceled || !result.filePath) return { canceled: true };
  await fs.writeFile(result.filePath, payload.content, 'utf8');
  return { canceled: false, filePath: result.filePath };
});

ipcMain.handle('dialog:chooseDataDirectory', async () => {
  const result = await dialog.showOpenDialog({
    title: '选择数据存储位置',
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  return { canceled: false, directory: result.filePaths[0] };
});

ipcMain.handle('storage:writeSnapshot', async (_event, payload) => {
  if (!payload?.directory || typeof payload.content !== 'string') return { ok: false };
  await fs.mkdir(payload.directory, { recursive: true });
  const filePath = path.join(payload.directory, 'knowledge-review-state.json');
  await fs.writeFile(filePath, payload.content, 'utf8');
  return { ok: true, filePath };
});

ipcMain.handle('storage:readSnapshot', async (_event, directory) => {
  if (!directory) return { ok: false };
  try {
    const filePath = path.join(directory, 'knowledge-review-state.json');
    return { ok: true, content: await fs.readFile(filePath, 'utf8') };
  } catch {
    return { ok: false };
  }
});

ipcMain.handle('window:minimize', (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());
ipcMain.handle('window:toggleMaximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return false;
  if (win.isMaximized()) win.unmaximize(); else win.maximize();
  return win.isMaximized();
});
ipcMain.handle('window:close', (event) => BrowserWindow.fromWebContents(event.sender)?.close());
