// 分析历史存储适配层 —— 展示层归档,不进 StoreLike(四族同步契约/桌面 IPC 不动)。
// 形态:list 只读轻量摘要(RunSummary),正文 AnalysisRun 按需 load —— 不限制条数时
// 启动成本不随历史增长(PRD R4/R7/R8)。
// 三后端:
// - IndexedDB(web + 桌面渲染进程,Chromium 都有 IDB):正文 runs 表 + 摘要
//   summaries 表,同一 DB 两个 store。
// - expo-file-system(RN):soa-runs/ 目录,正文 <id>.json + index.json 摘要;
//   写盘 tmp + 原子替换(对齐 store-file.ts 生产后端)。
// - 内存(测试/后端不可用兜底)。
// 失败一律上抛,由调用方(analysisController)记录 + 静默降级 —— 本层不吞错。
import { error as logError } from '../../src/log.ts';
import {
  parseAnalysisRun,
  parseRunSummaries,
  sortSummaries,
  toSummary,
  type AnalysisRun,
  type RunSummary,
} from '../../src/runHistory.ts';

/** 历史归档读写面(全部异步:冷路径,只在面板/详情打开时发生)。 */
export interface RunArchive {
  /** 摘要列表(时间倒序);索引损坏 → 尽量重建,读不到 → []。 */
  list(): Promise<RunSummary[]>;
  /** 读一条完整记录;不存在/损坏 → null。 */
  load(id: string): Promise<AnalysisRun | null>;
  /** 追加/覆盖一条(正文 + 摘要同步写)。 */
  put(run: AnalysisRun): Promise<void>;
  /** 删除若干条;返回实际删除的条数。 */
  remove(ids: string[]): Promise<number>;
  /** 清空全部。 */
  clear(): Promise<void>;
}

const SAFE_ID_RE = /^[^\\/]+$/;

function assertSafeId(id: string): void {
  if (!SAFE_ID_RE.test(id)) throw new Error(`非法历史 id:${id}`);
}

// ─── 内存后端(测试 / 后端不可用)──────────────────────────────────────────
export function createMemoryRunArchive(
  seed: readonly AnalysisRun[] = [],
): RunArchive & { size(): number } {
  const runs = new Map<string, AnalysisRun>(seed.map((r) => [r.id, r]));
  return {
    async list() {
      return sortSummaries([...runs.values()].map(toSummary));
    },
    async load(id) {
      const run = runs.get(id) ?? null;
      return run ? { ...run, opinions: run.opinions.map((o) => ({ ...o })) } : null;
    },
    async put(run) {
      runs.set(run.id, run);
    },
    async remove(ids) {
      let n = 0;
      for (const id of ids) if (runs.delete(id)) n += 1;
      return n;
    },
    async clear() {
      runs.clear();
    },
    size() {
      return runs.size;
    },
  };
}

// ─── IndexedDB 后端(web / 桌面渲染进程)───────────────────────────────────
const IDB_DB_NAME = 'soa-runs';
const IDB_VERSION = 1;
const IDB_RUNS = 'runs';
const IDB_SUMMARIES = 'summaries';

function idbFactoryOf(): IDBFactory | undefined {
  try {
    return typeof indexedDB === 'undefined' ? undefined : indexedDB;
  } catch {
    return undefined; // 隐私模式等访问抛错 → 不可用
  }
}

function requestResult<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function openRunDb(factory: IDBFactory, dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(dbName, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_RUNS)) db.createObjectStore(IDB_RUNS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(IDB_SUMMARIES)) {
        db.createObjectStore(IDB_SUMMARIES, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

/** IndexedDB 后端。factory/dbName 可注入(测试用 fake-indexeddb)。 */
export function createIdbRunArchive(
  options: { factory?: IDBFactory; dbName?: string } = {},
): RunArchive {
  const factory = options.factory ?? idbFactoryOf();
  const dbName = options.dbName ?? IDB_DB_NAME;
  let dbPromise: Promise<IDBDatabase> | null = null;

  const db = (): Promise<IDBDatabase> => {
    if (!factory) return Promise.reject(new Error('IndexedDB 不可用:历史归档后端缺失'));
    // 失败不永久缓存(可重试):对齐 IdbStore.open 的 F04 语义
    dbPromise ??= openRunDb(factory, dbName).catch((err: unknown) => {
      dbPromise = null;
      throw err;
    });
    return dbPromise;
  };

  return {
    async list() {
      const conn = await db();
      const tx = conn.transaction(IDB_SUMMARIES, 'readonly');
      const rows = await requestResult(tx.objectStore(IDB_SUMMARIES).getAll());
      await txDone(tx);
      return parseRunSummaries(rows);
    },
    async load(id) {
      assertSafeId(id);
      const conn = await db();
      const tx = conn.transaction(IDB_RUNS, 'readonly');
      const row = await requestResult(tx.objectStore(IDB_RUNS).get(id));
      await txDone(tx);
      return parseAnalysisRun(row);
    },
    async put(run) {
      assertSafeId(run.id);
      const conn = await db();
      const tx = conn.transaction([IDB_RUNS, IDB_SUMMARIES], 'readwrite');
      tx.objectStore(IDB_RUNS).put({ ...run });
      tx.objectStore(IDB_SUMMARIES).put(toSummary(run));
      await txDone(tx);
    },
    async remove(ids) {
      for (const id of ids) assertSafeId(id);
      if (!ids.length) return 0;
      const conn = await db();
      const tx = conn.transaction([IDB_RUNS, IDB_SUMMARIES], 'readwrite');
      const runs = tx.objectStore(IDB_RUNS);
      const summaries = tx.objectStore(IDB_SUMMARIES);
      // R-06:`delete()` 对不存在的 key 是无操作 —— 直接返回 ids.length 会向
      // 调用方(日志「删除历史分析:N 条」)报出并未发生的删除。同 tx 内先
      // getKey 探存在性,并在 onsuccess 回调里同步 delete(把新建请求放在
      // 回调/微任务之外会被 IDB 判为事务已失活)。
      let removed = 0;
      await new Promise<void>((resolve, reject) => {
        let pending = ids.length;
        const settle = (): void => {
          pending -= 1;
          if (pending === 0) resolve();
        };
        for (const id of ids) {
          const req = runs.getKey(id);
          req.onsuccess = () => {
            if (req.result !== undefined) {
              removed += 1;
              runs.delete(req.result);
              summaries.delete(req.result);
            }
            settle();
          };
          req.onerror = () => reject(req.error ?? new Error('IndexedDB getKey failed'));
        }
      });
      await txDone(tx);
      return removed;
    },
    async clear() {
      const conn = await db();
      const tx = conn.transaction([IDB_RUNS, IDB_SUMMARIES], 'readwrite');
      tx.objectStore(IDB_RUNS).clear();
      tx.objectStore(IDB_SUMMARIES).clear();
      await txDone(tx);
    },
  };
}

// ─── 文件后端(RN;测试注入 node fs 适配器)─────────────────────────────────
/** 归档目录内的文件读写面(路径已由适配器绑定,只用文件名;同 FileFsAdapter 思路)。 */
export interface RunFsAdapter {
  read(name: string): Promise<string | null>;
  /** 原子写(同目录 tmp + 替换)由适配器负责。 */
  write(name: string, data: string): Promise<void>;
  remove(name: string): Promise<void>;
  list(): Promise<string[]>;
}

const INDEX_FILE = 'index.json';
const RUN_DIR = 'soa-runs';

async function createExpoRunFs(): Promise<RunFsAdapter> {
  // 动态 import 边界:expo-file-system 是 RN 专属模块,web/Node 包不含(类型见
  // src/expo-file-system.d.ts;同 store-file.ts getExpoBackend 先例)。
  const { File, Directory, Paths } = await import('expo-file-system');
  const root = new Directory(Paths.document, RUN_DIR);
  if (!root.exists) root.create({ intermediates: true, idempotent: true });
  return {
    async read(name) {
      const f = new File(root, name);
      return f.exists ? await f.text() : null;
    },
    async write(name, data) {
      const dest = new File(root, name);
      const tmp = new File(root, `${name}.tmp.${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
      if (!tmp.exists) tmp.create();
      tmp.write(data);
      // SDK 57 moveSync 默认不覆盖已存在目标,必须显式 overwrite:true
      tmp.moveSync(dest, { overwrite: true });
    },
    async remove(name) {
      const f = new File(root, name);
      if (f.exists) f.delete();
    },
    async list() {
      return new Directory(root.uri).list().map((e: { name: string }) => e.name);
    },
  };
}

/**
 * 文件后端(正文 <id>.json + index.json 摘要)。`getFs` 缺省走 expo-file-system,
 * 测试注入 node fs 适配器。写操作串行排队(索引读改写不得交错)。
 */
export function createFileRunArchive(getFs: () => Promise<RunFsAdapter> = createExpoRunFs): RunArchive {
  let loaded = false;
  let summaries: RunSummary[] = [];
  let queue: Promise<void> = Promise.resolve();

  const loadIndex = async (): Promise<RunSummary[]> => {
    const fs = await getFs();
    const text = await fs.read(INDEX_FILE);
    if (text !== null) {
      try {
        const parsed: unknown = JSON.parse(text);
        // R-10:能解析但非数组/空数组也算「索引不可信」—— 否则一条被截断成
        // '{}' 的索引会让磁盘上所有记录永久消失(正文文件才是真值来源)。
        // 真空档(email 场景)重建结果也是 [],只多一次目录扫描。
        const list = parseRunSummaries(parsed);
        if (Array.isArray(parsed) && list.length > 0) return list;
        logError('历史索引为空或非数组,尝试从正文重建');
      } catch (err) {
        logError(`历史索引损坏,尝试重建:${err instanceof Error ? err.message : String(err)}`);
      }
    }
    // 索引缺失/损坏 → 扫正文文件重建(索引不是真值来源,正文才是)
    const rebuilt: RunSummary[] = [];
    for (const name of await fs.list()) {
      if (!name.endsWith('.json') || name === INDEX_FILE || name.includes('.tmp.')) continue;
      try {
        const raw = await fs.read(name);
        if (raw === null) continue;
        const run = parseAnalysisRun(JSON.parse(raw));
        if (run) rebuilt.push(toSummary(run));
      } catch (err) {
        logError(`历史正文损坏,跳过 ${name}:${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (rebuilt.length) await fs.write(INDEX_FILE, JSON.stringify(sortSummaries(rebuilt)));
    return sortSummaries(rebuilt);
  };

  const ensureLoaded = async (): Promise<void> => {
    if (loaded) return;
    summaries = await loadIndex();
    loaded = true;
  };

  const writeIndex = async (): Promise<void> => {
    const fs = await getFs();
    await fs.write(INDEX_FILE, JSON.stringify(summaries));
  };

  /** R-24:write/move 中场抛错会留下 `<name>.tmp.*`,只有 clear() 扫——
   *  写失败后在这里收拾一次,不让残留越积越多。 */
  const sweepTmp = async (fs: RunFsAdapter): Promise<void> => {
    try {
      for (const name of await fs.list()) {
        if (name.includes('.tmp.')) await fs.remove(name);
      }
    } catch (err) {
      logError(`历史归档 tmp 残留清理失败:${err instanceof Error ? err.message : String(err)}`);
    }
  };

  /** 串行化写操作:索引是「读改写」,并发会互相覆盖。 */
  const enqueue = <T>(op: () => Promise<T>): Promise<T> => {
    const run = queue.then(op);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  return {
    async list() {
      // R-24:ensureLoaded 原来在 queue 外 —— 冷启动扇描与排队中的 put 并发时
      // 会用旧扇描结果覆盖 summaries,writeIndex 再把新条目从索引里抹掉
      return enqueue(async () => {
        await ensureLoaded();
        return sortSummaries(summaries);
      });
    },
    async load(id) {
      assertSafeId(id);
      const fs = await getFs();
      const text = await fs.read(`${id}.json`);
      if (text === null) return null;
      try {
        return parseAnalysisRun(JSON.parse(text));
      } catch {
        return null;
      }
    },
    async put(run) {
      assertSafeId(run.id);
      await enqueue(async () => {
        await ensureLoaded();
        const fs = await getFs();
        try {
          await fs.write(`${run.id}.json`, JSON.stringify(run));
        } catch (err) {
          await sweepTmp(fs);
          throw err;
        }
        summaries = sortSummaries([...summaries.filter((s) => s.id !== run.id), toSummary(run)]);
        await writeIndex();
      });
    },
    async remove(ids) {
      for (const id of ids) assertSafeId(id);
      if (!ids.length) return 0;
      return enqueue(async () => {
        await ensureLoaded();
        const fs = await getFs();
        let removed = 0;
        // R-24:正文文件可能不在索引里(上次 writeIndex 失败留下的孤儿)——
        // 一并删掉,否则重建索引时它又复活且永远删不掉。计数只算索引里的
        // (调用方日志面向列表),孤儿清理是防护。
        const files = new Set(await fs.list());
        for (const id of ids) {
          const name = `${id}.json`;
          const inIndex = summaries.some((s) => s.id === id);
          if (!inIndex && !files.has(name)) continue;
          if (files.has(name)) await fs.remove(name);
          if (inIndex) removed += 1;
        }
        summaries = summaries.filter((s) => !ids.includes(s.id));
        await writeIndex();
        return removed;
      });
    },
    async clear() {
      await enqueue(async () => {
        await ensureLoaded();
        const fs = await getFs();
        for (const name of await fs.list()) {
          if (name.endsWith('.json') || name.includes('.tmp.')) await fs.remove(name);
        }
        summaries = [];
        await fs.write(INDEX_FILE, JSON.stringify(summaries));
      });
    },
  };
}

/** 生产后端选择(web/桌面 → IndexedDB;RN → 文件)。调用方按 Platform 传参。 */
