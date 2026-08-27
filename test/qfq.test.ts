import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { qfqAdjust, type Bar, type XdxrEventLike } from '../src/adjust.ts';
import { applyQfq, collectAll, fetchDailyBars, fetchXdxrEvents } from '../src/tdx/quoteClient.ts';
import type { TdxClient } from 'node-tdx-market';
import type { DailyBar } from '../src/store.ts';

const fixture = JSON.parse(fs.readFileSync('test/fixtures/600036_daily.json', 'utf8')) as {
  raw: Array<{ date: string; open: number; close: number; high: number; low: number; volume: number | null }>;
  adjusted: Array<{ date: string; open: number; close: number; high: number; low: number; volume: number }>;
  xdxr: XdxrEventLike[];
};

describe('qfq adjust (AC2)', () => {
  it('matches Python adjust.py output on full 600036 history (5835 bars)', () => {
    const bars: Bar[] = fixture.raw.map((b) => ({
      date: b.date,
      open: b.open,
      close: b.close,
      high: b.high,
      low: b.low,
      volume: b.volume ?? 0,
    }));
    const actual = qfqAdjust(bars, fixture.xdxr);
    expect(actual.length).toBe(fixture.adjusted.length);
    // 全量价格字段逐根一致
    for (let i = 0; i < fixture.adjusted.length; i++) {
      const a = actual[i];
      const e = fixture.adjusted[i];
      expect(a.date, `row ${i} date`).toBe(e.date);
      expect(Math.abs(a.close - e.close), `row ${i} close`).toBeLessThan(1e-6);
      expect(Math.abs(a.open - e.open), `row ${i} open`).toBeLessThan(1e-6);
      expect(Math.abs(a.high - e.high), `row ${i} high`).toBeLessThan(1e-6);
      expect(Math.abs(a.low - e.low), `row ${i} low`).toBeLessThan(1e-6);
    }
    // 成交量：1997-2000 早期 bar 复权后超 int64 上限，Python astype(int64)
    // 溢出为负、JS 无 int64——仅最后 250 根（指标消费区）逐位一致
    for (let i = fixture.adjusted.length - 250; i < fixture.adjusted.length; i++) {
      expect(actual[i].volume, `row ${i} volume`).toBe(fixture.adjusted[i].volume);
    }
  });

  it('identity transform when no xdxr events', () => {
    const bars: Bar[] = [{ date: '2026-01-01', open: 1, close: 2, high: 3, low: 0.5, volume: 10 }];
    const out = qfqAdjust(bars, []);
    expect(out[0].close).toBe(2);
    expect(out[0].volume).toBe(10);
  });
});

describe('qfq 生产接线（collectAll → xdxr → qfqAdjust）', () => {
  /** 合法 Gbbq 响应体：count(u16@9) + market(u8) + code(6) + skip(1)
   *  + zipday(u32) + category(u8) + 16B 载荷（对齐 parseXdxrResponse 布局）。 */
  function xdxrResponseBuffer(): Buffer {
    const buf = Buffer.alloc(11 + 29);
    buf.writeUInt16LE(1, 9); // 1 条
    buf[11] = 1; // market: 沪
    buf.write('600036', 12, 6, 'ascii');
    buf.writeUInt32LE(20260710, 19); // zipday
    buf[23] = 1; // category 除权除息
    buf.writeFloatLE(10.03, 24); // fenhong
    buf.writeFloatLE(0, 28); // peigujia
    buf.writeFloatLE(0, 32); // songzhuangu
    buf.writeFloatLE(0, 36); // peigu
    return buf;
  }

  const RAW_BARS: DailyBar[] = [
    { date: '2026-07-09', open: 20, close: 20, high: 20.5, low: 19.8, volume: 1000, amount: 20000 },
    { date: '2026-07-10', open: 19.5, close: 19, high: 19.6, low: 18.9, volume: 1200, amount: 22800 },
    { date: '2026-07-13', open: 18.8, close: 18.5, high: 19, low: 18.4, volume: 900, amount: 16650 },
  ];

  it('fetchDailyBars 日期契约 YYYY-MM-DD（W9：store 契约，overview 不再恒 NaN）', async () => {
    let requestedCode = '';
    const fakeClient = {
      getKline: async (req: { code: string }) => {
        requestedCode = req.code;
        return {
          bars: [
            // F14:按 TDX 库同款姿势构 Date(本地 15:00)——本地历日即解码原始日,
            // 断言与运行 TZ 无关(旧 fixture 用 UTC 零点,本地化格式化后西时区漂移)
            { time: new Date(2026, 7, 7, 15, 0), open: 1000, close: 1010, high: 1020, low: 990, volume: 1000, amount: 100000 },
            { time: new Date(2026, 7, 10, 15, 0), open: 1010, close: 1020, high: 1030, low: 1000, volume: 1100, amount: 110000 },
          ],
          count: 2,
        };
      },
    } as unknown as TdxClient;
    const bars = await fetchDailyBars(fakeClient, '600036');
    expect(requestedCode).toBe('sh600036'); // addPrefix
    expect(bars.map((b) => b.date)).toEqual(['2026-08-07', '2026-08-10']);
    expect(bars[0].close).toBe(1.01); // 分 → 元
  });

  it('F14:本地 15:00 的 Date 在 TZ=UTC-10 下日期不 +1(toISOString 是 UTC 历日)', async () => {
    const savedTz = process.env.TZ;
    try {
      process.env.TZ = 'Etc/GMT+10'; // 夏威夷类时区:旧实现 toISOString → 次日
      const fakeClient = {
        getKline: async () => ({
          bars: [{ time: new Date(2026, 7, 7, 15, 0), open: 1000, close: 1010, high: 1020, low: 990, volume: 1000, amount: 100000 }],
          count: 1,
        }),
      } as unknown as TdxClient;
      const bars = await fetchDailyBars(fakeClient, '600036');
      expect(bars[0].date).toBe('2026-08-07'); // 本地历日 == 解码原始日
    } finally {
      if (savedTz === undefined) delete process.env.TZ;
      else process.env.TZ = savedTz;
    }
  });

  it('applyQfq：YYYY-MM-DD bars + YYYYMMDD 事件 → 复权 + 日期还原为 YYYY-MM-DD', () => {
    const out = applyQfq(RAW_BARS, [{ tradeDate: '20260710', fenhong: 10.03 }]);
    const ratio = (20 - 1.003) / 20; // 事件前收盘复权因子（10.03/10 = 1.003 每股）
    expect(out.map((b) => b.date)).toEqual(['2026-07-09', '2026-07-10', '2026-07-13']);
    expect(out[0].close).toBeCloseTo(20 * ratio, 6);
    expect(out[1].close).toBe(19); // 事件当日及之后不复权
    expect(out[2].close).toBe(18.5);
    expect(out[0].amount).toBe(20000); // amount 透传
  });

  it('applyQfq：无事件 → 原样 raw bars', () => {
    expect(applyQfq(RAW_BARS, [])).toEqual(RAW_BARS);
  });

  it('collectAll 全链：xdxr 事件 → bars 前复权，返回形状不变', async () => {
    const fakeClient = {
      getQuote: async () => [{ price: 19000, high: 19600, low: 18900, open: 19500, volume: 1200, amount: 22800000 }],
      getKline: async () => ({
        bars: [
          { time: new Date('2026-07-09T00:00:00Z'), open: 20000, close: 20000, high: 20500, low: 19800, volume: 1000, amount: 20000000 },
          { time: new Date('2026-07-10T00:00:00Z'), open: 19500, close: 19000, high: 19600, low: 18900, volume: 1200, amount: 22800000 },
        ],
        count: 2,
      }),
      getStockList: async () => [{ code: '600036', name: '招商银行' }],
      sendCommand: async () => ({ data: xdxrResponseBuffer() }),
    } as unknown as TdxClient;

    const collected = await collectAll(fakeClient, '600036', { get: () => null, set: () => {} });
    expect(collected.ticker).toBe('600036');
    expect(collected.name).toBe('招商银行');
    expect(collected.snapshot?.price).toBe(19);
    expect(collected.capital).toBeNull();
    const ratio = (20 - 1.003) / 20;
    expect(collected.bars[0].date).toBe('2026-07-09');
    expect(collected.bars[0].close).toBeCloseTo(20 * ratio, 6);
    expect(collected.bars[1].close).toBe(19);
  });

  it('collectAll：xdxr 拉取失败 → 原样 raw bars（不阻断采集）', async () => {
    const fakeClient = {
      getQuote: async () => [{ price: 19000, high: 19600, low: 18900, open: 19500, volume: 1200, amount: 22800000 }],
      getKline: async () => ({
        bars: [
          { time: new Date('2026-07-09T00:00:00Z'), open: 20000, close: 20000, high: 20500, low: 19800, volume: 1000, amount: 20000000 },
          { time: new Date('2026-07-10T00:00:00Z'), open: 19500, close: 19000, high: 19600, low: 18900, volume: 1200, amount: 22800000 },
        ],
        count: 2,
      }),
      getStockList: async () => [{ code: '600036', name: '招商银行' }],
      sendCommand: async () => {
        throw new Error('xdxr 超时');
      },
    } as unknown as TdxClient;

    const collected = await collectAll(fakeClient, '600036', { get: () => null, set: () => {} });
    expect(collected.bars[0].close).toBe(20); // raw
    expect(collected.bars[0].date).toBe('2026-07-09');
    expect(await fetchXdxrEvents(fakeClient, '600036')).toEqual([]);
  });
});
