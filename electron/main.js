const { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, shell, Tray } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let mainWindow = null;
let tray = null;

function applyPackagedEnvOverrides() {
  if (!app.isPackaged) {

    return;
  }

  const userDataDir = app.getPath('userData');

  const keyPath = path.join(userDataDir, 'encryption.key');
  if (!fs.existsSync(keyPath)) {
    fs.writeFileSync(keyPath, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  process.env.TOKEN_ENCRYPTION_KEY = fs.readFileSync(keyPath, 'utf8').trim();

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
    shell.openExternal(url);
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
  tray.setToolTip('Task Pool Manager');
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
