// Store-op 入参校验 —— 桌面写操作唯一安全门(desktop/child.mjs 消费)。
// 纯模块零 import:输入全部按 unknown 处理(IPC 载荷不可信),不依赖 node:/
// store 运行时 —— 架构契约 1/3 天然合规;child.mjs 经 --experimental-strip-types
// 直接 import .ts(与 src/store-node.ts 同模式)。child.mjs 顶层 argv 门 +
// main() 顶层执行使其自身不可 import,故抽出到此(08-23 审计 TQ2);校验规则
// 与错误文案自抽取前逐字节保留,行为真值表钉在 test/store-op-validators.test.ts。
//
// main.mjs gates which ops the renderer may forward (STORE_OPS,
// desktop/main.mjs:51-58) and that args is an array; upstream normalizeTicker
// (src/market.ts:81-94) rejects '/' or '\' in every market branch before a
// ticker ever becomes a store key. The child must not depend on those upstream
// gates: malformed args never reach the store methods. Rationale: FileStore
// persists per-ticker files as `${ticker}.json` joined onto the store dir
// (src/store-file.ts:163, joinPath), so a ticker containing '/' or '\' could
// escape it. Context: the child listens on a random 127.0.0.1 port and only
// the preload bridge (trusted renderer bundle) can send store ops — pure
// defense-in-depth, not a new attack surface.

const PATH_SEP_RE = /[\\/]/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isTicker(v: unknown): boolean {
  return typeof v === 'string' && v.length > 0 && !PATH_SEP_RE.test(v);
}

function isBar(v: unknown): boolean {
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

function isReport(v: unknown): boolean {
  return isPlainObject(v) && typeof v.report_date === 'string' && isPlainObject(v.fields);
}

function checkTickerAndBars(op: string, args: unknown[]): string | null {
  if (args.length !== 2) return `${op} expects 2 arguments (ticker, bars)`;
  if (!isTicker(args[0])) return `${op} ticker must be a non-empty string without path separators`;
  if (!Array.isArray(args[1]) || !args[1].every(isBar))
    return `${op} bars must be an array of DailyBar objects`;
  return null;
}

type OpValidator = (args: unknown[]) => string | null;

// One validator per StoreLike mutator signature (src/store.ts StoreLike /
// src/store-file.ts FileStore) — exactly the 6 ops main.mjs STORE_OPS
// forwards. Returns null when args match the contract, else the reason.
const STORE_OP_VALIDATORS: Record<string, OpValidator> = {
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

/** Whitelist gate + arg-shape gate in one: null = args match the contract.
 *  自有属性判定(hasOwnProperty.call)挡原型链键('__proto__'/constructor 等
 *  继承名不可借道放行);op 白名单先于 args 形状。错误文案即 IPC error 消息,
 *  直达渲染层,改动需同步 test/store-op-validators.test.ts。 */
export function checkStoreOpArgs(op: string, args: unknown): string | null {
  if (!Object.prototype.hasOwnProperty.call(STORE_OP_VALIDATORS, op)) return `unknown store op: ${op}`;
  if (!Array.isArray(args)) return `store-op ${op} args must be an array`;
  return STORE_OP_VALIDATORS[op](args);
}
