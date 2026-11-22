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
//   2. Own the FileStore (node fs adapter, createNodeFileStore): apply the 5
//      store-op mutators and answer snapshot requests for renderer hydration.
//   3. Persist settings with nodeSettingsFileSystem semantics — the exact
//      file shape of the settingsStore.ts node branch:
//      <settings-dir>/soa-settings.json, File.exists/create/write.
//   4. Inject the log directory via setLogDir (logs-server.cjs explicit
//      injection surface).
//
// IPC contract with main.mjs (process.send / on('message')):
//   child -> main: {type:'ready', port, settings} | {type:'ack', id}
//                  | {type:'snapshot', id, snapshot} | {type:'settings-saved', id}
//                  | {type:'settings-key-request'} | {type:'error', id?, message}
//   main -> child: {type:'op', id, op, args} | {type:'snapshot', id}
//                  | {type:'settings-save', id, json} | {type:'settings-key', key}
//                  | {type:'shutdown'}
//   {type:'op'} args pass checkStoreOpArgs (src/storeOps.ts) before dispatch
//   — malformed or path-separator-bearing args never reach the store.
// Snapshot = {stocks, datas, reports, meta} four Records, JSON-safe
// (listStocks/listMetaKeys enumeration + existing getters serialized).
//
// Usage: spawned by desktop/main.mjs; not meant to run standalone.

import { mkdirSync } from 'node:fs';
import { createAppServer } from '../app/server.mjs';
import { setLogDir } from '../app/lib/logs-server.cjs';
import { createNodeFileStore, encryptedSettingsFileSystem, nodeSettingsFileSystem } from '../src/store-node.ts';
import { checkStoreOpArgs } from '../src/storeOps.ts';

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
// S7:settings 落盘 —— 主进程经 OS 安全存储(safeStorage)下发的 32 字节 key 加密
// 成 AES-256-GCM 信封;拿不到 key(平台无安全存储)才退回明文 + 告警。
let settingsFs = null;

// 主进程的 key 回包:主进程可能在 child 发请求前就把 ready 前的工作做完了,
// 但 IPC 是异步的 —— 这里用一个只 resolve 一次的 promise 接住。
const SETTINGS_KEY_TIMEOUT_MS = 3000;
let resolveSettingsKey = null;

// Flush pending writes, close store + server, then exit. Used by both the
// shutdown message and parent disconnect, so no orphan survives main's death.
function gracefulShutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  void (async () => {
    try {
      await store?.flush();
    } catch {
      /* drain failure must not block exit */
    }
    // F07:启动窗口期(store/server 尚未就绪)父进程死亡 → 各句柄为 null,
    // 空守卫后直接退出,不产生未处理异常
    store?.close();
    server?.close();
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

// 设置加密后端的选取:向主进程要 key(safeStorage 托管)。超时/不可用 → 明文,
// 并把原因报到 stderr —— 静默降级成明文正是这条 P1(明文落盘)的原始问题。
function createSettingsFs(dir) {
  // 独立跑(无 IPC 通道,如 spec 里的 child 冒烟命令)时主进程不存在 —— 直接明文,
  // 不白等 3s。
  if (!process.send) {
    console.error('[child] 无 IPC 通道(独立运行)——设置将以明文落盘');
    return Promise.resolve(nodeSettingsFileSystem(dir));
  }
  const keyPromise = new Promise((resolve) => {
    resolveSettingsKey = resolve;
    send({ type: 'settings-key-request' });
  });
  const timeout = new Promise((resolve) => {
    setTimeout(() => resolve(undefined), SETTINGS_KEY_TIMEOUT_MS).unref?.();
  });
  return Promise.race([keyPromise, timeout]).then((key) => {
    resolveSettingsKey = null;
    if (Buffer.isBuffer(key) && key.length === 32) {
      return encryptedSettingsFileSystem(dir, key);
    }
    console.error(
      `[child] 未取得设置加密 key(${key === undefined ? '主进程超时' : 'OS 安全存储不可用'})——设置将以明文落盘`,
    );
    return nodeSettingsFileSystem(dir);
  });
}

async function main() {
  // F07:IPC 监听先于任何 await 注册——启动窗口期(store ready/端口监听)到达的
  // 消息不丢失;父进程在窗口期死亡时 disconnect/信号即时收尾,不留孤儿。
  // 处理器内对尚未就绪的 store/settingsFs 全部走既有 try/catch → error 回包。
  process.on('message', (msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (shuttingDown) return; // F08:关停窗口期消息直接忽略——不做 applied-then-dropped
    if (msg.type === 'settings-key') {
      // safeStorage 不可用 → 主进程回 key:null,由下方退回明文
      resolveSettingsKey?.(msg.key ? Buffer.from(msg.key, 'base64') : null);
      resolveSettingsKey = null;
      return;
    }
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
        // S6-2:带 id 回包 —— 主进程据此 resolve renderer 的 invoke(旧实现无 id,
        // 失败只能在主进程 console.error,renderer 永远以为保存成功)。
        send({ type: 'settings-saved', id: msg.id });
      } catch (err) {
        send({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) });
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

  store = createNodeFileStore(storeDir);
  await store.ready();
  setLogDir(logDir);

  settingsFs = await createSettingsFs(settingsDir);
  let settings = null;
  try {
    const file = new settingsFs.File(settingsFs.Paths.document, SETTINGS_FILE);
    settings = file.exists ? file.textSync() : null;
  } catch (err) {
    // 加密文件解不开(key 变了/文件被改动)——与损坏 JSON 同口径:回 null。
    // 不降级成明文以便下次启动还能试对 key。
    console.error(`[child] 设置读取失败(按无设置处理): ${err?.message ?? err}`);
    settings = null;
  }

  // S6:显式传有效监听地址 127.0.0.1 —— requireToken 按 host 选项判定,
  // ambient HOST=0.0.0.0 无法让回环监听要求 token(渲染器发不了也无需发)。
  server = createAppServer({ host: '127.0.0.1' });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;

  send({ type: 'ready', port, settings });
  console.log(`[child] ready: http://127.0.0.1:${port} (store=${storeDir}, settings=${settingsDir}, logs=${logDir})`);
}

main().catch((err) => {
  console.error('[child] fatal:', err);
  process.exit(1);
});
