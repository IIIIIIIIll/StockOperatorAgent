// Desktop Node backend child process.
//
// Launched by desktop/main.mjs as plain Node (ELECTRON_RUN_AS_NODE=1) with
// --experimental-strip-types so it can import TS sources (src/store-node.ts)
// directly; the three data dirs arrive via argv (no process.env writes, per
// the repo architecture contract). This keeps the Electron main process
// dependency-free of TS and of the strip-types flag.
//
// Responsibilities:
//   1. Serve app/dist + same-origin proxies through createAppServer() on a
//      random 127.0.0.1 port (listen(0) — caller-owned listen).
//   2. Own the FileStore (node fs adapter, createNodeFileStore): apply the 6
//      store-op mutators and answer snapshot requests for renderer hydration.
//   3. Persist settings with nodeSettingsFileSystem semantics — the exact
//      file shape of the settingsStore.ts node branch:
//      <settings-dir>/soa-settings.json, File.exists/create/write.
//   4. Inject the log directory via setLogDir (logs-server.cjs explicit
//      injection surface).
//
// IPC contract with main.mjs (process.send / on('message')):
//   child -> main: {type:'ready', port, settings} | {type:'ack', id}
//                  | {type:'snapshot', id, snapshot} | {type:'settings-saved'}
//                  | {type:'error', id?, message}
//   main -> child: {type:'op', id, op, args} | {type:'snapshot', id}
//                  | {type:'settings-save', json} | {type:'shutdown'}
//   {type:'op'} args are shape-validated (STORE_OP_VALIDATORS below) before
//   dispatch — malformed or path-separator-bearing args never reach the store.
// Snapshot = {stocks, datas, reports, meta} four Records, JSON-safe
// (listStocks/listMetaKeys enumeration + existing getters serialized).
//
// Usage: spawned by desktop/main.mjs; not meant to run standalone.

import { mkdirSync } from 'node:fs';
import { createAppServer } from '../app/server.mjs';
import { setLogDir } from '../app/lib/logs-server.cjs';
import { createNodeFileStore, nodeSettingsFileSystem } from '../src/store-node.ts';

// Aligned with app/lib/settingsStore.ts RN_SETTINGS_FILE.
const SETTINGS_FILE = 'soa-settings.json';

// --- argv parsing: --store-dir <dir> --settings-dir <dir> --log-dir <dir> ---
function parseArgv(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--store-dir' || flag === '--settings-dir' || flag === '--log-dir') {
      out[flag.slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return out;
}

const { 'store-dir': storeDir, 'settings-dir': settingsDir, 'log-dir': logDir } =
  parseArgv(process.argv.slice(2));
for (const dir of [storeDir, settingsDir, logDir]) {
  if (!dir) {
    console.error('[child] missing required argv: --store-dir/--settings-dir/--log-dir');
    process.exit(1);
  }
  mkdirSync(dir, { recursive: true });
}

// IPC send with a dead-channel guard (main may exit while we are mid-shutdown).
function send(msg) {
  if (process.send) {
    try {
      process.send(msg);
    } catch {
      /* channel already closed — nothing to deliver */
    }
  }
}

let shuttingDown = false;
let store = null;
let server = null;
let settingsFs = null;

// Flush pending writes, close store + server, then exit. Used by both the
// shutdown message and parent disconnect, so no orphan survives main's death.
function gracefulShutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  void (async () => {
    try {
      await store.flush();
    } catch {
      /* drain failure must not block exit */
    }
    store.close();
    server.close();
    process.exit(0);
  })();
}

// Snapshot: enumerate keys then serialize through existing getters (JSON-safe).
function buildSnapshot() {
  const stocks = {};
  const datas = {};
  const reports = {};
  for (const ticker of store.listStocks()) {
    stocks[ticker] = store.getStock(ticker);
    datas[ticker] = store.getDatas(ticker);
    reports[ticker] = store.getPerformanceReports(ticker);
  }
  const meta = {};
  for (const key of store.listMetaKeys()) meta[key] = store.getMeta(key);
  return { stocks, datas, reports, meta };
}

// nodeSettingsFileSystem semantics — mirrors settingsStore.ts save():
// exists -> create() -> write(). Throws on fs failure (caller reports).
function saveSettings(json) {
  const file = new settingsFs.File(settingsFs.Paths.document, SETTINGS_FILE);
  if (!file.exists) file.create();
  file.write(json);
}

// --- store-op args validation (defense-in-depth) ----------------------------
// main.mjs gates which ops the renderer may forward (STORE_OPS,
// desktop/main.mjs:46-52) and that args is an array (:225-228); upstream
// normalizeTicker (src/market.ts:85-98) rejects '/' or '\' in every market
// branch before a ticker ever becomes a store key. This child must not
// depend on those upstream gates: malformed args never reach the store
// methods. Rationale: FileStore persists per-ticker files as `${ticker}.json`
// joined onto the store dir (src/store-file.ts enqueuePersistTicker), so a
// ticker containing '/' or '\' could escape it. Context: the child listens
// on a random 127.0.0.1 port and only the preload bridge (trusted renderer
// bundle) can send store ops — pure defense-in-depth, not a new attack
// surface.
const PATH_SEP_RE = /[\\/]/;

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isTicker(v) {
  return typeof v === 'string' && v.length > 0 && !PATH_SEP_RE.test(v);
}

function isBar(v) {
  return (
    isPlainObject(v) &&
    typeof v.date === 'string' &&
    typeof v.open === 'number' &&
    typeof v.close === 'number' &&
    typeof v.high === 'number' &&
    typeof v.low === 'number' &&
    typeof v.volume === 'number' &&
    (v.amount == null || typeof v.amount === 'number')
  );
}

function isReport(v) {
  return isPlainObject(v) && typeof v.report_date === 'string' && isPlainObject(v.fields);
}

function checkTickerAndBars(op, args) {
  if (args.length !== 2) return `${op} expects 2 arguments (ticker, bars)`;
  if (!isTicker(args[0])) return `${op} ticker must be a non-empty string without path separators`;
  if (!Array.isArray(args[1]) || !args[1].every(isBar))
    return `${op} bars must be an array of DailyBar objects`;
  return null;
}

// One validator per StoreLike mutator signature (src/store.ts StoreLike /
// src/store-file.ts FileStore) — exactly the 6 ops main.mjs STORE_OPS
// forwards. Returns null when args match the contract, else the reason.
const STORE_OP_VALIDATORS = {
  putStock(args) {
    if (args.length !== 1) return 'putStock expects 1 argument (StockRecord)';
    const r = args[0];
    if (!isPlainObject(r)) return 'putStock argument must be a StockRecord object';
    if (!isTicker(r.ticker)) return 'putStock record.ticker must be a non-empty string without path separators';
    if (typeof r.name !== 'string') return 'putStock record.name must be a string';
    if (r.overview != null && !isPlainObject(r.overview)) return 'putStock record.overview must be an object or null';
    if (r.overviewLastUpdate != null && typeof r.overviewLastUpdate !== 'string')
      return 'putStock record.overviewLastUpdate must be a string or null';
    if (r.lastDataUpdate != null && typeof r.lastDataUpdate !== 'string')
      return 'putStock record.lastDataUpdate must be a string or null';
    return null;
  },
  addDatas(args) {
    return checkTickerAndBars('addDatas', args);
  },
  replaceDatas(args) {
    return checkTickerAndBars('replaceDatas', args);
  },
  addPerformanceReports(args) {
    if (args.length !== 2) return 'addPerformanceReports expects 2 arguments (ticker, reports)';
    if (!isTicker(args[0])) return 'addPerformanceReports ticker must be a non-empty string without path separators';
    if (!Array.isArray(args[1]) || !args[1].every(isReport))
      return 'addPerformanceReports reports must be an array of PerformanceReport objects';
    return null;
  },
  updateOverview(args) {
    if (args.length !== 3) return 'updateOverview expects 3 arguments (ticker, overview, stamp)';
    if (!isTicker(args[0])) return 'updateOverview ticker must be a non-empty string without path separators';
    if (!isPlainObject(args[1])) return 'updateOverview overview must be an object';
    if (typeof args[2] !== 'string') return 'updateOverview stamp must be a string';
    return null;
  },
  setMeta(args) {
    if (args.length !== 2) return 'setMeta expects 2 arguments (key, value)';
    if (typeof args[0] !== 'string' || args[0].length === 0) return 'setMeta key must be a non-empty string';
    if (typeof args[1] !== 'string') return 'setMeta value must be a string';
    return null;
  },
};

// Whitelist gate + arg-shape gate in one: null = args match the contract.
function checkStoreOpArgs(op, args) {
  if (!Object.prototype.hasOwnProperty.call(STORE_OP_VALIDATORS, op)) return `unknown store op: ${op}`;
  if (!Array.isArray(args)) return `store-op ${op} args must be an array`;
  return STORE_OP_VALIDATORS[op](args);
}

async function main() {
  store = createNodeFileStore(storeDir);
  await store.ready();
  setLogDir(logDir);

  settingsFs = nodeSettingsFileSystem(settingsDir);
  let settings = null;
  try {
    const file = new settingsFs.File(settingsFs.Paths.document, SETTINGS_FILE);
    settings = file.exists ? file.textSync() : null;
  } catch {
    settings = null; // unreadable settings -> null (settingsStore silent-degrade parity)
  }

  server = createAppServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;

  send({ type: 'ready', port, settings });
  console.log(`[child] ready: http://127.0.0.1:${port} (store=${storeDir}, settings=${settingsDir}, logs=${logDir})`);

  process.on('message', (msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'op') {
      // Whitelist + arg-shape gate before dispatch; always ack after settle,
      // error message first on failure — the process must never crash on a
      // bad op.
      const run = (async () => {
        const problem = checkStoreOpArgs(msg.op, msg.args);
        if (problem) throw new Error(problem);
        const fn = store[msg.op];
        if (typeof fn !== 'function') throw new Error(`unknown store op: ${msg.op}`);
        await fn.apply(store, msg.args);
      })();
      run.then(
        () => send({ type: 'ack', id: msg.id }),
        (err) => {
          // Send error and ack in separate macrotasks: back-to-back
          // process.send calls in one tick are intermittently lost on
          // WSL2's IPC pipe (empirically 6/8 runs) — one send per tick is
          // reliable. The ack must still arrive so main never hangs.
          send({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) });
          setImmediate(() => send({ type: 'ack', id: msg.id }));
        },
      );
    } else if (msg.type === 'snapshot') {
      try {
        send({ type: 'snapshot', id: msg.id, snapshot: buildSnapshot() });
      } catch (err) {
        send({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) });
      }
    } else if (msg.type === 'settings-save') {
      try {
        saveSettings(String(msg.json));
        send({ type: 'settings-saved' });
      } catch (err) {
        send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    } else if (msg.type === 'shutdown') {
      gracefulShutdown();
    }
  });

  // Parent gone (normal quit race or crash) -> graceful exit, no orphan.
  process.on('disconnect', gracefulShutdown);
  // Defensive: a process-tree kill may signal the child directly before main
  // can send 'shutdown'; flush + close + exit on signals too (idempotent via
  // shuttingDown flag).
  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);
}

main().catch((err) => {
  console.error('[child] fatal:', err);
  process.exit(1);
});
