// Yahoo 采集入库 —— Yahoo 链统一入库面(web 代理 / 真机直连 / Node 探针共用):
// payload → putStock(overview 槽 + freshness 戳)/ replaceDatas(全量日K)/
// addPerformanceReports(PK 幂等)→ WebCollectResult。纯函数(store 显式入参,
// 零网络零平台依赖)。
//
// 与 CN applyCollectedToStore(webCollect.ts)的分歧(契约注明):
// - overview 直存 overview 槽(CN 存 null);overviewLastUpdate/lastDataUpdate
//   = 市场本地今天 marketToday(market)——Yahoo 链按"今天已采集"记新鲜度
//   (bar 末根可能是上个交易日,replaceDatas 内部写的末根日期会误判 stale,
//   故 putStock 须在 replaceDatas 之后覆盖)
// - 不写 meta 文本键(F10/股本结构文本是 CN 链专属)
// - capital 由调用方从 composeYahooOverview 承接(payload.capital),此处不重算
// - 日期戳:lastDataUpdate = skipDaily ? 既有 ?? 今天 : 今天
//
// store 注入面(setYahooStore):collectYahooViaProxy/collectYahooForDevice 签名
// 固定(ticker+opts,对齐 MarketCollector 输入形),store 由 App 启动时注入
// (runner.ts 的 store 实例;deviceCollect.setDeviceStore 先例)。未注入即调用
// → 明确抛错,不静默(接线遗漏可定位)。
import type { StoreLike } from '../store.ts';
import type { DailyBar, PerformanceReport } from '../store.ts';
import type { CollectedSnapshot } from '../tdx/quoteClient.ts';
import type { WebCollectResult } from '../webCollect.ts';
import { marketToday } from '../gates.ts';
import type { Market } from '../market.ts';
import type { YahooCapital } from './composeYahooOverview.ts';

export interface YahooCollectedPayload {
  ticker: string; // 落库键(Yahoo 符号:'0700.HK'/'AAPL')
  name: string | null;
  bars: DailyBar[]; // date %Y-%m-%d 升序;volume 原始股数;close 已复权
  snapshot: CollectedSnapshot | null;
  overview: Record<string, number | string>;
  reports: PerformanceReport[];
  /** 同日跳过日K(S3 freshness 接线):bars 为空且不得清空既有日K/lastDataUpdate。 */
  skipDaily?: boolean;
  /** 股本(股):composeYahooOverview 的 capital;缺失 → NaN 字段。 */
  capital: YahooCapital;
}

// ─── store 注入 ──────────────────────────────────────────────────────────────
let yahooStore: StoreLike | null = null;

export function setYahooStore(store: StoreLike): void {
  yahooStore = store;
}

/** 取注入的 store;未注入 → 抛错(采集器在采集前调用,接线遗漏可定位)。 */
export function requireYahooStore(): StoreLike {
  if (!yahooStore) {
    throw new Error('Yahoo 采集未就绪:store 未注入(需先调 setYahooStore)');
  }
  return yahooStore;
}

/** B3 字段级合并:新值无效(NaN/undefined/null/缺失)且旧值有效 → 保留旧值,防
 *  部分字段降级(采集失败/字段缺失)覆盖既有好数据。数值槽 Number.isFinite 校验
 *  (0 合法);字符串槽新值空(null/undefined/'')且旧值非空 → 保留旧值。 */
function mergeOverview(
  incoming: Record<string, number | string>,
  existing: Record<string, unknown> | null | undefined,
): Record<string, number | string> {
  const merged: Record<string, number | string> = { ...incoming };
  if (!existing) return merged;
  for (const [key, oldValue] of Object.entries(existing)) {
    if (!isUsableOverviewValue(merged[key]) && isUsableOverviewValue(oldValue)) {
      merged[key] = oldValue as number | string;
    }
  }
  return merged;
}

/** overview 槽值是否可用:数值必须有限(0 合法);字符串必须非空;其余类型不可用。 */
function isUsableOverviewValue(v: unknown): boolean {
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string') return v !== '';
  return false;
}

/** 代理载荷 → store(putStock overview 槽 / replaceDatas / addPerformanceReports);
 *  返回 run opts 用结果(f10Text 恒 null——Yahoo 链无 F10 文本)。
 *  freshness:skipDaily 时保留既有日K 与 lastDataUpdate,快照/名称/概览仍照常
 *  入库;replaceDatas 内部写末根日期,此处 putStock 覆盖为市场本地今天。 */
export function applyYahooCollectedToStore(
  store: StoreLike,
  payload: YahooCollectedPayload,
  market: Market,
): WebCollectResult {
  const existing = store.getStock(payload.ticker);
  // 全量替换(采集返回全量历史;防 demo 预载数据与真实数据合并混入)。
  // 同日跳过 → bars 为空:guard 免误清(InMemory replaceDatas 先删后加,空数组会
  // 清空既有日K——注释同 src/webCollect.ts:51-53)
  if (payload.bars.length) {
    store.replaceDatas(payload.ticker, payload.bars);
  }
  // B3:字段级合并——降级 payload 不覆盖既有好数据(name 同字符串规则)
  store.putStock({
    ticker: payload.ticker,
    name: payload.name || existing?.name || payload.ticker,
    overview: mergeOverview(payload.overview, existing?.overview),
    overviewLastUpdate: marketToday(market),
    // 同日跳过:保留既有 lastDataUpdate(维持下次跳过判定);否则记市场本地今天
    // (Yahoo 链 fresh 语义;须在 replaceDatas 之后覆盖其末根日期)
    lastDataUpdate: payload.skipDaily
      ? (existing?.lastDataUpdate ?? marketToday(market))
      : marketToday(market),
  });
  // 业绩报告入库(report_date PK 幂等,重复拉取无害;全量拉取 + 幂等,无 F10 门)
  if (payload.reports.length) {
    // 批量内按 report_date 去重(收入表季度+年度合并可能含同日期行;SQLite PK
    // 幂等,但 InMemory/FileStore 仅对既有行去重——此处统一"按 report_date
    // 去重"契约,防 RN/web 落重复报告行)
    const seen = new Set<string>();
    const unique: PerformanceReport[] = [];
    for (const r of payload.reports) {
      if (seen.has(r.report_date)) continue;
      seen.add(r.report_date);
      unique.push(r);
    }
    store.addPerformanceReports(payload.ticker, unique);
  }
  return {
    f10Text: null,
    snapshot: payload.snapshot,
    name: payload.name,
    capital: payload.capital,
  };
}
