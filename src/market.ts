// 市场模型:Market 三市场类型 + 市场元信息 + ticker 识别/规范化(S1)
// store/fetch ticker 键约定:CN 裸 6 位数字('600036')、HK Yahoo 符号(4 位左补
// 零 + '.HK',如 '0700.HK')、US 大写 ticker('AAPL'/'BRK.B')。三市场格式天然
// 无碰撞(CN 纯数字 6 位 / HK 数字+.HK / US 字母开头),store ticker TEXT PK
// 直接复用,零迁移。
// 纯 TS 零依赖:web/RN/Node 三端共享,不 import node:/react-native。
export type Market = 'cn' | 'hk' | 'us';

/** 输入框旁下拉面板选项(UI 渲染顺序即此序)。市场一律手动选择,无自动识别。 */
export const MARKET_CHOICES: ReadonlyArray<{ value: Market; label: string }> = [
  { value: 'cn', label: '沪深A股' },
  { value: 'hk', label: '港股' },
  { value: 'us', label: '美股' },
];

export interface MarketInfo {
  market: Market;
  label: string;
  timeZone: string;
  currency: string;
  lotSize: number | null;
  /** 提示词市场规则文本(S4 填充,本切片恒空串占位)。 */
  promptRules: string;
}

const MARKET_INFOS: Record<Market, MarketInfo> = {
  cn: {
    market: 'cn',
    label: '沪深A股',
    timeZone: 'Asia/Shanghai',
    currency: 'CNY',
    lotSize: 100,
    promptRules: '',
  },
  hk: {
    market: 'hk',
    label: '港股',
    timeZone: 'Asia/Hong_Kong',
    currency: 'HKD',
    lotSize: null,
    promptRules: '',
  },
  us: {
    market: 'us',
    label: '美股',
    timeZone: 'America/New_York',
    currency: 'USD',
    lotSize: null,
    promptRules: '',
  },
};

export function marketInfo(market: Market): MarketInfo {
  return MARKET_INFOS[market];
}

/** 输入 → 市场判定:CN 6 位数字且非 4/8 开头(北交所语义保留);HK 1-5 位数字;
 *  US 字母开头、≤10 字符(可含 ./-);其余 null。顺序敏感:先 CN 后 HK——6 位
 *  数字优先 CN,4/8 开头落空后 6 位也不满足 HK 上限(1-5 位),故 '430047' →
 *  null、'1234567'(7 位)→ null、'60003'(5 位)→ hk。 */
export function detectMarket(input: string): Market | null {
  if (/^\d{6}$/.test(input) && input[0] !== '4' && input[0] !== '8') return 'cn';
  if (/^\d{1,5}$/.test(input)) return 'hk';
  if (/^[A-Za-z][A-Za-z0-9.-]{0,9}$/.test(input)) return 'us';
  return null;
}

/** 港股代码候选(采集层按序试探,首个 chart 命中即定符号):
 *  ≤4 位 → 左补零到 4 位唯一候选;5 位且首字符 '0' → [4 位形式(去首前导零,
 *  即 input.slice(1)), 5 位原样]——HKEX 5 位码 = 官方 4 位码加前导 0,故
 *  '00700'→['0700.HK','00700.HK']、'09988'→['9988.HK','09988.HK'](Yahoo
 *  实测 2026-08-20:'9988.HK' 200/'09988.HK' 404,4 位形式即真实符号;历史
 *  实现曾取 '0988.HK'(去第二字符),那是**另一家公司**(0988),且 App 归一化
 *  只取首候选 → '09988' 输入永远解析失败——已修正);5 位非 0 首 → 原样唯一。
 *  例:'700'→['0700.HK']、'3690'→['3690.HK']、'99887'→['99887.HK']。 */
export function hkSymbolCandidates(input: string): string[] {
  if (input.length <= 4) return [`${input.padStart(4, '0')}.HK`];
  if (input.startsWith('0')) return [`${input.slice(1)}.HK`, `${input}.HK`];
  return [`${input}.HK`];
}

/** 用户输入 → 规范 ticker(store/fetch 键):按所选市场**强制校验**输入(格式
 *  不符 → null):CN 原样 6 位;HK 取首候选(真实解析在采集层对候选逐个试探,
 *  本函数只定首选);US 大写原样。市场由 UI 下拉手动选择,无自动识别。 */
export function normalizeTicker(input: string, market: Market): { market: Market; ticker: string } | null {
  if (market === 'cn') {
    if (!/^\d{6}$/.test(input) || input.startsWith('4') || input.startsWith('8')) return null;
    return { market: 'cn', ticker: input };
  }
  if (market === 'hk') {
    if (!/^\d{1,5}$/.test(input)) return null;
    return { market: 'hk', ticker: hkSymbolCandidates(input)[0] };
  }
  if (!/^[A-Za-z][A-Za-z0-9.-]{0,9}$/.test(input)) return null;
  return { market: 'us', ticker: input.toUpperCase() };
}

/** store/fetch 键(规范化产物)→ 市场反推(lastRun 恢复等场景;store 键已规范化,
 *  格式即市场,无需 4/8 拦截——BJ 票从不入库)。'600036'→cn;'0700.HK'/'9988.HK'
 *  →hk;'AAPL'/'BRK.B'→us;无法识别 → null。 */
export function marketOfStoreTicker(ticker: string): Market | null {
  if (/^\d{6}$/.test(ticker)) return 'cn';
  if (/^\d{1,5}\.HK$/i.test(ticker)) return 'hk';
  if (/^[A-Za-z][A-Za-z0-9.-]{0,9}$/.test(ticker)) return 'us';
  return null;
}
