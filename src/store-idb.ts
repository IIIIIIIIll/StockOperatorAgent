// IndexedDB 仓储 —— web 端 StoreLike 持久化后端(设计 §7 决策 C,禁止更改)
// 语义对齐 InMemoryStore/Store:addDatas 拒绝 date <= lastDataUpdate;业绩按
// report_date 去重;replaceDatas 全量替换(空输入早退不清库);getDatas 返回新数组。
// 架构:自维护内存镜像同步读 + 写穿透队列(Promise 链串行落盘,写序保证;
// 崩溃丢最近写入可接受——采集即落盘)。mutator 同步更新内存 → enqueue 落盘,
// 同步方法内不做任何异步等待;getters 同步读内存副本。
import type { DailyBar, PerformanceReport, StockRecord, StoreLike } from './store.ts';
import { error as logError } from './log.ts';

// ─── IndexedDB 最小类型面 ────────────────────────────────────────────────
// ts/ 为 node-only lib(tsconfig lib 仅 ES2024,无 DOM 类型):按需声明 IDB 结构面,
// 运行时对象为浏览器/fake-indexeddb 实现(结构兼容即可)。同 runner.ts `location`
// 探针、log.ts 环境全局声明先例。
export interface IdbKeyRangeLike {
  readonly lower: unknown;
  readonly upper: unknown;
}

export interface IdbRequestLike<T> {
  onsuccess: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  result: T;
  error: unknown;
}

export interface IdbObjectStoreLike {
  put(value: unknown, key?: unknown): IdbRequestLike<unknown>;
  delete(key: unknown): IdbRequestLike<unknown>;
  getAll(): IdbRequestLike<unknown[]>;
}

export interface IdbTransactionLike {
  objectStore(name: string): IdbObjectStoreLike;
  oncomplete: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onabort: ((ev: unknown) => void) | null;
  error: unknown;
}

export interface IdbDatabaseLike {
  createObjectStore(name: string, options?: { keyPath?: string | string[] }): IdbObjectStoreLike;
  transaction(names: string | string[], mode?: string): IdbTransactionLike;
  objectStoreNames: { contains(name: string): boolean };
  close(): void;
}

export interface IdbOpenRequestLike extends IdbRequestLike<IdbDatabaseLike> {
  onupgradeneeded: ((ev: unknown) => void) | null;
}

export interface IdbFactoryLike {
  open(name: string, version?: number): IdbOpenRequestLike;
}

// ts/ 为 node-only lib(根 tsconfig lib=ES2024+DOM,见 src/log.ts 注释;app/ 亦
// 带 DOM lib)——不 declare global
// (双 tsconfig 冲突),运行时经 globalThis 探针取浏览器/fake-indexeddb 全局
// (同 runner.ts `location` 探针、log.ts 环境全局先例)。
interface IdbKeyRangeCtorLike {
  bound(lower: unknown, upper: unknown, lowerOpen?: boolean, upperOpen?: boolean): IdbKeyRangeLike;
}

function globalIndexedDB(): IdbFactoryLike | undefined {
  return (globalThis as unknown as { indexedDB?: IdbFactoryLike }).indexedDB;
}

function globalIDBKeyRange(): IdbKeyRangeCtorLike {
  const range = (globalThis as unknown as { IDBKeyRange?: IdbKeyRangeCtorLike }).IDBKeyRange;
  if (!range) throw new Error('IDBKeyRange 不可用:浏览器/fake-indexeddb 全局缺失');
  return range;
}

// ─── DB 结构与 Promise 包装 ──────────────────────────────────────────────
// 表结构与 Store SCHEMA 对齐(stocks/daily_bars/performance_reports/meta)。
const DB_VERSION = 1;
const STORES: Array<[string, string | string[]]> = [
  ['stocks', 'ticker'],
  ['daily_bars', ['ticker', 'date']],
  ['performance_reports', ['ticker', 'report_date']],
  ['meta', 'key'],
];

function requestResult<T>(req: IdbRequestLike<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function txDone(tx: IdbTransactionLike): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function openDb(factory: IdbFactoryLike | undefined, dbName: string): Promise<IdbDatabaseLike> {
  return new Promise<IdbDatabaseLike>((resolve, reject) => {
    if (!factory) {
      reject(new Error('IndexedDB 不可用:web 外无 indexedDB 全局(测试需注入 fake-indexeddb factory)'));
      return;
    }
    const req = factory.open(dbName, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, keyPath] of STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

async function getAllRows(db: IdbDatabaseLike, storeName: string): Promise<unknown[]> {
  const tx = db.transaction(storeName, 'readonly');
  const rows = await requestResult(tx.objectStore(storeName).getAll());
  await txDone(tx);
  return rows;
}

export class IdbStore implements StoreLike {
  private stocks = new Map<string, StockRecord>();
  private bars = new Map<string, DailyBar[]>();
  private reports = new Map<string, PerformanceReport[]>();
  private meta = new Map<string, string>();
  private readonly factory: IdbFactoryLike | undefined;
  private readonly dbName: string;
  private queue: Promise<void> = Promise.resolve();
  private closed = false;
  private dbPromise: Promise<IdbDatabaseLike> | null = null;
  private readyPromise: Promise<void> | null = null;

  constructor(factory?: IdbFactoryLike, dbName = 'soa-store') {
    this.factory = factory ?? globalIndexedDB();
    this.dbName = dbName;
  }

  /** 打开 DB + 从落盘 hydrate 内存镜像(内存已有键优先——先写后 ready 的变更不丢)。 */
  async ready(): Promise<void> {
    // F04:打开失败清 memo——拒绝不永久缓存(如 IndexedDB blocked/upgrade 失败后
    // 可重试),成功则持久缓存
    try {
      this.readyPromise ??= this.open().then(() => undefined);
      return await this.readyPromise;
    } catch (err) {
      this.readyPromise = null;
      throw err;
    }
  }

  /** 等待写穿透队列排空(测试断言前调用;失败仅记录不抛出,排空即返回)。 */
  async flush(): Promise<void> {
    await this.queue;
  }

  private async open(): Promise<IdbDatabaseLike> {
    // F04:与 ready() 同款 memo 复位——open 失败可重试,不缓存拒绝
    try {
      this.dbPromise ??= openDb(this.factory, this.dbName).then(async (db) => {
        await this.hydrate(db);
        return db;
      });
      return await this.dbPromise;
    } catch (err) {
      this.dbPromise = null;
      throw err;
    }
  }

  private async hydrate(db: IdbDatabaseLike): Promise<void> {
    const stockRows = (await getAllRows(db, 'stocks')) as StockRecord[];
    for (const row of stockRows) {
      if (!this.stocks.has(row.ticker)) this.stocks.set(row.ticker, { ...row });
    }
    const barRows = (await getAllRows(db, 'daily_bars')) as Array<DailyBar & { ticker: string }>;
    const barsByTicker = new Map<string, DailyBar[]>();
    for (const b of barRows) {
      const list = barsByTicker.get(b.ticker) ?? [];
      list.push(b);
      barsByTicker.set(b.ticker, list);
    }
    for (const [ticker, list] of barsByTicker) {
      if (!this.bars.has(ticker)) {
        this.bars.set(ticker, [...list].sort((a, b) => a.date.localeCompare(b.date)));
      }
    }
    const reportRows = (await getAllRows(db, 'performance_reports')) as Array<
      PerformanceReport & { ticker: string }
    >;
    const reportsByTicker = new Map<string, PerformanceReport[]>();
    for (const r of reportRows) {
      const list = reportsByTicker.get(r.ticker) ?? [];
      list.push(r);
      reportsByTicker.set(r.ticker, list);
    }
    for (const [ticker, list] of reportsByTicker) {
      if (!this.reports.has(ticker)) {
        this.reports.set(ticker, [...list].sort((a, b) => a.report_date.localeCompare(b.report_date)));
      }
    }
    const metaRows = (await getAllRows(db, 'meta')) as Array<{ key: string; value: string }>;
    for (const row of metaRows) {
      if (!this.meta.has(row.key)) this.meta.set(row.key, row.value);
    }
  }

  /** 写穿透队列:单 Promise 链串行保证写序;失败仅记录,不阻断后续写(决策 C)。
   *  close() 后不再入队(store 已关闭,写穿禁用;见 close 注释)。 */
  private enqueue(op: () => Promise<void>): void {
    if (this.closed) return;
    this.queue = this.queue
      .then(() => this.ready())
      .then(op)
      .catch((err: unknown) => {
        logError(`IdbStore 落盘失败:${err instanceof Error ? err.message : String(err)}`);
      });
  }

  private enqueuePersistBars(ticker: string, fresh: DailyBar[], updatedStock?: StockRecord): void {
    this.enqueue(async () => {
      const db = await this.open();
      const tx = db.transaction(['daily_bars', 'stocks'], 'readwrite');
      const barsStore = tx.objectStore('daily_bars');
      for (const b of fresh) barsStore.put({ ...b, ticker });
      if (updatedStock) tx.objectStore('stocks').put({ ...updatedStock });
      await txDone(tx);
    });
  }

  private enqueuePersistReplace(ticker: string, updatedStock?: StockRecord): void {
    this.enqueue(async () => {
      const db = await this.open();
      const tx = db.transaction(['daily_bars', 'stocks'], 'readwrite');
      const barsStore = tx.objectStore('daily_bars');
      // 清该 ticker 全部旧行(复合键 [ticker,date] range 删除)后按内存全量重写
      barsStore.delete(globalIDBKeyRange().bound([ticker, ''], [ticker, '\uffff']));
      for (const b of this.bars.get(ticker) ?? []) barsStore.put({ ...b, ticker });
      if (updatedStock) tx.objectStore('stocks').put({ ...updatedStock });
      await txDone(tx);
    });
  }

  private enqueuePersistReports(ticker: string, fresh: PerformanceReport[]): void {
    this.enqueue(async () => {
      const db = await this.open();
      const tx = db.transaction('performance_reports', 'readwrite');
      const store = tx.objectStore('performance_reports');
      for (const r of fresh) store.put({ ...r, ticker });
      await txDone(tx);
    });
  }

  private enqueuePersistStock(record: StockRecord): void {
    this.enqueue(async () => {
      const db = await this.open();
      const tx = db.transaction('stocks', 'readwrite');
      tx.objectStore('stocks').put({ ...record });
      await txDone(tx);
    });
  }

  private enqueuePersistMeta(key: string, value: string): void {
    this.enqueue(async () => {
      const db = await this.open();
      const tx = db.transaction('meta', 'readwrite');
      tx.objectStore('meta').put({ key, value });
      await txDone(tx);
    });
  }

  /** 关闭仓储:先排空写穿队列(所有 pending 写落盘)再清内存镜像、释放连接,不丢写。
   *  接口契约为同步 close(): void(StoreLike 11 同步方法),无法在 close 内 await
   *  队列——实现:本方法同步置 closed(阻止后续 enqueue,close 后不再排队/落盘),
   *  并把「等待队列排空 → 清内存 + 关连接」挂到队列尾:队列尾任务按序排在前序
   *  pending 写之后执行,等效于先 flush 后清理。队列可由 flush() 观察排空时机。 */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.queue = this.queue.then(async () => {
      this.stocks.clear();
      this.bars.clear();
      this.reports.clear();
      this.meta.clear();
      try {
        const db = await (this.dbPromise ?? Promise.resolve(null));
        if (db) db.close();
      } catch (err: unknown) {
        logError(`IdbStore 关闭连接失败:${err instanceof Error ? err.message : String(err)}`);
      }
      this.readyPromise = null;
      this.dbPromise = null;
    });
  }

  getStock(ticker: string): StockRecord | null {
    return this.stocks.get(ticker) ?? null;
  }

  putStock(record: StockRecord): void {
    this.stocks.set(record.ticker, { ...record });
    this.enqueuePersistStock(record);
  }

  /** 批量追加日K:拒绝 date <= 既有末根日期;升序契约 + 同日期去重(keep last)。 */
  addDatas(ticker: string, bars: DailyBar[]): number {
    if (!bars.length) return 0;
    const { fresh, updatedStock } = this.mergeBars(ticker, bars);
    if (!fresh.length) return 0;
    this.enqueuePersistBars(ticker, fresh, updatedStock);
    return fresh.length;
  }

  /** 全量替换该 ticker 日K(空输入早退不清库)——web 采集语义:代理返回 IPO 全量历史。 */
  replaceDatas(ticker: string, bars: DailyBar[]): number {
    if (!bars.length) return 0;
    this.bars.delete(ticker);
    const { fresh, updatedStock } = this.mergeBars(ticker, bars);
    if (!fresh.length) return 0;
    this.enqueuePersistReplace(ticker, updatedStock);
    return fresh.length;
  }

  private mergeBars(
    ticker: string,
    bars: DailyBar[],
  ): { fresh: DailyBar[]; updatedStock: StockRecord | undefined } {
    const existing = this.bars.get(ticker) ?? [];
    const last = existing.length ? existing[existing.length - 1].date : null;
    const fresh = bars.filter((b) => last === null || b.date > last);
    if (!fresh.length) return { fresh, updatedStock: undefined };
    const merged = [...existing, ...fresh].sort((a, b) => a.date.localeCompare(b.date));
    const seen = new Map<string, DailyBar>();
    for (const b of merged) seen.set(b.date, b);
    this.bars.set(ticker, [...seen.values()].sort((a, b) => a.date.localeCompare(b.date)));
    const stock = this.stocks.get(ticker);
    const updatedStock = stock ? { ...stock, lastDataUpdate: fresh[fresh.length - 1].date } : undefined;
    if (updatedStock) this.stocks.set(ticker, updatedStock);
    return { fresh, updatedStock };
  }

  /** 批量追加业绩报告:按 report_date 去重。 */
  addPerformanceReports(ticker: string, reports: PerformanceReport[]): number {
    if (!reports.length) return 0;
    const existing = this.reports.get(ticker) ?? [];
    const known = new Set(existing.map((r) => r.report_date));
    const fresh = reports.filter((r) => !known.has(r.report_date));
    if (!fresh.length) return 0;
    this.reports.set(
      ticker,
      [...existing, ...fresh].sort((a, b) => a.report_date.localeCompare(b.report_date)),
    );
    this.enqueuePersistReports(ticker, fresh);
    return fresh.length;
  }

  getDatas(ticker: string): DailyBar[] {
    return (this.bars.get(ticker) ?? []).map((b) => ({ ...b }));
  }

  getPerformanceReports(ticker: string): PerformanceReport[] {
    return (this.reports.get(ticker) ?? []).map((r) => ({ report_date: r.report_date, fields: { ...r.fields } }));
  }

  getMeta(key: string): string | null {
    return this.meta.get(key) ?? null;
  }

  setMeta(key: string, value: string): void {
    this.meta.set(key, value);
    this.enqueuePersistMeta(key, value);
  }
}
