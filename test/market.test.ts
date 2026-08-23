// market 模型单测:detectMarket 全表 / hkSymbolCandidates 候选序 /
// normalizeTicker 按市场强制校验 / marketOfStoreTicker 反推 / marketInfo 元信息表。纯函数零 IO,无 mock。
import { describe, expect, it } from 'vitest';
import { detectMarket, hkSymbolCandidates, marketInfo, marketOfStoreTicker, normalizeTicker } from '../src/market.ts';

describe('detectMarket', () => {
  it('CN:6 位数字且非 4/8 开头 → cn', () => {
    expect(detectMarket('600036')).toBe('cn');
    expect(detectMarket('000001')).toBe('cn');
    expect(detectMarket('300750')).toBe('cn');
    expect(detectMarket('688981')).toBe('cn');
  });

  it('北交所语义保留:4/8 开头的 6 位数字 → null', () => {
    expect(detectMarket('430047')).toBeNull();
    expect(detectMarket('830799')).toBeNull();
  });

  it('HK:1-5 位数字 → hk(含 5 位前导零)', () => {
    expect(detectMarket('700')).toBe('hk');
    expect(detectMarket('00700')).toBe('hk');
    expect(detectMarket('09988')).toBe('hk');
    expect(detectMarket('3690')).toBe('hk');
    expect(detectMarket('99887')).toBe('hk');
    expect(detectMarket('123')).toBe('hk');
    expect(detectMarket('60003')).toBe('hk');
  });

  it('边界:7 位数字 → null(超 CN 6 位与 HK 5 位上限)', () => {
    expect(detectMarket('1234567')).toBeNull();
    expect(detectMarket('6000361')).toBeNull();
  });

  it('US:字母开头 ≤10 字符(含 . / -)→ us', () => {
    expect(detectMarket('aapl')).toBe('us');
    expect(detectMarket('AAPL')).toBe('us');
    expect(detectMarket('BRK.B')).toBe('us');
    expect(detectMarket('BF-B')).toBe('us');
    expect(detectMarket('A')).toBe('us');
  });

  it('其它 → null(空串/数字开头带字母/超长)', () => {
    expect(detectMarket('')).toBeNull();
    expect(detectMarket('1A')).toBeNull();
    expect(detectMarket('600036A')).toBeNull();
    expect(detectMarket('ABCDEFGHIJK')).toBeNull(); // 11 字符超上限
  });
});

describe('hkSymbolCandidates', () => {
  it('≤4 位 → 左补零到 4 位唯一候选', () => {
    expect(hkSymbolCandidates('700')).toEqual(['0700.HK']);
    expect(hkSymbolCandidates('3690')).toEqual(['3690.HK']);
    expect(hkSymbolCandidates('7')).toEqual(['0007.HK']);
  });

  it('5 位且首 0 → [4 位形式(去首前导零), 5 位原样]', () => {
    expect(hkSymbolCandidates('00700')).toEqual(['0700.HK', '00700.HK']);
    expect(hkSymbolCandidates('09988')).toEqual(['9988.HK', '09988.HK']); // 4 位形式=官方码(Yahoo 实测 9988.HK 200)
  });

  it('5 位非 0 首 → 原样唯一', () => {
    expect(hkSymbolCandidates('99887')).toEqual(['99887.HK']);
  });
});

describe('normalizeTicker', () => {
  it('CN:6 位且非 4/8 → 原样', () => {
    expect(normalizeTicker('600036', 'cn')).toEqual({ market: 'cn', ticker: '600036' });
    expect(normalizeTicker('000001', 'cn')).toEqual({ market: 'cn', ticker: '000001' });
  });

  it('HK → 首候选(真实解析留采集层试探)', () => {
    expect(normalizeTicker('700', 'hk')).toEqual({ market: 'hk', ticker: '0700.HK' });
    expect(normalizeTicker('00700', 'hk')).toEqual({ market: 'hk', ticker: '0700.HK' });
    expect(normalizeTicker('09988', 'hk')).toEqual({ market: 'hk', ticker: '9988.HK' }); // 官方 4 位码
    expect(normalizeTicker('99887', 'hk')).toEqual({ market: 'hk', ticker: '99887.HK' });
  });

  it('US → 大写原样(保留 . 与 -)', () => {
    expect(normalizeTicker('aapl', 'us')).toEqual({ market: 'us', ticker: 'AAPL' });
    expect(normalizeTicker('BRK.B', 'us')).toEqual({ market: 'us', ticker: 'BRK.B' });
    expect(normalizeTicker('BF-B', 'us')).toEqual({ market: 'us', ticker: 'BF-B' });
  });

  it('格式不符 → null(按所选市场严格校验,不跨市场兜底)', () => {
    expect(normalizeTicker('AAPL', 'cn')).toBeNull();
    expect(normalizeTicker('AAPL', 'hk')).toBeNull();
    expect(normalizeTicker('00700', 'us')).toBeNull();
    expect(normalizeTicker('600036', 'us')).toBeNull();
    expect(normalizeTicker('600036', 'hk')).toBeNull();
    expect(normalizeTicker('430047', 'cn')).toBeNull(); // 北交所前缀在 cn 下同样拦截
    expect(normalizeTicker('430047', 'us')).toBeNull();
    expect(normalizeTicker('0700', 'us')).toBeNull();
    expect(normalizeTicker('1234567', 'hk')).toBeNull(); // 超 HK 5 位上限
    expect(normalizeTicker('', 'cn')).toBeNull();
  });
});

describe('marketOfStoreTicker', () => {
  it('CN:6 位数字 store 键 → cn', () => {
    expect(marketOfStoreTicker('600036')).toBe('cn');
  });

  it('HK:数字+.HK 后缀 → hk', () => {
    expect(marketOfStoreTicker('0700.HK')).toBe('hk');
    expect(marketOfStoreTicker('9988.HK')).toBe('hk');
    expect(marketOfStoreTicker('60003.HK')).toBe('hk'); // 契约正则 ^\d{1,5}\.HK$ 允许 5 位数字
  });

  it('US:字母开头(含 . 与 -)→ us', () => {
    expect(marketOfStoreTicker('AAPL')).toBe('us');
    expect(marketOfStoreTicker('BRK.B')).toBe('us');
    expect(marketOfStoreTicker('BF-B')).toBe('us');
  });

  it('无法识别 → null(空串/无后缀/超长)', () => {
    expect(marketOfStoreTicker('')).toBeNull();
    expect(marketOfStoreTicker('12345')).toBeNull(); // 5 位数字但无 .HK 后缀
    expect(marketOfStoreTicker('1234567')).toBeNull(); // 超 CN 6 位上限
    expect(marketOfStoreTicker('0700')).toBeNull(); // 无 .HK 后缀
  });
});

describe('marketInfo', () => {
  it('cn:沪深A股/上海时区/CNY', () => {
    expect(marketInfo('cn')).toEqual({
      market: 'cn',
      label: '沪深A股',
      timeZone: 'Asia/Shanghai',
      currency: 'CNY',
      promptRules: '',
    });
  });

  it('hk:港股/香港时区/HKD', () => {
    expect(marketInfo('hk')).toEqual({
      market: 'hk',
      label: '港股',
      timeZone: 'Asia/Hong_Kong',
      currency: 'HKD',
      promptRules: '',
    });
  });

  it('us:美股/纽约时区/USD', () => {
    expect(marketInfo('us')).toEqual({
      market: 'us',
      label: '美股',
      timeZone: 'America/New_York',
      currency: 'USD',
      promptRules: '',
    });
  });
});
