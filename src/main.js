/**
 * main.js - Electron 主进程入口
 *
 * 概述：
 *   本文件是 Notion Card 桌面应用的主进程（main process）入口。
 *   负责创建浏览器窗口、管理应用生命周期、处理 IPC 通信、
 *   自动更新、数据持久化、WebDAV 云同步、牌组市场交互等功能。
 *
 * 核心模块：
 *   - 窗口管理: createWindow() - 创建 BrowserWindow，设置 CSP 和安全策略
 *   - 数据迁移: migrateLegacyRuntimeData() - 旧版数据迁移到新路径
 *   - 状态持久化: readLocalState() / writeLocalState() - 读写 state.json
 *   - 自动更新: checkForUpdates() / configureAutoUpdater() - GitHub Releases 更新
 *   - 数据备份: backupUserData() - 用户数据备份到本地
 *   - 牌组市场: downloadMarketDeck() / uploadMarketDeck() - 市场 API 交互
 *   - WebDAV 同步: pushWebDavState() / getWebDavConfig() - 坚果云等 WebDAV 同步
 *   - 凭证管理: readMarketCredentials() / readWebDavCredentials() - 安全存储凭证
 *
 * 数据路径：
 *   - 应用数据: %APPDATA%/KnowledgeReview/
 *   - 状态文件: %APPDATA%/KnowledgeReview/data/state.json
 *   - 会话数据: %APPDATA%/KnowledgeReview/session/
 *   - 日志文件: %APPDATA%/KnowledgeReview/logs/
 *   - 备份目录: %APPDATA%/KnowledgeReview-backups/
 *
 * IPC 通道（主进程 <-> 渲染进程）：
 *   - app:getInfo - 获取应用信息（版本、数据路径等）
 *   - update:check / update:install - 检查和安装更新
 *   - data:load / data:save - 加载/保存应用状态
 *   - market:downloadDeck / market:uploadDeck - 市场牌组操作
 *   - webdav:test / webdav:save / webdav:sync - WebDAV 操作
 *   - window:minimize / window:toggleMaximize / window:close - 窗口控制
 *
 * 依赖：electron, electron-updater, adm-zip
 * 版本：v0.1.9
 */

const { app, BrowserWindow, dialog, ipcMain, Menu, shell, safeStorage } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

app.setName('Notion Card');
const legacyRuntimeDataPaths = [
  path.join(__dirname, '..', 'runtime-data'),
  path.join(process.cwd(), 'runtime-data'),
  path.join(path.dirname(process.execPath), 'runtime-data')
];
const runtimeDataPath = path.join(app.getPath('appData'), 'KnowledgeReview');
const stateDataPath = path.join(runtimeDataPath, 'data', 'state.json');
const updateBackupRoot = path.join(app.getPath('appData'), 'KnowledgeReview-backups');
let updateCheckPromise = null;
let updateDownloaded = false;
let updateInstallStarted = false;
app.setPath('userData', runtimeDataPath);
app.setPath('sessionData', path.join(runtimeDataPath, 'session'));
app.setPath('logs', path.join(runtimeDataPath, 'logs'));

async function migrateLegacyRuntimeData() {
  const markerPath = path.join(runtimeDataPath, '.legacy-migration-complete');
  if (fsSync.existsSync(markerPath)) return { migrated: false, source: '' };

  await fs.mkdir(runtimeDataPath, { recursive: true });
  const currentEntries = await fs.readdir(runtimeDataPath).catch(() => []);
  const hasCurrentData = currentEntries.some((entry) => entry !== '.legacy-migration-complete');
  if (hasCurrentData) {
    await fs.writeFile(markerPath, new Date().toISOString(), 'utf8');
    return { migrated: false, source: '' };
  }

  const source = [...new Set(legacyRuntimeDataPaths)].find((candidate) => {
    return path.resolve(candidate) !== path.resolve(runtimeDataPath) && fsSync.existsSync(candidate);
  });
  if (!source) {
    await fs.writeFile(markerPath, new Date().toISOString(), 'utf8');
    return { migrated: false, source: '' };
  }

  await fs.cp(source, runtimeDataPath, { recursive: true, force: false, errorOnExist: false });
  await fs.writeFile(markerPath, new Date().toISOString(), 'utf8');
  return { migrated: true, source };
}

function readStoredState(value) {
  if (!value || typeof value !== 'object') return null;
  const data = value.format === 'knowledge-review-local-state' && value.data ? value.data : value;
  return Array.isArray(data.cards) && Array.isArray(data.groups)
    ? { data, savedAt: value.savedAt || '' }
    : null;
}

function unwrapStoredState(value) {
  return readStoredState(value)?.data || null;
}

async function readLocalState() {
  for (const candidate of [stateDataPath, `${stateDataPath}.previous`]) {
    try {
      const stored = readStoredState(JSON.parse(await fs.readFile(candidate, 'utf8')));
      if (stored) return stored;
    } catch {
      // Try the previous snapshot before reporting that no local state exists.
    }
  }
  return null;
}

async function writeLocalState(data) {
  const valid = unwrapStoredState(data);
  if (!valid) throw new Error('Invalid local state');
  const dataDir = path.dirname(stateDataPath);
  const tempPath = `${stateDataPath}.tmp-${process.pid}`;
  const previousPath = `${stateDataPath}.previous`;
  const payload = JSON.stringify({ format: 'knowledge-review-local-state', version: 1, savedAt: new Date().toISOString(), data: valid }, null, 2);
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(tempPath, payload, 'utf8');
  try {
    if (fsSync.existsSync(stateDataPath)) await fs.copyFile(stateDataPath, previousPath);
    await fs.rename(tempPath, stateDataPath);
  } catch {
    await fs.copyFile(tempPath, stateDataPath);
    await fs.rm(tempPath, { force: true });
  }
  return { ok: true, path: stateDataPath };
}

function sendUpdateEvent(event, payload = {}) {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) win.webContents.send('update:event', { event, ...payload });
  });
}

function configureUpdaterFeed() {
  autoUpdater.setFeedURL({ provider: 'github', owner: 'shenxiao233', repo: 'knowledge-review-electron', releaseType: 'release' });
}

function configureAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => sendUpdateEvent('checking'));
  autoUpdater.on('update-available', (info) => {
    updateDownloaded = false;
    sendUpdateEvent('available', { version: info.version, releaseDate: info.releaseDate || '' });
    autoUpdater.downloadUpdate().catch((error) => sendUpdateEvent('error', { message: error.message || '更新下载失败。' }));
  });
  autoUpdater.on('update-not-available', (info) => sendUpdateEvent('not-available', { version: info?.version || app.getVersion() }));
  autoUpdater.on('download-progress', (progress) => sendUpdateEvent('progress', {
    percent: Number(progress.percent || 0),
    transferred: Number(progress.transferred || 0),
    total: Number(progress.total || 0),
    bytesPerSecond: Number(progress.bytesPerSecond || 0)
  }));
  autoUpdater.on('update-downloaded', (info) => {
    updateDownloaded = true;
    sendUpdateEvent('downloaded', { version: info.version });
  });
  autoUpdater.on('error', (error) => sendUpdateEvent('error', { message: error?.message || '检查更新失败。' }));
}

function checkForUpdates() {
  if (updateCheckPromise) return updateCheckPromise;
  configureUpdaterFeed();
  updateCheckPromise = autoUpdater.checkForUpdates().finally(() => {
    updateCheckPromise = null;
  });
  return updateCheckPromise;
}

async function backupUserData(reason = 'manual') {
  const stamp = new Date().toISOString().replace(/[.:]/g, '-');
  const target = path.join(updateBackupRoot, `${stamp}-${reason}`);
  await fs.mkdir(updateBackupRoot, { recursive: true });
  await fs.cp(runtimeDataPath, target, {
    recursive: true,
    force: false,
    errorOnExist: false,
    filter: (source) => !['session', 'logs'].includes(path.basename(source))
  });
  return target;
}

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
    title: 'Notion Card',
    icon: path.join(__dirname, 'assets', 'notion-card.ico'),
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
  return migrateLegacyRuntimeData();
}).then(async (migration) => {
  fsSync.mkdirSync(path.join(runtimeDataPath, 'session'), { recursive: true });
  fsSync.mkdirSync(path.join(runtimeDataPath, 'logs'), { recursive: true });
  Menu.setApplicationMenu(null);
  configureAutoUpdater();
  createWindow();

  if (migration.migrated) {
    setTimeout(() => sendUpdateEvent('data-migrated', { source: migration.source }), 300);
  }
  if (app.isPackaged) {
    setTimeout(() => checkForUpdates().catch(() => {}), 2500);
  }

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

function marketUrl(baseUrl, endpoint) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) throw new Error('牌组市场地址无效。');
  return `${base}${endpoint}`;
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function readDeckPackage(zipPath) {
  const zip = new AdmZip(zipPath);
  const manifestEntry = zip.getEntry('manifest.json');
  const cardsEntry = zip.getEntry('cards.json');
  if (!manifestEntry || !cardsEntry) throw new Error('牌组包缺少 manifest.json 或 cards.json。');
  let manifest;
  let cards;
  try {
    manifest = JSON.parse(manifestEntry.getData().toString('utf8').replace(/^\uFEFF/, ''));
    cards = JSON.parse(cardsEntry.getData().toString('utf8').replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('牌组包中的 JSON 无法解析。');
  }
  if (!manifest || typeof manifest !== 'object' || !String(manifest.title || '').trim() || !Array.isArray(cards)) throw new Error('牌组包格式不正确。');
  if (manifest.cardCount !== undefined && Number(manifest.cardCount) !== cards.length) throw new Error('牌组卡片数量校验失败。');
  const assets = {};
  let assetBytes = 0;
  zip.getEntries().forEach((entry) => {
    if (entry.isDirectory || !entry.entryName.startsWith('assets/')) return;
    const data = entry.getData();
    assetBytes += data.length;
    if (assetBytes > 30 * 1024 * 1024) return;
    const ext = path.extname(entry.entryName).toLowerCase();
    const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
    if (types[ext]) assets[entry.entryName] = `data:${types[ext]};base64,${data.toString('base64')}`;
  });
  const replaceAssets = (value) => {
    if (typeof value === 'string') return value.replace(/(?:\.\/)?(assets\/[^\s)"']+)/g, (match, assetPath) => assets[assetPath] || match);
    if (Array.isArray(value)) return value.map(replaceAssets);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceAssets(item)]));
    return value;
  };
  return { manifest, cards: replaceAssets(cards), assets };
}

async function downloadMarketDeck(payload) {
  const deckId = encodeURIComponent(String(payload?.deckId || ''));
  if (!deckId) throw new Error('牌组编号不能为空。');
  const version = payload?.version ? `?version=${encodeURIComponent(String(payload.version))}` : '';
  const response = await fetch(marketUrl(payload.baseUrl, `/decks/${deckId}/download${version}`), { headers: { Authorization: `Bearer ${payload.token || ''}` } });
  if (!response.ok || !response.body) {
    let message = `下载牌组失败（${response.status}）。`;
    try { const body = await response.json(); message = body.error || message; } catch {}
    throw new Error(message);
  }
  const tempPath = path.join(os.tmpdir(), `knowledge-review-market-${crypto.randomUUID()}.zip`);
  try {
    await pipeline(Readable.fromWeb(response.body), fsSync.createWriteStream(tempPath));
    const buffer = await fs.readFile(tempPath);
    const result = readDeckPackage(tempPath);
    return { ...result, sha256: sha256Buffer(buffer), version: Number(response.headers.get('x-deck-version') || result.manifest.version || 1) };
  } finally {
    await fs.rm(tempPath, { force: true });
  }
}

function createDeckPackage(payload) {
  const manifest = { format: 'knowledge-review-deck', title: String(payload.title || '未命名牌组'), description: String(payload.description || ''), category: String(payload.category || '未分类'), version: Number(payload.version || 1), cardCount: Array.isArray(payload.cards) ? payload.cards.length : 0, tags: Array.isArray(payload.tags) ? payload.tags : [], changelog: String(payload.changelog || '') };
  const zip = new AdmZip();
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));
  zip.addFile('cards.json', Buffer.from(JSON.stringify(Array.isArray(payload.cards) ? payload.cards : [], null, 2), 'utf8'));
  return zip.toBuffer();
}

async function uploadMarketDeck(payload) {
  const zip = createDeckPackage(payload);
  const form = new FormData();
  form.append('metadata', JSON.stringify({ title: payload.title, description: payload.description, category: payload.category }));
  form.append('package', new Blob([zip], { type: 'application/zip' }), 'deck.zip');
  const endpoint = payload.deckId ? `/my-decks/${encodeURIComponent(payload.deckId)}/versions` : '/my-decks';
  const response = await fetch(marketUrl(payload.baseUrl, endpoint), { method: 'POST', headers: { Authorization: `Bearer ${payload.token || ''}` }, body: form });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `上传牌组失败（${response.status}）。`);
  return body;
}

ipcMain.handle('market:downloadDeck', async (_event, payload) => {
  try { return { ok: true, ...(await downloadMarketDeck(payload)) }; } catch (error) { return { ok: false, error: error.message || '下载牌组失败。' }; }
});

ipcMain.handle('market:uploadDeck', async (_event, payload) => {
  try { return { ok: true, ...(await uploadMarketDeck(payload)) }; } catch (error) { return { ok: false, error: error.message || '上传牌组失败。' }; }
});

ipcMain.handle('market:getCredentials', async () => ({ ok: true, ...(await readMarketCredentials()) }));
ipcMain.handle('market:saveCredentials', async (_event, payload) => {
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: '系统加密存储暂不可用，无法安全记住密码。' };
  return writeMarketCredentials(payload);
});
ipcMain.handle('market:clearCredentials', async () => clearMarketCredentials());

ipcMain.handle('data:load', async () => {
  const stored = await readLocalState();
  return stored ? { ok: true, ...stored } : { ok: false };
});

ipcMain.handle('data:save', async (_event, data) => {
  try {
    return await writeLocalState(data);
  } catch (error) {
    return { ok: false, error: error.message || 'Unable to save local state' };
  }
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
const marketCredentialsPath = path.join(runtimeDataPath, 'market-credentials.json');
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

async function readMarketCredentials() {
  try {
    const saved = JSON.parse(await fs.readFile(marketCredentialsPath, 'utf8'));
    if (!saved?.remember || !safeStorage.isEncryptionAvailable()) return { remember: false, accessKey: '', username: '', password: '' };
    return {
      remember: true,
      accessKey: saved.accessKey ? safeStorage.decryptString(Buffer.from(saved.accessKey, 'base64')) : '',
      username: String(saved.username || ''),
      password: saved.password ? safeStorage.decryptString(Buffer.from(saved.password, 'base64')) : ''
    };
  } catch {
    return { remember: false, accessKey: '', username: '', password: '' };
  }
}

async function writeMarketCredentials(payload) {
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: '系统加密存储暂不可用，无法安全记住密码。' };
  const accessKey = String(payload?.accessKey || '');
  const username = String(payload?.username || '');
  const password = String(payload?.password || '');
  if (!accessKey || !username || !password) return { ok: false, error: '牌组市场登录信息不完整。' };
  const tempPath = `${marketCredentialsPath}.tmp`;
  const saved = {
    remember: true,
    accessKey: safeStorage.encryptString(accessKey).toString('base64'),
    username,
    password: safeStorage.encryptString(password).toString('base64')
  };
  await fs.writeFile(tempPath, JSON.stringify(saved, null, 2), 'utf8');
  await fs.rename(tempPath, marketCredentialsPath).catch(async () => {
    await fs.copyFile(tempPath, marketCredentialsPath);
    await fs.rm(tempPath, { force: true });
  });
  return { ok: true, remember: true, username };
}

async function clearMarketCredentials() {
  await fs.rm(marketCredentialsPath, { force: true });
  return { ok: true, remember: false };
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

ipcMain.handle('app:getInfo', () => ({
  version: app.getVersion(),
  isPackaged: app.isPackaged,
  dataPath: runtimeDataPath
}));

ipcMain.handle('update:check', async () => {
  if (!app.isPackaged) return { ok: false, skipped: true, error: '开发模式不会连接 GitHub 检查更新。' };
  try {
    const result = await checkForUpdates();
    return { ok: true, updateInfo: result?.updateInfo || null };
  } catch (error) {
    return { ok: false, error: error.message || '检查更新失败。' };
  }
});

ipcMain.handle('update:install', async () => {
  if (!app.isPackaged) return { ok: false, error: '开发模式不能安装更新。' };
  if (!updateDownloaded) return { ok: false, error: '更新尚未下载完成，请稍候再试。' };
  if (updateInstallStarted) return { ok: false, error: '更新正在安装。' };
  try {
    updateInstallStarted = true;
    const backupPath = await backupUserData('before-update');
    sendUpdateEvent('backup-created', { path: backupPath });
    setImmediate(() => {
      try { autoUpdater.quitAndInstall(false, true); } catch { updateInstallStarted = false; }
    });
    return { ok: true };
  } catch (error) {
    updateInstallStarted = false;
    return { ok: false, error: error.message || '更新前备份失败，已取消安装。' };
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
