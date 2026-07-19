const { app, BrowserWindow, dialog, ipcMain, Menu, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const http = require('http');
const https = require('https');

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
    width: 1600,
    height: 1000,
    minWidth: 1200,
    minHeight: 760,
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
  const extension = payload.format === 'markdown' ? 'md' : payload.format === 'pdf' ? 'pdf' : 'json';
  const defaultPath = `${payload.filename || 'knowledge-cards'}.${extension}`;
  const result = await dialog.showSaveDialog({
    title: '导出卡片',
    defaultPath,
    filters: [
      payload.format === 'markdown'
        ? { name: 'Markdown', extensions: ['md'] }
        : payload.format === 'pdf'
          ? { name: 'PDF', extensions: ['pdf'] }
          : { name: 'JSON', extensions: ['json'] }
    ]
  });

  if (result.canceled || !result.filePath) return { canceled: true };
  if (payload.format === 'pdf') {
    const sourceWindow = BrowserWindow.fromWebContents(_event.sender);
    const printWindow = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { sandbox: true } });
    try {
      await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(payload.content || '')}`);
      const buffer = await printWindow.webContents.printToPDF({ printBackground: true, pageSize: 'A4', marginsType: 'default' });
      await fs.writeFile(result.filePath, buffer);
      return { canceled: false, filePath: result.filePath };
    } finally {
      if (!printWindow.isDestroyed()) printWindow.close();
      if (sourceWindow && !sourceWindow.isDestroyed()) sourceWindow.focus();
    }
  }
  await fs.writeFile(result.filePath, payload.content, 'utf8');
  return { canceled: false, filePath: result.filePath };
});

const appConfigPath = path.join(runtimeDataPath, 'app-config.json');
const webDavCredentialsPath = path.join(runtimeDataPath, 'webdav-credentials.json');
const defaultWebDavUrl = 'https://dav.jianguoyun.com/dav/';
const defaultWebDavFolder = 'knowledge-review-electron';

async function readAppConfig() {
  try {
    return JSON.parse(await fs.readFile(appConfigPath, 'utf8'));
  } catch {
    return {};
  }
}

async function writeAppConfig(config) {
  const tempPath = `${appConfigPath}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(config, null, 2), 'utf8');
  try {
    await fs.rename(tempPath, appConfigPath);
  } catch {
    await fs.rm(appConfigPath, { force: true });
    await fs.rename(tempPath, appConfigPath);
  }
}

function normalizeWebDavUrl(value) {
  const input = String(value || defaultWebDavUrl).trim();
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('WebDAV 地址必须使用 http 或 https。');
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
  return url.toString();
}

function webDavUrl(relativePath = '', config = {}) {
  const base = normalizeWebDavUrl(config.url);
  const folder = String(config.remoteFolder || defaultWebDavFolder).trim().replace(/^\/+|\/+$/g, '');
  const suffix = [folder, relativePath].filter(Boolean).map((part) => part.split('/').map(encodeURIComponent).join('/')).join('/');
  return new URL(suffix, base).toString();
}

async function readWebDavCredentials() {
  try {
    const saved = JSON.parse(await fs.readFile(webDavCredentialsPath, 'utf8'));
    if (!saved?.password) return { username: saved?.username || '', password: '' };
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统加密存储不可用，无法读取 WebDAV 密码。');
    return { username: saved.username || '', password: safeStorage.decryptString(Buffer.from(saved.password, 'base64')) };
  } catch (error) {
    if (error?.message?.includes('系统加密存储不可用')) throw error;
    return { username: '', password: '' };
  }
}

async function writeWebDavCredentials(username, password) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统加密存储不可用，无法保存 WebDAV 密码。');
  const encrypted = safeStorage.encryptString(String(password || '')).toString('base64');
  const tempPath = `${webDavCredentialsPath}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify({ username: String(username || ''), password: encrypted }, null, 2), 'utf8');
  try {
    await fs.rename(tempPath, webDavCredentialsPath);
  } catch {
    await fs.rm(webDavCredentialsPath, { force: true });
    await fs.rename(tempPath, webDavCredentialsPath);
  }
}

function requestWebDav(url, options = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === 'http:' ? http : https;
    const headers = { ...(options.headers || {}) };
    if (options.username) {
      headers.Authorization = `Basic ${Buffer.from(`${options.username}:${options.password || ''}`, 'utf8').toString('base64')}`;
    }
    const request = transport.request(target, {
      method: options.method || 'PROPFIND',
      headers,
      timeout: 15000
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode || 0,
        headers: response.headers,
        body: Buffer.concat(chunks)
      }));
    });
    request.on('timeout', () => request.destroy(new Error('WebDAV 请求超时。')));
    request.on('error', reject);
    if (options.body !== undefined) request.write(options.body);
    request.end();
  });
}

function isSuccessStatus(status) { return status >= 200 && status < 300; }

async function getWebDavConfig() {
  const config = await readAppConfig();
  const credentials = await readWebDavCredentials();
  const lastBackupAt = config.webdav?.lastBackupAt || config.webdav?.lastSyncAt || '';
  const savedHistory = Array.isArray(config.webdav?.backupHistory)
    ? config.webdav.backupHistory.slice(0, 20)
    : [];
  const backupHistory = savedHistory.length || !lastBackupAt
    ? savedHistory
    : [{ id: 'legacy-last-backup', at: lastBackupAt, status: 'success', trigger: 'automatic', message: '历史备份记录', size: 0 }];
  return {
    url: config.webdav?.url || defaultWebDavUrl,
    remoteFolder: config.webdav?.remoteFolder || defaultWebDavFolder,
    username: config.webdav?.username || credentials.username || '',
    enabled: config.webdav?.enabled === true,
    autoBackup: config.webdav?.autoBackup !== undefined ? config.webdav.autoBackup === true : config.webdav?.autoSync === true,
    hasPassword: Boolean(credentials.password),
    lastBackupAt,
    lastError: config.webdav?.lastError || '',
    backupHistory
  };
}

async function ensureWebDavDirectory(config, credentials) {
  const rootResult = await requestWebDav(normalizeWebDavUrl(config.url), {
    method: 'PROPFIND',
    headers: { Depth: '0' },
    username: credentials.username,
    password: credentials.password
  });
  if (![200, 207].includes(rootResult.status)) throw new Error(`WebDAV 连接失败（${rootResult.status}）。`);
  const folderResult = await requestWebDav(webDavUrl('', config), {
    method: 'MKCOL',
    username: credentials.username,
    password: credentials.password
  });
  if (![201, 405].includes(folderResult.status)) throw new Error(`无法创建同步目录（${folderResult.status}）。`);
}

async function pushWebDavState(config, credentials, content, updatedAt) {
  const stateResult = await requestWebDav(webDavUrl('state.json', config), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    username: credentials.username,
    password: credentials.password,
    body: content
  });
  if (!isSuccessStatus(stateResult.status)) throw new Error(`上传同步数据失败（${stateResult.status}）。`);
  const manifest = JSON.stringify({ format: 'knowledge-review-state', version: 1, dataFile: 'state.json', updatedAt: updatedAt || new Date().toISOString() }, null, 2);
  const manifestResult = await requestWebDav(webDavUrl('manifest.json', config), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    username: credentials.username,
    password: credentials.password,
    body: manifest
  });
  if (!isSuccessStatus(manifestResult.status)) throw new Error(`上传同步版本失败（${manifestResult.status}）。`);
  return { ok: true, updatedAt: updatedAt || new Date().toISOString() };
}

async function recordWebDavBackup({ status, trigger, message, size = 0, at = new Date().toISOString() }) {
  const current = await readAppConfig();
  const webdav = current.webdav || {};
  const history = Array.isArray(webdav.backupHistory) ? webdav.backupHistory : [];
  const entry = {
    id: `backup-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    at,
    status: status === 'success' ? 'success' : 'failed',
    trigger: trigger === 'manual' ? 'manual' : 'automatic',
    message: String(message || ''),
    size: Number.isFinite(size) ? size : 0
  };
  const nextWebDav = {
    ...webdav,
    lastBackupAt: entry.status === 'success' ? at : (webdav.lastBackupAt || ''),
    lastError: entry.status === 'success' ? '' : entry.message,
    backupHistory: [entry, ...history].slice(0, 20)
  };
  await writeAppConfig({ ...current, webdav: nextWebDav });
  return nextWebDav;
}

ipcMain.handle('webdav:getConfig', async () => {
  const config = await getWebDavConfig();
  return { ok: true, ...config, url: normalizeWebDavUrl(config.url) };
});

ipcMain.handle('webdav:saveConfig', async (_event, payload) => {
  try {
    const current = await readAppConfig();
    const existingCredentials = await readWebDavCredentials();
    const url = normalizeWebDavUrl(payload?.url || defaultWebDavUrl);
    const remoteFolder = String(payload?.remoteFolder || defaultWebDavFolder).trim().replace(/^\/+|\/+$/g, '') || defaultWebDavFolder;
    const username = String(payload?.username || '').trim();
    const password = String(payload?.password || '');
    if (!username) return { ok: false, error: '请填写坚果云账号或邮箱。' };
    if (!password && !existingCredentials.password) return { ok: false, error: '请填写应用密码。' };
    if (password) await writeWebDavCredentials(username, password);
    else if (username !== existingCredentials.username) await writeWebDavCredentials(username, existingCredentials.password);
    await writeAppConfig({
      ...current,
      webdav: {
        ...(current.webdav || {}),
        url,
        remoteFolder,
        username,
        enabled: payload?.enabled === true,
        autoBackup: payload?.autoBackup !== false,
        lastError: ''
      }
    });
    return { ok: true, ...(await getWebDavConfig()) };
  } catch (error) {
    return { ok: false, error: error.message || '无法保存 WebDAV 配置。' };
  }
});

ipcMain.handle('webdav:test', async (_event, payload) => {
  try {
    const savedConfig = await getWebDavConfig();
    const savedCredentials = await readWebDavCredentials();
    const config = {
      url: normalizeWebDavUrl(payload?.url || savedConfig.url || defaultWebDavUrl),
      remoteFolder: String(payload?.remoteFolder || savedConfig.remoteFolder || defaultWebDavFolder).trim().replace(/^\/+|\/+$/g, '') || defaultWebDavFolder
    };
    const credentials = {
      username: String(payload?.username || savedConfig.username || savedCredentials.username || '').trim(),
      password: String(payload?.password || savedCredentials.password || '')
    };
    if (!credentials.username || !credentials.password) return { ok: false, error: '请填写坚果云账号和应用密码。' };
    await ensureWebDavDirectory(config, credentials);
    await writeWebDavCredentials(credentials.username, credentials.password);
    const current = await readAppConfig();
    await writeAppConfig({
      ...current,
      webdav: {
        ...(current.webdav || {}),
        url: config.url,
        remoteFolder: config.remoteFolder,
        username: credentials.username,
        lastError: ''
      }
    });
    return { ok: true, message: 'WebDAV 连接成功，备份目录可用。', ...(await getWebDavConfig()) };
  } catch (error) {
    return { ok: false, error: error.message || 'WebDAV 连接失败。' };
  }
});

ipcMain.handle('webdav:push', async (_event, payload) => {
  const trigger = payload?.trigger === 'manual' ? 'manual' : 'automatic';
  const attemptedAt = new Date().toISOString();
  try {
    const config = await getWebDavConfig();
    const credentials = await readWebDavCredentials();
    if (!config.enabled || !config.username || !credentials.password) return { ok: false, skipped: true, error: 'WebDAV 尚未配置。' };
    if (typeof payload?.content !== 'string') return { ok: false, error: '同步数据为空。' };
    await ensureWebDavDirectory(config, credentials);
    const result = await pushWebDavState(config, credentials, payload.content, payload.updatedAt || attemptedAt);
    if (result.ok) {
      const webdav = await recordWebDavBackup({
        status: 'success',
        trigger,
        at: result.updatedAt,
        size: Buffer.byteLength(payload.content, 'utf8'),
        message: '已上传本地数据快照'
      });
      return { ...result, lastBackupAt: webdav.lastBackupAt, backupHistory: webdav.backupHistory };
    }
    return result;
  } catch (error) {
    const message = error.message || '无法上传 WebDAV 数据。';
    const webdav = await recordWebDavBackup({ status: 'failed', trigger, at: attemptedAt, message });
    return { ok: false, error: message, lastBackupAt: webdav.lastBackupAt, backupHistory: webdav.backupHistory };
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
ipcMain.handle('shell:openExternal', async (_event, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return { ok: false };
  await shell.openExternal(url);
  return { ok: true };
});
