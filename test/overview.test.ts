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
    const vol = fixture.raw[fixture.raw.length - 1].volume;
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

  it('22 fields, string ticker/name', () => {
    const row = composeOverview({
      ticker: '600036', name: '招商银行',
      snapshot: SNAPSHOT, capital: null,
      f10, bars: fixture.raw, today: '2026-08-09',
    });
    expect(Object.keys(row)).toHaveLength(22);
    expect(row.ticker).toBe('600036');
    expect(row.name).toBe('招商银行');
  });
});
