import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { qfqAdjust, type Bar, type XdxrEventLike } from '../src/adjust.ts';
import { applyQfq, collectAll, fetchDailyBars, fetchXdxrEvents } from '../src/tdx/quoteClient.ts';
import type { TdxClient } from 'node-tdx-market';
import type { DailyBar } from '../src/store.ts';

const fixture = JSON.parse(fs.readFileSync('test/fixtures/600036_daily.json', 'utf8')) as {
  raw: Array<{ date: string; open: number; close: number; high: number; low: number; volume: number | null }>;
  xdxr: XdxrEventLike[];
};

/** 独立 oracle：对每根 bar 单独取「该日期之后的所有事件」逐条相乘。
 *  结构与 src/adjust.ts 实现（降序事件 × 前缀集合）相反（bar 主序），避免两处
 *  同错互证。比率仍用**原始**收盘价计算（复权比率定义在原价上）。
 *  历史包袱：本文件曾以 fixture.adjusted 为真值，而那份数据由 Python 同款
 *  累计因子算法导出，2026-11-19 判定为错值（见 src/adjust.ts 头注释）。 */
function referenceQfq(bars: Bar[], xdxr: XdxrEventLike[]): Bar[] {
  const n = (v: unknown) =>
    v === null || v === undefined || Number.isNaN(v) ? 0 : Number(v);
  const ratios = xdxr.map((ev) => {
    let prev = NaN;
    for (const b of bars) if (b.date < ev.tradeDate) prev = b.close; // 该事件日前最后一根
    const song = n(ev.songzhuangu) / 10;
    const peig = n(ev.peigu) / 10;
    const pjia = n(ev.peigujia);
    const fh = n(ev.fenhong) / 10;
    const suo = n(ev.suogu) / 10;
    const den = prev * (1 + song + peig - suo);
    return {
      tradeDate: ev.tradeDate,
      price: den > 0 ? (prev - fh + peig * pjia) / den : 1,
      vol: 1 + song + peig - suo,
    };
  });
  return bars.map((b) => {
    let p = 1;
    let v = 1;
    for (const r of ratios) {
      if (b.date < r.tradeDate) {
        p *= r.price;
        if (r.vol > 0) v *= r.vol;
      }
    }
    return {
      ...b,
      open: b.open * p,
      close: b.close * p,
      high: b.high * p,
      low: b.low * p,
      volume: Math.round(b.volume * v),
    };
  });
}

describe('qfq adjust (AC2)', () => {
  it('全 5835 根与独立 oracle 逐根一致（每个事件只乘一次）', () => {
    const bars: Bar[] = fixture.raw.map((b) => ({
      date: b.date,
      open: b.open,
      close: b.close,
      high: b.high,
      low: b.low,
      volume: b.volume ?? 0,
    }));
    const actual = qfqAdjust(bars, fixture.xdxr);
    const expected = referenceQfq(bars, fixture.xdxr);
    expect(actual.length).toBe(expected.length);
    for (let i = 0; i < expected.length; i++) {
      const a = actual[i];
      const e = expected[i];
      expect(a.date, `row ${i} date`).toBe(e.date);
      expect(Math.abs(a.close - e.close), `row ${i} close`).toBeLessThan(1e-9);
      expect(Math.abs(a.open - e.open), `row ${i} open`).toBeLessThan(1e-9);
      expect(Math.abs(a.high - e.high), `row ${i} high`).toBeLessThan(1e-9);
      expect(Math.abs(a.low - e.low), `row ${i} low`).toBeLessThan(1e-9);
      // 成交量仅差浮点累加顺序带来的舍入（四舍五入边界最多差 1 手）
      expect(Math.abs(a.volume - e.volume), `row ${i} volume`).toBeLessThanOrEqual(1);
    }
  });

  it('两个事件时不得把新事件比率重复乘进更老的 bar（P0 回归）', () => {
    // 手算：rA=(8-0.1)/8（2923-01-03 事件）、rB=(9-0.1)/9（2022-01-04 事件）
    const bars: Bar[] = [
      { date: '20200101', open: 10, close: 10, high: 10, low: 10, volume: 1000 },
      { date: '20210104', open: 9, close: 9, high: 9, low: 9, volume: 1000 },
      { date: '20220104', open: 8, close: 8, high: 8, low: 8, volume: 1000 },
      { date: '20230103', open: 7, close: 7, high: 7, low: 7, volume: 1000 },
    ];
    const rA = (8 - 0.1) / 8;
    const rB = (9 - 0.1) / 9;
    const out = qfqAdjust(bars, [
      { tradeDate: '20230103', fenhong: 1 }, //
      { tradeDate: '20220104', fenhong: 1 },
    ]);
    expect(out[0].close).toBeCloseTo(10 * rA * rB, 10); // 两根事件都晚于它
    expect(out[1].close).toBeCloseTo(9 * rA * rB, 10);
    expect(out[2].close).toBeCloseTo(8 * rA, 10); // 只受更新的那件影响
    expect(out[3].close).toBeCloseTo(7, 10); // 事件当日不参与自身事件
    // 纯现金分红 ratioVol=1，成交量不得变化
    expect(out.map((b) => b.volume)).toEqual([1000, 1000, 1000, 1000]);
  });

  it('identity transform when no xdxr events', () => {
    const bars: Bar[] = [{ date: '2026-01-01', open: 1, close: 2, high: 3, low: 0.5, volume: 10 }];
    const out = qfqAdjust(bars, []);
    expect(out[0].close).toBe(2);
    expect(out[0].volume).toBe(10);
  });

  it('缩股(cat 11/12):价格×2 与成交量÷2 必须同口径（P2 回归）', () => {
    // 每10股缩5股 = 2 股缩成 1 股:事件前 5.00 → 事件日 10.00,成交量对半。
    // 旧实现分母漏减缩股 → ratioPrice = 1.0(价格跳空原封不动进 MA/RSI),而
    // ratioVol = 0.5(量已被减半)—— 价格与成交量自相矛盾。
    const bars: Bar[] = [
      { date: '20250102', open: 5, close: 5, high: 5, low: 5, volume: 2000 },
      { date: '20250303', open: 10, close: 10, high: 10, low: 10, volume: 1000 },
      { date: '20250304', open: 10.2, close: 10.2, high: 10.2, low: 10.2, volume: 1000 },
    ];
    const out = qfqAdjust(bars, [{ tradeDate: '20250303', suogu: 5 }]);
    expect(out[0].close).toBeCloseTo(10, 10); // 5 × 2.0
    expect(out[0].open).toBeCloseTo(10, 10);
    expect(out[0].volume).toBe(1000); // 2000 × 0.5
    // 事件当日及其后不参与自身事件
    expect(out[1].close).toBeCloseTo(10, 10);
    expect(out[1].volume).toBe(1000);
    expect(out[2].close).toBeCloseTo(10.2, 10);
    // 复权后跳空消失:事件日涨跌幅应为 0 而非 +100%
    expect(out[1].close / out[0].close).toBeCloseTo(1, 10);
    expect(out[1].changePct).toBeCloseTo(0, 10);
  });

  it('送转/配股/缩股同时存在:分母 = prev*(1+送转+配股-缩股)', () => {
    // 每10股:送3转2(合计 0.5)、配1(0.1,配股价 4)、缩1(0.1) → 因子 1.5
    // prevClose=10,除息 0.5/10股 = 0.05 → 分子 10 - 0.05 + 0.1*4 = 10.35 → 10.35/15
    const bars: Bar[] = [
      { date: '20250102', open: 10, close: 10, high: 10, low: 10, volume: 1000 },
      { date: '20250303', open: 8, close: 8, high: 8, low: 8, volume: 1000 },
    ];
    const out = qfqAdjust(bars, [
      { tradeDate: '20250303', fenhong: 0.5, songzhuangu: 3, peigu: 1, peigujia: 4, suogu: 1 },
    ]);
    const den = 10 * (1 + 0.3 + 0.1 - 0.1);
    const num = 10 - 0.05 + 0.1 * 4;
    expect(out[0].close).toBeCloseTo(10 * (num / den), 10);
    expect(out[0].volume).toBe(1300); // 1000 × (1 + 0.3 + 0.1 - 0.1)
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
