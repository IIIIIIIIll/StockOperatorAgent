// Electron main process (plain JS, zero TS imports; package.json type=module).
//
// Architecture: the Node backend runs in a self-spawned child
// (desktop/child.mjs) launched as ELECTRON_RUN_AS_NODE=1 with
// --experimental-strip-types (flag passed via argv, not env writes). Reason:
// the backend imports TS sources (src/store-node.ts), and whether the Electron
// main process can consume that flag is unproven — so the main process stays
// dependency-free of TS and merely relays IPC between renderer and child.
//
// Lifecycle: spawn child -> wait ready (port + settings) -> create window
// loading http://127.0.0.1:<port>/ ; window-all-closed -> send shutdown ->
// child flushes + exits -> app.quit(); 3s SIGKILL fallback; unexpected child
// exit -> console.error + app.quit().
// Single instance: requestSingleInstanceLock() runs at import time, before any
// mkdir/spawn. A second launch quits immediately; the running instance focuses
// its window on 'second-instance'. Without the lock, two children would each
// hold an independent in-memory mirror and race whole-file rewrites of the
// same userData <ticker>.json / meta.json (lost updates + torn-write window).
//
// Run: first `cd app && npx expo export --platform web` to build dist, then
// `cd desktop && npm start`.
//
// IPC:
//   renderer -> main: invoke 'desktop:store-init' -> snapshot
//                     invoke 'desktop:store-op' (op, args) -> ack
//                     invoke 'desktop:settings-save-async' (json) -> cache + child
//                     sendSync 'desktop:settings-load' -> cached settings
//                     (load is cold-path only; save is async — sendSync in
//                     React event handlers intermittently deadlocks, see
//                     app/lib/desktopBridge.ts header)
//   main -> child: {type:'op', id, op, args} | {type:'snapshot', id}
//                  | {type:'settings-save', json} | {type:'shutdown'}
//   child -> main: {type:'ready', port, settings} | {type:'ack', id}
//                  | {type:'snapshot', id, snapshot} | {type:'settings-saved'}
//                  | {type:'error', id?, message}

import { app, BrowserWindow, ipcMain } from 'electron';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CHILD_PATH = fileURLToPath(new URL('./child.mjs', import.meta.url));
const PRELOAD_PATH = fileURLToPath(new URL('./preload.cjs', import.meta.url));
const CHILD_READY_TIMEOUT_MS = 15000;
const CHILD_KILL_GRACE_MS = 3000;
const QUIT_FALLBACK_MS = 5000;

// The 6 store mutators the renderer may forward (renderer input is not
// trusted: anything else is rejected before reaching the child).
const STORE_OPS = new Set([
  'putStock',
  'addDatas',
  'addPerformanceReports',
  'updateOverview',
  'replaceDatas',
  'setMeta',
]);

let child = null;
let childPort = null; // backend HTTP port, filled on ready
let settingsCache = null; // settings JSON text, sendSync-served from cache
let onChildReady = null; // pending waitChildReady resolver
let quitting = false;
let msgId = 0;
const pendingOps = new Map(); // op id -> {resolve, reject}
const pendingSnapshots = new Map(); // snapshot id -> {resolve, reject}
let mainWindow = null; // BrowserWindow ref; focused by 'second-instance' below

// --- single instance ---------------------------------------------------------
// Module scope = before whenReady/mkdir/spawn ever run (Electron standard
// pattern). The loser quits without creating dirs or spawning a child.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function nextId() {
  msgId += 1;
  return msgId;
}

function sendChild(msg) {
  if (child && child.connected) {
    try {
      child.send(msg);
    } catch {
      /* channel closing — ignore */
    }
  }
}

// --- child lifecycle -------------------------------------------------------

function spawnChild(storeDir, settingsDir, logDir) {
  child = spawn(
    process.execPath,
    [
      '--experimental-strip-types',
      CHILD_PATH,
      '--store-dir',
      storeDir,
      '--settings-dir',
      settingsDir,
      '--log-dir',
      logDir,
    ],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    },
  );
  child.stdout.on('data', (d) => process.stdout.write(`[child] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[child] ${d}`));

  child.on('message', (msg) => {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'ready': {
        childPort = msg.port;
        settingsCache = msg.settings;
        console.log(`[main] child ready: http://127.0.0.1:${childPort}`);
        if (onChildReady) {
          onChildReady();
          onChildReady = null;
        }
        break;
      }
      case 'ack': {
        const p = pendingOps.get(msg.id);
        if (p) {
          pendingOps.delete(msg.id);
          p.resolve();
        }
        break;
      }
      case 'snapshot': {
        const p = pendingSnapshots.get(msg.id);
        if (p) {
          pendingSnapshots.delete(msg.id);
          p.resolve(msg.snapshot);
        }
        break;
      }
      case 'error': {
        const p = pendingOps.get(msg.id) ?? pendingSnapshots.get(msg.id);
        if (p) {
          pendingOps.delete(msg.id);
          pendingSnapshots.delete(msg.id);
          p.reject(new Error(msg.message));
        } else {
          console.error(`[child] ${msg.message}`);
        }
        break;
      }
      case 'settings-saved':
        break;
      default:
        break;
    }
  });

  child.on('exit', (code, signal) => {
    console.log(`[main] child exited (code=${code}, signal=${signal})`);
    child = null;
    const err = new Error('backend child exited');
    for (const [, p] of pendingOps) p.reject(err);
    pendingOps.clear();
    for (const [, p] of pendingSnapshots) p.reject(err);
    pendingSnapshots.clear();
    if (!quitting) console.error('[main] child exited unexpectedly — quitting');
    app.quit();
  });

  child.on('error', (err) => {
    console.error('[main] child spawn error:', err);
    app.quit();
  });
}

function waitChildReady(timeoutMs) {
  return new Promise((resolve, reject) => {
    if (childPort !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      onChildReady = null;
      reject(new Error(`child not ready within ${timeoutMs}ms`));
    }, timeoutMs);
    onChildReady = () => {
      clearTimeout(timer);
      resolve();
    };
  });
}

// Graceful teardown: ask child to flush + exit, SIGKILL after grace, and never
// leave the app alive without a backend.
function shutdownChild() {
  if (quitting) return;
  quitting = true;
  console.log('[main] shutting down backend child');
  sendChild({ type: 'shutdown' });
  const killTimer = setTimeout(() => {
    if (child && child.exitCode === null && child.signalCode === null) {
      console.error('[main] child did not exit within 3s; sending SIGKILL');
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    }
  }, CHILD_KILL_GRACE_MS);
  killTimer.unref?.();
  const quitTimer = setTimeout(() => {
    console.error('[main] child never exited; quitting anyway');
    app.quit();
  }, QUIT_FALLBACK_MS);
  quitTimer.unref?.();
}

// --- IPC bridge (renderer <-> child) ----------------------------------------

function registerIpc() {
  ipcMain.handle('desktop:store-init', () => {
    if (!child) throw new Error('backend child not running');
    const id = nextId();
    return new Promise((resolve, reject) => {
      pendingSnapshots.set(id, { resolve, reject });
      sendChild({ type: 'snapshot', id });
      const timer = setTimeout(() => {
        if (pendingSnapshots.delete(id)) reject(new Error('snapshot request timed out'));
      }, CHILD_READY_TIMEOUT_MS);
      timer.unref?.();
    });
  });

  ipcMain.handle('desktop:store-op', (_event, op, args) => {
    if (!STORE_OPS.has(op)) throw new Error(`unsupported store op: ${op}`);
    if (!Array.isArray(args)) throw new Error('store-op args must be an array');
    if (!child) throw new Error('backend child not running');
    const id = nextId();
    return new Promise((resolve, reject) => {
      pendingOps.set(id, { resolve, reject });
      sendChild({ type: 'op', id, op, args });
      // Rare IPC loss must surface as an error, never hang the renderer queue.
      const timer = setTimeout(() => {
        if (pendingOps.delete(id)) reject(new Error(`store op timed out: ${op}`));
      }, CHILD_READY_TIMEOUT_MS);
      timer.unref?.();
    });
  });

  ipcMain.on('desktop:settings-load', (event) => {
    event.returnValue = settingsCache;
  });

  // async on purpose: sendSync in renderer event handlers intermittently
  // deadlocks (08-16-desktop-app empirical finding); invoke never blocks.
  ipcMain.handle('desktop:settings-save-async', (_event, json) => {
    const text = typeof json === 'string' ? json : JSON.stringify(json);
    settingsCache = text; // cache first so a subsequent sync load sees it
    sendChild({ type: 'settings-save', json: text });
    return true;
  });
}

// --- window -----------------------------------------------------------------

function createWindow(port) {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  // Security baseline: the SPA must never navigate away from the app origin
  // and must not open any new windows (only the initial loadURL is allowed).
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // Relay renderer console to stdout (desktop has no visible devtools by default).
  win.webContents.on('console-message', (_e, level, message) => {
    console.log(`[renderer:${level}] ${message}`);
  });
  win.on('closed', () => {
    mainWindow = null; // let 'second-instance' know the window is gone
  });
  mainWindow = win;
  void win.loadURL(`http://127.0.0.1:${port}/`);
}

// --- app lifecycle -----------------------------------------------------------

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return; // lock loser: app.quit() already requested — never mkdir/spawn
  const userData = app.getPath('userData');
  const storeDir = path.join(userData, 'store');
  const settingsDir = path.join(userData, 'settings');
  const logDir = path.join(userData, 'logs');
  for (const dir of [storeDir, settingsDir, logDir]) mkdirSync(dir, { recursive: true });

  spawnChild(storeDir, settingsDir, logDir);
  registerIpc();

  try {
    await waitChildReady(CHILD_READY_TIMEOUT_MS);
  } catch (err) {
    console.error(`[main] ${err.message}`);
    if (child) {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
    }
    app.exit(1);
    return;
  }
  createWindow(childPort);
});

app.on('window-all-closed', () => {
  shutdownChild();
});

// Termination signals: route into the same graceful path (flush + close +
// exit) so kill -TERM / Ctrl+C never loses writes and exits cleanly (0).
// Without this, a process-tree kill takes the child down mid-write and the
// wrapper reports a non-zero exit.
process.on('SIGTERM', () => shutdownChild());
process.on('SIGINT', () => shutdownChild());
