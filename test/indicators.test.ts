import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { computeAll } from '../src/indicators.ts';

const daily = JSON.parse(fs.readFileSync('test/fixtures/600036_daily.json', 'utf8')) as {
  raw: Array<{ open: number; high: number; low: number; close: number; volume: number }>;
};
const expected = JSON.parse(fs.readFileSync('test/fixtures/600036_indicators.json', 'utf8')) as Array<
  Record<string, number | null>
>;

describe('indicators (AC3)', () => {
  it('matches Python compute_all + extra on last 250 bars of 600036', () => {
    const rows = computeAll(
      daily.raw.map((b) => ({ open: b.open, high: b.high, low: b.low, close: b.close, vol: b.volume })),
    );
    const actual = rows.slice(-250);
    expect(actual.length).toBe(expected.length);
    const keys = Object.keys(expected[0]);
    let checked = 0;
    for (let i = 0; i < expected.length; i++) {
      for (const k of keys) {
        const e = expected[i][k];
        const a = actual[i][k] as number | null;
        if (e === null) {
          expect(a, `row ${i} col ${k} should be null`).toBeNull();
        } else {
          expect(a, `row ${i} col ${k}`).not.toBeNull();
          expect(Math.abs((a as number) - e), `row ${i} col ${k}`).toBeLessThan(
            Math.max(1e-4, Math.abs(e) * 1e-6),
          );
        }
        checked++;
      }
    }
    expect(checked).toBe(expected.length * keys.length);
  });

  it('F15:rsv 中段 NaN(一字板 9 窗高低相等)→ K 按 gap 计衰减(pandas ignore_na=False)', () => {
    // bars 0-3 正常(high10/low8/close9);bars 4-12 一字板(high=low=close=9);
    // bars 13-14 恢复(high10/low8/close9.5)。rsv[8..11]=50(close=9),
    // rsv[12] 一字板窗 → NaN,rsv[13]=75。
    // K(alpha=1/3):K[12]=50(carry);K[13] 旧实现 gap=1 → 2/3·50+1/3·75=58.33,
    // 新实现 gap=2 → (2/3)²·50+1/3·75=47.22。
    const bars: Array<{ open: number; high: number; low: number; close: number; vol: number }> = [];
    for (let t = 0; t < 4; t++) bars.push({ open: 9, high: 10, low: 8, close: 9, vol: 100 });
    for (let t = 4; t < 13; t++) bars.push({ open: 9, high: 9, low: 9, close: 9, vol: 100 });
    for (let t = 13; t < 15; t++) bars.push({ open: 9, high: 10, low: 8, close: 9.5, vol: 100 });
    const rows = computeAll(bars);
    expect(rows[12].K).toBe(50); // NaN 位 carry(无新值,输出不变)
    expect(rows[13].K).toBeCloseTo((2 / 3) ** 2 * 50 + (1 / 3) * 75, 6); // gap=2 衰减
  });
});
