// 日期展示归一化单测:TDX 采集 YYYYMMDD ↔ 展示/图表 YYYY-MM-DD,两种格式幂等。
import { describe, expect, it } from 'vitest';
import { fmtDate } from '../src/format.ts';

describe('fmtDate', () => {
  it('TDX 采集格式 YYYYMMDD → YYYY-MM-DD(修复 K 线图空数据根因)', () => {
    expect(fmtDate('20040804')).toBe('2004-08-04');
    expect(fmtDate('20260810')).toBe('2026-08-10');
  });

  it('已带横线格式幂等(demo 数据)', () => {
    expect(fmtDate('2026-08-07')).toBe('2026-08-07');
  });

  it('其他字符串原样返回(不误伤)', () => {
    expect(fmtDate('')).toBe('');
    expect(fmtDate('202608')).toBe('202608');
    expect(fmtDate('abc')).toBe('abc');
  });
});
