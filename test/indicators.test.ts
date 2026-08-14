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
});
