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
// - 不写 CN 的 meta 文本键(F10/股本结构文本是 CN 链专属);但写 hk/us 自己的
//   两份结构化 meta:公司画像 JSON(yahoo-profile:)与股本 JSON(yahoo-capital:)
//   ——DataScreen 读(换手率列/画像 chips)、pipeline 读(块 1.5 画像段)
// - capital 由调用方从 composeYahooOverview 承接(payload.capital),此处不重算
// - 日期戳:lastDataUpdate = skipDaily ? 既有 ?? 今天 : (末根 bar 日期 ?? 既有 ?? null)
//   盘中残缺 bar 与盘前/隔日补采一律不前进 —— 详见 nextLastDataUpdate 注释
//
// store 注入面(setYahooStore):collectYahooViaProxy/collectYahooForDevice 签名
// 固定(ticker+opts,对齐 MarketCollector 输入形),store 由 App 启动时注入
// (runner.ts 的 store 实例;deviceCollect.setDeviceStore 先例)。未注入即调用
// → 明确抛错,不静默(接线遗漏可定位)。
import type { StoreLike } from '../store.ts';
import type { DailyBar, PerformanceReport } from '../store.ts';
import type { CollectedSnapshot } from '../tdx/quoteClient.ts';
import type { WebCollectResult } from '../webCollect.ts';
import { marketToday, marketSessionClosed } from '../gates.ts';
import type { Market } from '../market.ts';
import type { YahooCapital } from './composeYahooOverview.ts';
import type { YahooProfile } from './composeYahooProfile.ts';
import { yahooAnnualKey, yahooCapitalKey, yahooProfileKey } from '../metaKeys.ts';

export interface YahooCollectedPayload {
  ticker: string; // 落库键（Yahoo 符号:'0700.HK'/'AAPL'）
  name: string | null;
  bars: DailyBar[]; // date %Y-%m-%d 升序;volume 原始股数;close 已复权
  snapshot: CollectedSnapshot | null;
  overview: Record<string, number | string>;
  reports: PerformanceReport[];
  /** 公司画像/分析师预期（assetProfile/calendarEvents/earningsTrend/…）;
   *  quoteSummary 降级 → null（不写 meta，保留既有画像）。 */
  profile: YahooProfile | null;
  /** 同日跳过日K（S3 freshness 接线）：bars 为空且不得清空既有日K/lastDataUpdate。 */
  skipDaily?: boolean;
  /** 股本（股）：composeYahooOverview 的 capital；缺失 → NaN 字段。 */
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
  /** 时钟注入（测试/探针）；缺省取当前时刻。仅用于"是否已收盘"判定。 */
  now: Date = new Date(),
): WebCollectResult {
  const existing = store.getStock(payload.ticker);
  // "今天"与"是否已收盘"必须来自同一个时刻（注入的 now），否则跨午夜/回放时两者会分叉
  const today = marketToday(market, now);
  // 末根是否为"今天但还没收盘"的进行中 bar(见下方 lastDataUpdate 处的注释)
  const lastBarDate = payload.bars.length ? payload.bars[payload.bars.length - 1]!.date : null;
  const intradayBar = lastBarDate === today && !marketSessionClosed(market, now);
  // lastDataUpdate 是 dailyFresh 的唯一依据,三种情形分开写清楚:
  //   同日跳过 → 维持既有戳;盘中残缺 bar → 不前进(下次仍需重取);其余 → 末根 bar 日期
  const nextLastDataUpdate = (): string | null => {
    if (payload.skipDaily) return existing?.lastDataUpdate ?? today;
    if (intradayBar) return existing?.lastDataUpdate ?? null;
    // P1(评审 2026-11-21):此处旧实现无条件返回 "今天",于是**盘前采集**
    // (HK 08:30 / 美股盘前的 22:00 HKT,亚洲时区的常规时段)的末根还是昨天的 bar,
    // 却盖上了今天的戳 → 当天收盘后的 run 被判 dailyFresh → skipDaily → 当天那根
    // 完整 bar 永远进不了库,报告变成"今天的价 + 昨天的 MA/RSI"。bars 为空同理。
    // 语义修正:戳 = 末根 bar 的日期(与 CN 链 replaceDatas 写末根日期的口径一致);
    // 没有任何 bar 时保留既有戳,绝不凭空盖今天。
    return lastBarDate ?? (existing?.lastDataUpdate ?? null);
  };
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
    overviewLastUpdate: today,
    // 同日跳过:保留既有 lastDataUpdate(维持下次跳过判定);否则记市场本地今天
    // (Yahoo 链 fresh 语义;须在 replaceDatas 之后覆盖其末根日期)
    // P1-7(评审 2026-11-09):末根就是今天且**尚未收盘** → 那是进行中 bar,
    // 不能盖今天的戳,否则收盘后的分析按 skipDaily 复用这根残缺 bar 一整天。
    lastDataUpdate: nextLastDataUpdate(),
  });
  // 业绩报告入库(report_date PK 幂等,重复拉取无害;全量拉取 + 幂等,无 F10 门)
  //
  // 季度行 → performance_reports(按 report_date 去重);
  // 年度行 → yahoo-annual: meta —— 港股 Q4 季度行与 FY 行同为 12-31、美股 FY 末日
  // 也是 Q4 末日,同日两行在 PK 上相撞(旧实现季度行胜 → FY 行静默丢失)。分流的
  // 好处:季度序列不被年度行污染(QoQ/YoY 基期正确),FY 数据也不丢。
  if (payload.reports.length) {
    const seen = new Set<string>();
    const quarterly: PerformanceReport[] = [];
    const annual: PerformanceReport[] = [];
    for (const r of payload.reports) {
      const isAnnual = r.fields['period_kind'] === 'FY';
      if (isAnnual) {
        annual.push(r);
        continue;
      }
      if (seen.has(r.report_date)) continue;
      seen.add(r.report_date);
      quarterly.push(r);
    }
    if (quarterly.length) store.addPerformanceReports(payload.ticker, quarterly);
    if (annual.length) {
      // 同日多行年度(极少)→ 按 report_date 去重,后者作废
      const byDate = new Map<string, PerformanceReport>();
      for (const r of annual) byDate.set(r.report_date, r);
      store.setMeta(yahooAnnualKey(payload.ticker), JSON.stringify([...byDate.values()]));
    }
  }
  // 公司画像/股本写入 meta(hk/us 自己的键,与 CN 的 capital:/f10: 不混用):
  // 画像降级(null)→ 不覆盖既有画像;股本全 NaN 同样不覆盖。
  if (payload.profile) {
    store.setMeta(yahooProfileKey(payload.ticker), JSON.stringify(payload.profile));
  }
  if (Number.isFinite(payload.capital.zongguben) || Number.isFinite(payload.capital.liutongguben)) {
    store.setMeta(yahooCapitalKey(payload.ticker), JSON.stringify(payload.capital));
  }
  return {
    ticker: payload.ticker,
    f10Text: null,
    snapshot: payload.snapshot,
    name: payload.name,
    capital: payload.capital,
  };
}
