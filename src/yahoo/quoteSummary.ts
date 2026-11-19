// Yahoo quoteSummary 取值原语 —— 四个解析器共用的唯一一份(2026-11 架构整改)。
//
// 整改前这些函数在 4 个文件里各写一遍(逐字节相同,只有注释标点不同):
//   src/yahoo/composeYahooOverview.ts  rec / rawNum / firstFinite / str / quoteSummaryResult
//   src/yahoo/composeYahooProfile.ts   rec / rawNum / str / quoteSummaryResult
//   src/yahoo/composeYahooReports.ts   rec / rawNum / quoteSummaryResult / statementDateKey
//   src/yahoo/deviceYahooCollect.ts    rec / stmtDateKey(注释里自己承认「对齐
//                                      composeYahooReports 的 statementDateKey 语义」)
//
// 危害不是重复本身,而是漂移不可见:Yahoo 的 endDate 同时有 `fmt`(本地化字符串)
// 和 `raw`(epoch 秒),一旦某个副本改了回退顺序或时区,同一个季度在两份报表里
// 就会落到不同日期键 —— 资产负债/现金流按日期键对齐,失配即静默产生 NaN。
//
// 纯 TS、零 node:/零 RN 依赖(架构断言 1/2):只做 unknown → 值的形状归一。

/** unknown → Record 字典(非对象/null → 空字典;缺失字段 {} 是 NaN 语义的起点)。 */
export function rec(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

/** Yahoo 的 {raw, fmt} 值形态 → number;缺失/{}/非数字 raw → NaN。
 *  兼容直接给裸数字的调用方(部分模块返回 number)。 */
export function rawNum(v: unknown): number {
  if (typeof v === 'number') return v;
  const raw = rec(v)['raw'];
  return typeof raw === 'number' ? raw : NaN;
}

/** 候选链首个有限值;全缺 → NaN(容错:meta 缺字段回退 summary,再缺 → NaN)。 */
export function firstFinite(...candidates: unknown[]): number {
  for (const c of candidates) {
    const n = rawNum(c);
    if (Number.isFinite(n)) return n;
  }
  return NaN;
}

/** string 字段取值(非字符串 → 空串)。 */
export function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** quoteSummary 原始 JSON → result[0](兼容直接传 result[0] 的调用方)。 */
export function quoteSummaryResult(summary: unknown): Record<string, unknown> {
  const s = rec(summary);
  const result = rec(s['quoteSummary'])['result'];
  if (Array.isArray(result) && result.length > 0) return rec(result[0]);
  return s;
}

/** 报表语句的 endDate → 日期键 'YYYY-MM-DD'。
 *  优先 endDate.fmt;缺失 → endDate.raw 按 **UTC** 展开(不按本地时区 —— 否则
 *  东八区会把 2025-03-31 推成 2025-04-01,季度行整体错位一格)。 */
export function statementDateKey(stmt: unknown): string | null {
  const endDate = rec(stmt)['endDate'];
  const fmt = rec(endDate)['fmt'];
  if (typeof fmt === 'string' && fmt !== '') return fmt;
  const raw = rec(endDate)['raw'];
  if (typeof raw === 'number') {
    const d = new Date(raw * 1000);
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${d.getUTCFullYear()}-${mm}-${dd}`;
  }
  return null;
}
