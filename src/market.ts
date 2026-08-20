// 市场模型:Market 三市场类型 + 市场元信息 + ticker 识别/规范化(S1)
// store/fetch ticker 键约定:CN 裸 6 位数字('600036')、HK Yahoo 符号(4 位左补
// 零 + '.HK',如 '0700.HK')、US 大写 ticker('AAPL'/'BRK.B')。三市场格式天然
// 无碰撞(CN 纯数字 6 位 / HK 数字+.HK / US 字母开头),store ticker TEXT PK
// 直接复用,零迁移。
// 纯 TS 零依赖:web/RN/Node 三端共享,不 import node:/react-native。
export type Market = 'cn' | 'hk' | 'us';

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
 *  ≤4 位 → 左补零到 4 位唯一候选;5 位且首字符 '0' → [4 位形式(去掉第二位,
 *  即首 0 + 后 3 位), 5 位原样]——'00700'→['0700.HK','00700.HK']、
 *  '09988'→['0988.HK','09988.HK'](决策见 PRD 例表,4 位形式故意非 '9988':
 *  若首候选是存在的 4 位码会短路,5 位码候选就永远探不到;S3 探针 '09988'
 *  须落 09988.HK 佐证);5 位非 0 首 → 原样唯一。
 *  例:'700'→['0700.HK']、'3690'→['3690.HK']、'99887'→['99887.HK']。 */
export function hkSymbolCandidates(input: string): string[] {
  if (input.length <= 4) return [`${input.padStart(4, '0')}.HK`];
  if (input.startsWith('0')) return [`${input.slice(0, 1)}${input.slice(2)}.HK`, `${input}.HK`];
  return [`${input}.HK`];
}

/** 用户输入 → 规范 ticker(store/fetch 键):CN 原样 6 位;HK 取首候选(真实
 *  解析在采集层对候选逐个试探,本函数只定首选);US 大写原样。无法识别 → null。 */
export function normalizeTicker(input: string): { market: Market; ticker: string } | null {
  const market = detectMarket(input);
  if (market === null) return null;
  if (market === 'hk') return { market, ticker: hkSymbolCandidates(input)[0] };
  if (market === 'us') return { market, ticker: input.toUpperCase() };
  return { market, ticker: input };
}
