import { app, BrowserWindow, Tray, Menu, nativeImage, shell, dialog, type MenuItemConstructorOptions } from 'electron';
import { join, resolve } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { spawn, execSync, type ChildProcess } from 'child_process';
import { request } from 'http';
import { homedir, platform as osPlatform } from 'os';

// ── PATH fix for GUI launch on Linux/macOS ─────────────────────────
// GUI-launched apps on Linux/macOS do NOT inherit shell PATH (no .bashrc/.zshrc).
// That breaks detection of user-installed CLIs like `claude`, `git`, `pnpm`, etc.
// We read PATH from the user's login shell and prepend common install locations.
function fixPathForGuiLaunch() {
  if (osPlatform() === 'win32') return;

  // Try to read PATH from the user's login+interactive shell
  try {
    const shell = process.env.SHELL || '/bin/bash';
    const output = execSync(`${shell} -ilc 'printf "%s" "$PATH"'`, {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (output) {
      process.env.PATH = output;
      console.log('[Electron] PATH restored from user shell');
    }
  } catch (err) {
    console.warn('[Electron] Could not read shell PATH:', (err as Error).message);
  }

  // Always append common install locations (in case shell config is minimal)
  const home = homedir();
  const existing = (process.env.PATH || '').split(':').filter(Boolean);
  const common = [
    `${home}/.npm-global/bin`,
    `${home}/.local/bin`,
    `${home}/bin`,
    `${home}/.volta/bin`,
    `${home}/.bun/bin`,
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/usr/bin',
    '/bin',
  ];
  for (const p of common) if (!existing.includes(p)) existing.push(p);
  process.env.PATH = existing.join(':');
}

fixPathForGuiLaunch();

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

// Use different port than dev server (5420) to avoid conflicts
const PORT = isDev ? 5420 : 5430;
let serverProcess: ChildProcess | null = null;

/** HTTP GET health check — resolves true if server responds, false on error */
function checkServerReady(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = request(
      { hostname: '127.0.0.1', port: PORT, path: '/api/settings', method: 'GET', timeout: 1000 },
      (res) => {
        res.resume(); // drain response
        resolve(res.statusCode !== undefined && res.statusCode < 500);
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

/** Poll the server with HTTP requests until it responds or we give up */
async function waitForServer(maxAttempts = 30, intervalMs = 500): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    if (await checkServerReady()) {
      console.log(`[Electron] Server confirmed ready (attempt ${i + 1})`);
      return;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  console.log('[Electron] Server health check timed out, proceeding anyway');
}

function startServer(): Promise<void> {
  return new Promise((res, reject) => {
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      SHIPYARD_ELECTRON: '1',
      SHIPYARD_DATA_DIR: DATA_DIR,
      SHIPYARD_STATIC_DIR: CLIENT_DIST,
      SHIPYARD_PORT: String(PORT),
      SHIPYARD_HOST: '127.0.0.1',
    };

    console.log('[Electron] Paths:');
    console.log('  SERVER_ENTRY:', SERVER_ENTRY);
    console.log('  CLIENT_DIST:', CLIENT_DIST);
    console.log('  DATA_DIR:', DATA_DIR);
    console.log('  isDev:', isDev);
    console.log('  exists(SERVER_ENTRY):', existsSync(SERVER_ENTRY));
    console.log('  exists(CLIENT_DIST):', existsSync(CLIENT_DIST));

    if (isDev) {
      // In dev, use tsx to run TypeScript directly
      const tsxBin = resolve(ROOT_DIR, 'node_modules', '.bin', 'tsx');
      const { fork } = require('child_process');
      serverProcess = fork(SERVER_ENTRY, [], {
        env,
        execArgv: [],
        execPath: tsxBin,
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      });
    } else {
      // In production, use spawn with ELECTRON_RUN_AS_NODE to run as plain Node.js
      // fork() in packaged Electron can be unreliable
      env.ELECTRON_RUN_AS_NODE = '1';
      serverProcess = spawn(process.execPath, [SERVER_ENTRY], {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    }

    const proc = serverProcess!;
    let started = false;

    proc.stdout?.on('data', (data: Buffer) => {
      const msg = data.toString();
      console.log('[Server]', msg.trim());
      // Match our console.log: "Shipyard server running on http://..."
      if (!started && (msg.includes('running on') || msg.includes(`${PORT}`))) {
        started = true;
        // Server reported ready via stdout — confirm with HTTP health check
        waitForServer(10, 300).then(() => res());
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      console.error('[Server:err]', data.toString().trim());
    });

    proc.on('error', (err) => {
      console.error('[Electron] Server spawn error:', err);
      if (!started) {
        started = true;
        reject(err);
      }
    });

    proc.on('exit', (code) => {
      console.log(`[Server] Process exited with code ${code}`);
      serverProcess = null;
      if (!started) {
        started = true;
        reject(new Error(`Server exited with code ${code}`));
      }
    });

    // Fallback: if stdout never matches, poll with HTTP health checks
    setTimeout(() => {
      if (!started) {
        started = true;
        console.log('[Electron] Stdout detection timed out, falling back to HTTP polling');
        waitForServer().then(() => res());
      }
    }, 5000);
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
    title: 'Shipyard',
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

  // Retry loading if the page fails (server not ready yet)
  let loadRetries = 0;
  const maxLoadRetries = 5;
  const serverUrl = isDev && process.env.VITE_DEV_SERVER
    ? process.env.VITE_DEV_SERVER
    : `http://127.0.0.1:${PORT}`;

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDesc) => {
    if (loadRetries < maxLoadRetries) {
      loadRetries++;
      console.log(`[Electron] Page load failed (${errorDesc}), retry ${loadRetries}/${maxLoadRetries}...`);
      setTimeout(() => {
        mainWindow?.loadURL(serverUrl);
      }, 1000 * loadRetries);
    } else {
      console.error(`[Electron] Page load failed after ${maxLoadRetries} retries: ${errorDesc}`);
    }
  });

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

  // Intercept in-page navigation (e.g. clicking <a href="..."> without target="_blank")
  mainWindow.webContents.on('will-navigate', (event, url) => {
    // Allow same-origin navigation (e.g. React Router, hash changes)
    const currentURL = mainWindow?.webContents.getURL() || '';
    const isSameOrigin = new URL(url).origin === new URL(currentURL).origin;
    if (!isSameOrigin && url.startsWith('http')) {
      event.preventDefault();
      shell.openExternal(url);
    }
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

// ── Application menu ───────────────────────────────────────────────

/** Send a menu action to the renderer (shows the window first if hidden) */
function sendMenuAction(action: string) {
  if (!mainWindow) return;
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send('menu-action', action);
}

function createApplicationMenu() {
  const isMac = process.platform === 'darwin';

  // Shortcuts like Ctrl+K / Ctrl+Shift+F / Ctrl+` are already handled by the
  // renderer's keydown listeners. registerAccelerator: false (Win/Linux) keeps
  // the hint visible in the menu without double-triggering; clicking the menu
  // item itself sends the action over IPC.
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Dashboard', accelerator: 'CmdOrCtrl+Shift+D', click: () => sendMenuAction('navigate:/') },
        { label: 'Tasks', click: () => sendMenuAction('navigate:/tasks') },
        { type: 'separator' },
        { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: () => sendMenuAction('navigate:/settings') },
        { type: 'separator' },
        isMac ? { role: 'close' as const } : {
          label: 'Quit',
          accelerator: 'CmdOrCtrl+Q',
          click: () => { isQuitting = true; app.quit(); },
        },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Global Search', accelerator: 'CmdOrCtrl+K', registerAccelerator: false, click: () => sendMenuAction('toggle-search') },
        { label: 'Search in Files', accelerator: 'CmdOrCtrl+Shift+F', registerAccelerator: false, click: () => sendMenuAction('toggle-file-search') },
        { label: 'Toggle Terminal', accelerator: 'CmdOrCtrl+`', registerAccelerator: false, click: () => sendMenuAction('toggle-terminal') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Help & Documentation', click: () => sendMenuAction('navigate:/help') },
        { label: 'Logs', click: () => sendMenuAction('navigate:/logs') },
        { type: 'separator' },
        {
          label: 'GitHub Repository',
          click: () => { shell.openExternal('https://github.com/defremont/Shipyard'); },
        },
        { label: `Shipyard v${app.getVersion()}`, enabled: false },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── Tray ───────────────────────────────────────────────────────────

function createTray() {
  const icon = existsSync(ICON_PATH)
    ? nativeImage.createFromPath(ICON_PATH).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty();

  tray = new Tray(icon);
  tray.setToolTip('Shipyard');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Shipyard',
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
      createApplicationMenu();
      createTray();
    } catch (err) {
      console.error('[Electron] Failed to start:', err);
      dialog.showErrorBox(
        'Shipyard - Failed to Start',
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
