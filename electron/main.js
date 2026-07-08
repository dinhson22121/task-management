const { app, BrowserWindow, ipcMain, Menu, nativeImage, safeStorage, screen, shell, Tray } = require('electron');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

let mainWindow = null;
let tray = null;
let apiToken = null;

// Random per-launch secret required on every embedded-API request (see
// requireLocalApiToken middleware). Prevents any other local process — a
// browser tab, a LAN peer reaching the loopback-bound server — from calling
// the API even though it authenticates every request as the single local user.
function initApiToken() {
  apiToken = crypto.randomBytes(32).toString('hex');
  process.env.LOCAL_API_TOKEN = apiToken;
}

function loadOrCreateEncryptionKey(userDataDir) {
  const keyPath = path.join(userDataDir, 'encryption.key');

  if (!safeStorage.isEncryptionAvailable()) {
    // No OS keyring available (e.g. some Linux setups) — fall back to the
    // plaintext file this app used before safeStorage support existed.
    if (!fs.existsSync(keyPath)) {
      fs.writeFileSync(keyPath, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
    }
    return fs.readFileSync(keyPath, 'utf8').trim();
  }

  if (fs.existsSync(keyPath)) {
    const stored = fs.readFileSync(keyPath);
    const asPlaintext = stored.toString('utf8').trim();
    // A 64-char hex string on disk means it predates safeStorage — migrate
    // it in place so already-encrypted Jira/ElevenLabs tokens keep decrypting.
    if (/^[0-9a-f]{64}$/i.test(asPlaintext)) {
      fs.writeFileSync(keyPath, safeStorage.encryptString(asPlaintext), { mode: 0o600 });
      return asPlaintext;
    }
    return safeStorage.decryptString(stored);
  }

  const plaintext = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(keyPath, safeStorage.encryptString(plaintext), { mode: 0o600 });
  return plaintext;
}

function applyPackagedEnvOverrides() {
  if (!app.isPackaged) {

    return;
  }

  const userDataDir = app.getPath('userData');

  process.env.TOKEN_ENCRYPTION_KEY = loadOrCreateEncryptionKey(userDataDir);

  const dbPath = path.join(userDataDir, 'data.db');

  process.env.DATABASE_URL = `file:${dbPath}?connection_limit=1`;
}

function positionFile() {
  return path.join(app.getPath('userData'), 'window-position.json');
}

function loadSavedPosition() {
  try {
    return JSON.parse(fs.readFileSync(positionFile(), 'utf8'));
  } catch {
    return null;
  }
}

function savePosition(x, y) {
  try {
    fs.writeFileSync(positionFile(), JSON.stringify({ x, y }));
  } catch {}
}

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const width = 360;

  const height = 720;

  const saved = loadSavedPosition();
  const x = saved ? saved.x : workArea.x + workArea.width - width - 12;
  const y = saved ? saved.y : workArea.y + workArea.height - height - 12;

  mainWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    show: false,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'notification_popup_mockup.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    let protocol;
    try {
      protocol = new URL(url).protocol;
    } catch {
      return { action: 'deny' };
    }
    if (protocol === 'https:' || protocol === 'http:') shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.setIgnoreMouseEvents(true, { forward: true });

  mainWindow.on('moved', () => {
    const [posX, posY] = mainWindow.getPosition();
    savePosition(posX, posY);
  });
}

ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  win?.setIgnoreMouseEvents(ignore, options);
});

ipcMain.on('hide-window', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  win?.hide();
});

ipcMain.on('show-window', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  win?.show();
});

function piperResourcesDir() {
  return app.isPackaged ? path.join(process.resourcesPath, 'piper') : path.join(__dirname, '..', 'resources', 'piper');
}

function piperBinaryPath() {
  const platformDir = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux';
  const binaryName = process.platform === 'win32' ? 'piper.exe' : 'piper';
  if (app.isPackaged) return path.join(piperResourcesDir(), binaryName);
  return path.join(__dirname, '..', 'resources', 'piper', platformDir, binaryName);
}

const KNOWN_VOICE_IDS = ['vi_VN-vais1000-medium', 'vi_VN-25hours_single-low', 'vi_VN-vivos-x_low', 'en_US-lessac-medium'];
const DEFAULT_VOICE_ID = 'vi_VN-vais1000-medium';

function piperVoicePath(voiceId) {
  const safeVoiceId = KNOWN_VOICE_IDS.includes(voiceId) ? voiceId : DEFAULT_VOICE_ID;
  return path.join(piperResourcesDir(), 'voices', `${safeVoiceId}.onnx`);
}

async function speakText(text, voiceId) {
  const binaryPath = piperBinaryPath();
  const voicePath = piperVoicePath(voiceId);
  if (!fs.existsSync(binaryPath) || !fs.existsSync(voicePath)) {
    console.error('speakText: piper binary or voice model not found', { binaryPath, voicePath });
    return null;
  }

  const wavPath = path.join(os.tmpdir(), `piper-${crypto.randomUUID()}.wav`);
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(binaryPath, ['--model', voicePath, '--output_file', wavPath]);
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`piper exited with code ${code}`))));
      child.stdin.write(text);
      child.stdin.end();
    });

    const wavBuffer = fs.readFileSync(wavPath);
    return `data:audio/wav;base64,${wavBuffer.toString('base64')}`;
  } catch (err) {
    console.error('speakText failed', err);
    return null;
  } finally {
    fs.unlink(wavPath, () => {});
  }
}

ipcMain.handle('speak-text', (_event, text, voiceId) => speakText(text, voiceId));
ipcMain.handle('get-api-token', () => apiToken);

function toggleWindowVisibility() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
  }
}

function createTray() {

  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'tray-icon.png'));
  tray = new Tray(icon);
  tray.setToolTip('Deadline Buddy');
  tray.on('click', toggleWindowVisibility);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show/Hide Avatar', click: toggleWindowVisibility },
      { label: 'Quit', click: () => app.quit() },
    ]),
  );
}

function wireAppEvents() {
  const { appEvents, APP_EVENT_NAMES } = require(path.join(__dirname, '..', 'dist', 'lib', 'appEvents.js'));
  APP_EVENT_NAMES.forEach((type) => {
    appEvents.on(type, (payload) => {
      mainWindow?.webContents.send('app-event', { type, payload });
    });
  });
}

async function bootstrap() {
  applyPackagedEnvOverrides();
  initApiToken();

  if (process.platform === 'darwin' && app.dock) app.dock.hide();

  const { startServer } = require(path.join(__dirname, '..', 'dist', 'server.js'));
  await startServer();
  wireAppEvents();

  createWindow();
  createTray();
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(bootstrap);

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}
