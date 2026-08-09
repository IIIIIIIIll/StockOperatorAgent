import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { qfqAdjust, type Bar, type XdxrEventLike } from '../src/adjust.ts';

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
