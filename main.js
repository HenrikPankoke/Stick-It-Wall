'use strict';

const {
  app, BrowserWindow, Tray, Menu, ipcMain, dialog, screen, nativeImage
} = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { noteIconPNG } = require('./icon');

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
const DATA_DIR = app.getPath('userData');
const DATA_FILE = path.join(DATA_DIR, 'stick-it-wall.json');
const BG_DIR = path.join(DATA_DIR, 'backgrounds');

// The app was previously named "Post-It Wall" (renamed for trademark reasons),
// which put user data under a differently-named folder. One-time best-effort
// migration so existing notes aren't orphaned by the rename.
// Derived as a sibling of the (possibly test-overridden) userData dir rather
// than the real appData path directly, so tests using an isolated temp
// userData dir never see real user data leak in.
const OLD_DATA_DIR = path.join(path.dirname(DATA_DIR), 'post-it-wall');
function migrateOldData() {
  try {
    if (fs.existsSync(DATA_FILE)) return; // already have data in the new location
    const oldFile = path.join(OLD_DATA_DIR, 'postit-wall.json');
    if (!fs.existsSync(oldFile)) return;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.copyFileSync(oldFile, DATA_FILE);
    const oldBg = path.join(OLD_DATA_DIR, 'backgrounds');
    if (fs.existsSync(oldBg)) fs.cpSync(oldBg, BG_DIR, { recursive: true });
  } catch (_) { /* best-effort; a missing/partial migration just starts fresh */ }
}

const DEFAULT_DATA = {
  version: 1,
  settings: {
    background: {
      type: 'pattern',      // 'none' | 'pattern' | 'image' | 'color'
      value: 'cork',        // pattern id, file path, or css color
      opacity: 1,           // 0..1  (applies to image/pattern/color layer)
      fit: 'tile'           // 'tile' | 'cover'  (for images)
    },
    clickThrough: false,     // pass clicks to the desktop when over empty wall
    bounds: null,            // {x,y,width,height} restored on launch
    wallVisible: true,       // shown/hidden state restored on next launch
    windowPresets: [null, null, null, null, null]   // 5 saved {x,y,width,height} slots
  },
  headers: [],
  notes: []
};

function ensureDirs() {
  try { fs.mkdirSync(BG_DIR, { recursive: true }); } catch (_) { /* ignore */ }
}

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    // shallow-merge to survive older/partial files
    return {
      ...DEFAULT_DATA,
      ...parsed,
      settings: { ...DEFAULT_DATA.settings, ...(parsed.settings || {}) }
    };
  } catch (_) {
    return JSON.parse(JSON.stringify(DEFAULT_DATA));
  }
}

function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Failed to save data:', err);
    return false;
  }
}

let state = null;          // in-memory copy of the persisted document
let win = null;
let tray = null;
let suppressDirty = false; // true while a preset load is programmatically moving the window

// ---------------------------------------------------------------------------
// Window bounds helpers
// ---------------------------------------------------------------------------
// A sane default placement/size, offset from a display's work-area corner.
function defaultBounds(workArea, sizeHint) {
  return {
    x: workArea.x + 60,
    y: workArea.y + 60,
    width: Math.min((sizeHint && sizeHint.width) || 1100, workArea.width - 120),
    height: Math.min((sizeHint && sizeHint.height) || 720, workArea.height - 120)
  };
}

// Keep bounds fully inside a display's current work area (resolution/taskbar
// may have changed since the bounds were captured).
function clampToWorkArea(bounds, workArea) {
  const width = Math.min(bounds.width, workArea.width);
  const height = Math.min(bounds.height, workArea.height);
  const maxX = workArea.x + workArea.width - width;
  const maxY = workArea.y + workArea.height - height;
  return {
    x: Math.round(Math.min(Math.max(bounds.x, workArea.x), maxX)),
    y: Math.round(Math.min(Math.max(bounds.y, workArea.y), maxY)),
    width: Math.round(width),
    height: Math.round(height)
  };
}

function notifyBoundsDirty() {
  if (suppressDirty) return;
  if (win && !win.isDestroyed()) win.webContents.send('window:bounds-dirty');
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
function createWindow() {
  const primary = screen.getPrimaryDisplay().workArea;
  const saved = state.settings.bounds;

  const bounds = saved && Number.isFinite(saved.width)
    ? saved
    : defaultBounds(primary);

  win = new BrowserWindow({
    ...bounds,
    minWidth: 320,
    minHeight: 240,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,       // tray-only app: no taskbar entry
    show: state.settings.wallVisible !== false,   // restore whatever visibility it had when last closed
    title: 'Stick-It Wall',
    icon: appIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,   // keep saves/timers alive while unfocused
      sandbox: false
    }
  });

  win.setMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  const persistBounds = () => {
    if (!win || win.isDestroyed()) return;
    state.settings.bounds = win.getBounds();
    saveData(state);
    notifyBoundsDirty();
  };
  win.on('moved', persistBounds);
  win.on('resized', persistBounds);

  win.on('show', () => { state.settings.wallVisible = true; saveData(state); });
  win.on('hide', () => { state.settings.wallVisible = false; saveData(state); });

  win.on('closed', () => { win = null; });
}

function toggleWindowVisibility() {
  if (!win) return createWindow();
  if (win.isVisible()) win.hide();
  else win.show();
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------
function noteIcon(size) {
  return nativeImage.createFromBuffer(noteIconPNG(size), { width: size, height: size });
}

function trayIcon() { return noteIcon(32); }
function appIcon() { return noteIcon(256); }

function getStartWithWindows() {
  return app.getLoginItemSettings().openAtLogin;
}

function setStartWithWindows(enabled) {
  // In dev (running via `electron .`) execPath is the electron binary itself,
  // so it needs the app path as an argument to relaunch correctly.
  const args = app.isPackaged ? [] : [__dirname];
  app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath, args });
}

function buildTrayMenu() {
  const bg = state.settings.background;
  return Menu.buildFromTemplate([
    { label: 'Add note', click: () => win && win.webContents.send('cmd:add-note') },
    { label: 'Add header', click: () => win && win.webContents.send('cmd:add-header') },
    { type: 'separator' },
    {
      label: 'Background',
      submenu: [
        { label: 'Cork board', type: 'radio', checked: bg.type === 'pattern' && bg.value === 'cork', click: () => setBackground({ type: 'pattern', value: 'cork' }) },
        { label: 'Linen', type: 'radio', checked: bg.type === 'pattern' && bg.value === 'linen', click: () => setBackground({ type: 'pattern', value: 'linen' }) },
        { label: 'Paper grid', type: 'radio', checked: bg.type === 'pattern' && bg.value === 'grid', click: () => setBackground({ type: 'pattern', value: 'grid' }) },
        { label: 'Dark slate', type: 'radio', checked: bg.type === 'pattern' && bg.value === 'slate', click: () => setBackground({ type: 'pattern', value: 'slate' }) },
        { type: 'separator' },
        { label: 'Custom image…', click: pickBackgroundImage },
        { label: 'Transparent (no background)', type: 'radio', checked: bg.type === 'none', click: () => setBackground({ type: 'none' }) }
      ]
    },
    {
      label: 'Click-through when transparent',
      type: 'checkbox',
      checked: !!state.settings.clickThrough,
      enabled: state.settings.background.type === 'none',
      click: (item) => {
        state.settings.clickThrough = item.checked;
        saveData(state);
        win && win.webContents.send('settings:changed', state.settings);
      }
    },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: getStartWithWindows(),
      click: (item) => setStartWithWindows(item.checked)
    },
    { type: 'separator' },
    { label: 'Show / Hide wall', click: toggleWindowVisibility },
    { label: 'Reset window size', click: resetWindowBounds },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.quit(); } }
  ]);
}

function refreshTray() {
  if (tray) tray.setContextMenu(buildTrayMenu());
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('Stick-It Wall');
  tray.on('click', () => toggleWindowVisibility());
  refreshTray();
}

// ---------------------------------------------------------------------------
// Background helpers
// ---------------------------------------------------------------------------
function setBackground(patch) {
  state.settings.background = { ...state.settings.background, ...patch };
  saveData(state);
  refreshTray();
  win && win.webContents.send('settings:changed', state.settings);
}

async function pickBackgroundImage() {
  if (!win) return;
  const res = await dialog.showOpenDialog(win, {
    title: 'Choose a wall background image',
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
    properties: ['openFile']
  });
  if (res.canceled || !res.filePaths.length) return;
  setBackground({ type: 'image', value: res.filePaths[0] });
}

function resetWindowBounds() {
  if (!win) return;
  win.setBounds(defaultBounds(screen.getPrimaryDisplay().workArea));
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
ipcMain.handle('data:load', () => state);

ipcMain.handle('data:save', (_e, doc) => {
  // Renderer owns notes/headers; keep settings authoritative here but accept updates.
  state.notes = Array.isArray(doc.notes) ? doc.notes : state.notes;
  state.headers = Array.isArray(doc.headers) ? doc.headers : state.headers;
  if (doc.settings) {
    const incoming = { ...doc.settings };
    delete incoming.bounds;          // main owns window bounds; never let a stale copy clobber it
    delete incoming.wallVisible;     // main owns visibility too — same reason
    state.settings = { ...state.settings, ...incoming };
  }
  const ok = saveData(state);
  refreshTray();
  return ok;
});

ipcMain.handle('settings:get', () => state.settings);

ipcMain.handle('settings:set', (_e, patch) => {
  state.settings = { ...state.settings, ...patch };
  if (patch.background) refreshTray();
  saveData(state);
  win && win.webContents.send('settings:changed', state.settings);
  return state.settings;
});

ipcMain.handle('bg:pick', async () => {
  await pickBackgroundImage();
  return state.settings;
});

// Resolve a background image path to a file:// URL the renderer can use.
ipcMain.handle('bg:url', (_e, filePath) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    return pathToFileURL(filePath).href;
  } catch (_) {
    return null;
  }
});

ipcMain.on('window:set-ignore-mouse', (_e, ignore, opts) => {
  if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(!!ignore, opts || {});
});

ipcMain.handle('window:get-bounds', () => (win ? win.getBounds() : null));

let boundsSaveTimer = null;
ipcMain.on('window:set-bounds', (_e, bounds) => {
  if (!win || win.isDestroyed()) return;
  const b = win.getBounds();
  const next = {
    x: Math.round(Number.isFinite(bounds.x) ? bounds.x : b.x),
    y: Math.round(Number.isFinite(bounds.y) ? bounds.y : b.y),
    width: Math.max(320, Math.round(Number.isFinite(bounds.width) ? bounds.width : b.width)),
    height: Math.max(240, Math.round(Number.isFinite(bounds.height) ? bounds.height : b.height))
  };
  win.setBounds(next);
  // Programmatic setBounds does not reliably emit 'resized'/'moved', so persist here.
  state.settings.bounds = next;
  clearTimeout(boundsSaveTimer);
  boundsSaveTimer = setTimeout(() => saveData(state), 400);
  notifyBoundsDirty();
});

ipcMain.handle('window:save-preset', (_e, index) => {
  if (!win || win.isDestroyed()) return null;
  if (!Array.isArray(state.settings.windowPresets)) state.settings.windowPresets = [null, null, null, null, null];
  const bounds = win.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const preset = { ...bounds, display: { id: display.id, workArea: display.workArea } };
  state.settings.windowPresets[index] = preset;
  saveData(state);
  return preset;
});

ipcMain.handle('window:load-preset', (_e, index) => {
  if (!win || win.isDestroyed()) return null;
  const presets = state.settings.windowPresets;
  const preset = Array.isArray(presets) ? presets[index] : null;
  if (!preset) return null;

  const raw = { x: preset.x, y: preset.y, width: preset.width, height: preset.height };
  let target;
  if (preset.display && preset.display.id != null) {
    const match = screen.getAllDisplays().find(d => d.id === preset.display.id);
    target = match
      ? clampToWorkArea(raw, match.workArea)
      : defaultBounds(screen.getPrimaryDisplay().workArea, raw);
  } else {
    // Preset predates display tracking — best effort against whichever display it lands on.
    target = clampToWorkArea(raw, screen.getDisplayMatching(raw).workArea);
  }

  suppressDirty = true;
  win.setBounds(target);
  state.settings.bounds = win.getBounds();
  saveData(state);
  setTimeout(() => { suppressDirty = false; }, 100);
  return target;
});

ipcMain.on('window:close', () => { app.quit(); });
ipcMain.on('window:minimize', () => { win && win.minimize(); });

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
// Matches build.appId in package.json — lets packaged Windows builds group
// taskbar/notifications and label the Start-with-Windows entry correctly.
app.setAppUserModelId('com.stickitwall.app');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { win.show(); win.focus(); }
  });

  app.whenReady().then(() => {
    ensureDirs();
    migrateOldData();
    state = loadData();
    createWindow();
    createTray();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  // Keep running in the tray even when the window is closed/hidden.
  app.on('window-all-closed', (e) => {
    // Do not quit; the tray keeps the app alive. Quit is explicit via tray menu.
  });
}
