import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { composeOverview, latestPeriodValue } from '../src/overview.ts';
import { parseFinanceIndicatorsAllTables } from '../src/f10.ts';
import type { DailyBar } from '../src/store.ts';

const fixtureRaw: DailyBar[] = JSON.parse(
  fs.readFileSync('test/fixtures/600036_daily.json', 'utf8'),
).raw as DailyBar[];
// fixture 日期为 YYYYMMDD（Python 导出），overview 契约 YYYY-MM-DD
const fixture = {
  raw: fixtureRaw.map((b) => ({ ...b, date: b.date.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') })),
};
const f10Text = fs.readFileSync('test/fixtures/f10_tdx.txt', 'utf8');
const f10 = parseFinanceIndicatorsAllTables(f10Text);

const SNAPSHOT = { price: 38.8, high: 39.1, low: 38.48, open: 38.9 };

describe('composeOverview (22 列,对齐 Python compose_overview)', () => {
  it('price from snapshot; change_percent from prev close', () => {
    const row = composeOverview({
      ticker: '600036', name: '招商银行',
      snapshot: SNAPSHOT, capital: null,
      f10, bars: fixture.raw, today: '2026-08-09',
    });
    expect(row.latest_price).toBe(38.8);
    const prev = fixture.raw[fixture.raw.length - 2].close;
    expect(row.prev_close).toBe(prev);
    expect(row.change_percent).toBeCloseTo(((38.8 - prev) / prev) * 100, 6);
    expect(row.change_amount).toBeCloseTo(38.8 - prev, 6);
    expect(row.high).toBe(39.1);
    expect(row.low).toBe(38.48);
  });

  it('non-trading-day: volume/amount NaN (末根 bar 非当日)', () => {
    const row = composeOverview({
      ticker: '600036', name: '招商银行',
      snapshot: SNAPSHOT, capital: null,
      f10, bars: fixture.raw, today: '2026-08-09', // 周六,末根 08-07
    });
    expect(Number.isNaN(row.volume)).toBe(true);
    expect(Number.isNaN(row.amount)).toBe(true);
  });

  it('trading-day: volume/amount from last bar', () => {
    const row = composeOverview({
      ticker: '600036', name: '招商银行',
      snapshot: SNAPSHOT, capital: null,
      f10, bars: fixture.raw, today: '2026-08-07',
    });
    expect(row.volume).toBe(fixture.raw[fixture.raw.length - 1].volume);
    expect(row.amount).toBe(fixture.raw[fixture.raw.length - 1].amount);
  });

  it('pe/pb derived from F10 latest period values', () => {
    const row = composeOverview({
      ticker: '600036', name: '招商银行',
      snapshot: SNAPSHOT, capital: null,
      f10, bars: fixture.raw, today: '2026-08-09',
    });
    const eps = latestPeriodValue(f10, '基本每股收益(元)');
    const nwps = latestPeriodValue(f10, '每股净资产(元)');
    expect(eps).toBeGreaterThan(0);
    expect(row.pe_dynamic).toBeCloseTo(38.8 / eps, 6);
    expect(row.pb).toBeCloseTo(38.8 / nwps, 6);
    // 2026-11-19 评审遗留：cn 概览槽原本没有 eps 键 → DataScreen「每股收益」
    // 对沪深恒显示 N/A。同一个 F10 值既是 pe_dynamic 的分母，也是概览的 eps。
    expect(row.eps).toBe(eps);
  });

  it('52 周高低：today 前 365 天窗口的日K 极值（不靠新数据源）', () => {
    const row = composeOverview({
      ticker: '600036', name: '招商银行',
      snapshot: SNAPSHOT, capital: null,
      f10, bars: fixture.raw, today: '2026-08-09',
    });
    const cutoff = '2025-08-09';
    const window = fixture.raw.filter((b) => b.date >= cutoff);
    expect(window.length).toBeGreaterThan(0);
    const high = Math.max(...window.map((b) => b.high));
    const low = Math.min(...window.map((b) => b.low));
    expect(row.week_52_high).toBe(high);
    expect(row.week_52_low).toBe(low);
    // 窗口必须真的被裁过：全历史极值不等于 52 周极值（fixture 自 2002 年起）
    expect(high).toBeLessThan(Math.max(...fixture.raw.map((b) => b.high)));
  });

  it('52 周窗口为空（超长停牌）→ 退回末 250 根，不给 NaN', () => {
    const row = composeOverview({
      ticker: '600036', name: '招商银行',
      snapshot: SNAPSHOT, capital: null,
      f10, bars: fixture.raw, today: '2200-01-01', // 全部 bar 都在 365 天窗口外
    });
    const tail = fixture.raw.slice(-250);
    expect(row.week_52_high).toBe(Math.max(...tail.map((b) => b.high)));
    expect(row.week_52_low).toBe(Math.min(...tail.map((b) => b.low)));
  });

  it('pytdx-absent fields are NaN; capital absent → market_cap/turnover NaN', () => {
    const row = composeOverview({
      ticker: '600036', name: '招商银行',
      snapshot: SNAPSHOT, capital: null,
      f10, bars: fixture.raw, today: '2026-08-09',
    });
    for (const k of ['volume_ratio', 'momentum', 'change_percent_5min', 'market_cap', 'circulating_market_cap', 'turnover_rate'] as const) {
      expect(Number.isNaN(row[k]), `${k} 应为 NaN`).toBe(true);
    }
  });

  it('capital present → market_cap/turnover computed', () => {
    const row = composeOverview({
      ticker: '600036', name: '招商银行',
      snapshot: SNAPSHOT, capital: { zongguben: 1e10, liutongguben: 2e10 },
      f10, bars: fixture.raw, today: '2026-08-07',
    });
    expect(row.market_cap).toBeCloseTo(38.8 * 1e10, 0);
    expect(row.circulating_market_cap).toBeCloseTo(38.8 * 2e10, 0);
    const vol = fixture.raw[fixture.raw.length - 1].volume ?? NaN;
    expect(row.turnover_rate).toBeCloseTo((vol * 100) / 2e10 * 100, 6);
  });

  it('price fallback to last daily close when snapshot absent', () => {
    const row = composeOverview({
      ticker: '600036', name: '招商银行',
      snapshot: null, capital: null,
      f10, bars: fixture.raw, today: '2026-08-09',
    });
    expect(row.latest_price).toBe(fixture.raw[fixture.raw.length - 1].close);
  });

  it('60d / YTD change windows', () => {
    const row = composeOverview({
      ticker: '600036', name: '招商银行',
      snapshot: SNAPSHOT, capital: null,
      f10, bars: fixture.raw, today: '2026-08-09',
    });
    const close60d = fixture.raw[fixture.raw.length - 61].close;
    expect(row.change_percent_60d).toBeCloseTo(((38.8 - close60d) / close60d) * 100, 6);
    // YTD 基准 = 上年末(2025-12-31)收盘(600036 历史数据跨年)
    const prevYearLast = [...fixture.raw].reverse().find((b) => b.date.startsWith('2025'));
    expect(prevYearLast).toBeTruthy();
    expect(row.change_percent_ytd).toBeCloseTo(((38.8 - prevYearLast!.close) / prevYearLast!.close) * 100, 6);
  });

  it('25 fields（22 列对搬 + eps/52周高低 三键补齐）, string ticker/name', () => {
    const row = composeOverview({
      ticker: '600036', name: '招商银行',
      snapshot: SNAPSHOT, capital: null,
      f10, bars: fixture.raw, today: '2026-08-09',
    });
    expect(Object.keys(row)).toHaveLength(25);
    expect(Object.keys(row)).toEqual(expect.arrayContaining(['eps', 'week_52_high', 'week_52_low']));
    expect(row.ticker).toBe('600036');
    expect(row.name).toBe('招商银行');
  });
});

describe('composeOverview(CR-25:当日 bar 量未知)', () => {
  const lastDate = fixture.raw[fixture.raw.length - 1].date;
  const barsUnknownVolume: DailyBar[] = fixture.raw.map((b, i) => (
    i === fixture.raw.length - 1 ? { ...b, volume: null } : b
  ));

  it('末根 volume null → volume/turnover_rate 均 NaN(不伪造 0.00%)', () => {
    const row = composeOverview({
      ticker: '600036', name: '招商银行',
      snapshot: SNAPSHOT, capital: { zongguben: 1e10, liutongguben: 2e10 },
      f10, bars: barsUnknownVolume, today: lastDate,
    });
    expect(Number.isNaN(row.volume)).toBe(true);
    expect(Number.isNaN(row.turnover_rate)).toBe(true);
    // 价格与涨跌幅不受量未知影响
    expect(row.latest_price).toBe(38.8);
  });
});
