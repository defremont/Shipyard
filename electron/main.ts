import { app, BrowserWindow, Tray, Menu, nativeImage, shell, dialog } from 'electron';
import { join, resolve } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { fork, type ChildProcess } from 'child_process';

// ── Paths ──────────────────────────────────────────────────────────

const isDev = !app.isPackaged;

const ROOT_DIR = isDev
  ? resolve(__dirname, '..')
  : resolve(process.resourcesPath);

const CLIENT_DIST = isDev
  ? resolve(ROOT_DIR, 'client', 'dist')
  : resolve(process.resourcesPath, 'app', 'client', 'dist');

const SERVER_ENTRY = isDev
  ? resolve(ROOT_DIR, 'server', 'src', 'index.ts')
  : resolve(process.resourcesPath, 'app', 'server', 'dist', 'index.js');

const ICON_PATH = isDev
  ? resolve(ROOT_DIR, 'assets', 'icon.png')
  : resolve(process.resourcesPath, 'icon.png');

// Data directory: use AppData in production, project root in dev
const DATA_DIR = isDev
  ? resolve(ROOT_DIR, 'data')
  : resolve(app.getPath('userData'), 'data');

// Ensure data directory exists
mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(join(DATA_DIR, 'tasks'), { recursive: true });

// ── Server process ─────────────────────────────────────────────────

const PORT = 5420;
let serverProcess: ChildProcess | null = null;

function startServer(): Promise<void> {
  return new Promise((res, reject) => {
    const env = {
      ...process.env,
      DEVDASH_ELECTRON: '1',
      DEVDASH_DATA_DIR: DATA_DIR,
      DEVDASH_STATIC_DIR: CLIENT_DIST,
      DEVDASH_PORT: String(PORT),
      DEVDASH_HOST: '127.0.0.1',
    };

    if (isDev) {
      // In dev, use tsx to run TypeScript directly
      const tsxBin = resolve(ROOT_DIR, 'node_modules', '.bin', 'tsx');
      serverProcess = fork(SERVER_ENTRY, [], {
        env,
        execArgv: [],
        execPath: tsxBin,
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      });
    } else {
      // In production, run compiled JS with Node
      serverProcess = fork(SERVER_ENTRY, [], {
        env,
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      });
    }

    let started = false;
    const timeout = setTimeout(() => {
      if (!started) {
        started = true;
        // Even without confirmation, try to connect after 3s
        res();
      }
    }, 3000);

    serverProcess.stdout?.on('data', (data: Buffer) => {
      const msg = data.toString();
      console.log('[Server]', msg.trim());
      if (!started && msg.includes('listening')) {
        started = true;
        clearTimeout(timeout);
        res();
      }
    });

    serverProcess.stderr?.on('data', (data: Buffer) => {
      console.error('[Server]', data.toString().trim());
    });

    serverProcess.on('error', (err) => {
      if (!started) {
        started = true;
        clearTimeout(timeout);
        reject(err);
      }
    });

    serverProcess.on('exit', (code) => {
      console.log(`[Server] Process exited with code ${code}`);
      serverProcess = null;
    });

    // Also listen for Fastify's log format (JSON with msg field)
    serverProcess.stdout?.on('data', (data: Buffer) => {
      const msg = data.toString();
      if (!started && (msg.includes(`${PORT}`) || msg.includes('Server listening'))) {
        started = true;
        clearTimeout(timeout);
        res();
      }
    });
  });
}

function stopServer() {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
}

// ── Window ─────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'DevDash',
    icon: existsSync(ICON_PATH) ? ICON_PATH : undefined,
    backgroundColor: '#09090b',
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // In dev mode with Vite, load from dev server; otherwise from Fastify
  if (isDev && process.env.VITE_DEV_SERVER) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER);
  } else {
    mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    if (isDev) {
      mainWindow?.webContents.openDevTools({ mode: 'detach' });
    }
  });

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Minimize to tray instead of closing
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── Tray ───────────────────────────────────────────────────────────

function createTray() {
  const icon = existsSync(ICON_PATH)
    ? nativeImage.createFromPath(ICON_PATH).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty();

  tray = new Tray(icon);
  tray.setToolTip('DevDash');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show DevDash',
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

// ── App lifecycle ──────────────────────────────────────────────────

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.on('before-quit', () => {
    isQuitting = true;
    stopServer();
  });

  app.whenReady().then(async () => {
    try {
      await startServer();
      createWindow();
      createTray();
    } catch (err) {
      console.error('[Electron] Failed to start:', err);
      dialog.showErrorBox(
        'DevDash - Failed to Start',
        `Could not start the server.\n\n${err instanceof Error ? err.message : String(err)}`
      );
      app.quit();
    }
  });

  app.on('window-all-closed', () => {
    // Keep running in tray on all platforms
  });

  app.on('activate', () => {
    if (mainWindow === null) {
      createWindow();
    } else {
      mainWindow.show();
    }
  });
}
