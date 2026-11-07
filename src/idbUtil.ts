// IndexedDB 最小类型面 + Promise 包装 —— 平台中立(零 DOM lib 依赖,结构兼容)。
// 评审 R-12:store-idb.ts(08-16)与 app/lib/runArchive.ts(11-04)各自抄了一份
// requestResult/txDone,两套 IDB 惯例迟早漂移 → 逻辑单源在此,两处只做类型适配。
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

/** 请求 → Promise(错误统一成 Error,便于上层 describeError)。 */
export function requestResult<T>(req: IdbRequestLike<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

/** 事务完成 → Promise(complete/error/abort 三态)。 */
export function txDone(tx: IdbTransactionLike): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}
