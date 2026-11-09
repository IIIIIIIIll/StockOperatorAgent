// start() 的输入校验 —— 从 analysisController 抽出的**纯函数**(B6 重构,2026-11-09)。
//
// 只回答一个问题:「这个 ticker 在该市场能不能分析?」零依赖、零副作用,因此
// 文案可以逐字钉住(它们在 UI 与 PRD 里是契约),也不必为了测北交所拦截而搭起
// 整个控制器。
import { normalizeTicker, type Market } from '../../src/market.ts';

/** 北交所拦截文案(仅沪深市场;手动选港股/美股时 6 位数字归各自格式校验)。 */
export const BJ_UNSUPPORTED_MESSAGE =
  '北交所(BJ)股票暂不支持分析:TDX 数据源不覆盖 BJ 证券,请使用沪深 A 股代码';

/** 各市场的格式错误文案(北交所分支逐字保留,不归此处)。 */
export const FORMAT_MESSAGES: Record<Market, string> = {
  cn: '请输入有效的沪深A股代码：六位数字',
  hk: '请输入有效的港股代码：一至五位数字',
  us: '请输入有效的美股代码：字母开头，可含 . 或 -',
};

export type StartGuardResult =
  /** 通过:ticker 为规范化后的代码,market 为归一化后的市场(可能与入参不同)。 */
  | { ok: true; ticker: string; market: Market }
  /** 拒绝:message 直接进 s.error,market 表示应同步到 UI 的市场(北交所为 null)。 */
  | { ok: false; message: string; market: Market | null };

/** 校验输入(纯函数)。北交所文案优先于格式校验,与抽取前逐字一致。 */
export function checkStartInput(ticker: string, market: Market): StartGuardResult {
  const code = ticker.trim();
  if (market === 'cn' && /^\d{6}$/.test(code) && (code.startsWith('4') || code.startsWith('8'))) {
    return { ok: false, message: BJ_UNSUPPORTED_MESSAGE, market: null };
  }
  const normalized = normalizeTicker(code, market);
  if (normalized === null) {
    return { ok: false, message: FORMAT_MESSAGES[market], market };
  }
  return { ok: true, ticker: normalized.ticker, market: normalized.market };
}
