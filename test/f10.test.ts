import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { parseFinanceIndicatorsAllTables, toNum } from '../src/f10.ts';

const tdxText = fs.readFileSync('test/fixtures/f10_tdx.txt', 'utf8');
const hkText = fs.readFileSync('test/fixtures/f10_hk.txt', 'utf8');

describe('f10 parser dual format (AC6)', () => {
  it('parses 港澳资讯 format (U+FF5C, unnumbered section) — matches Python (180 rows)', () => {
    const rows = parseFinanceIndicatorsAllTables(hkText);
    // Python f10_parser 输出 180 行（M0 逐字段 IDENTICAL 验证过）
    expect(rows.length).toBe(180);
    expect(rows[0]).toEqual({
      metric: '审计意见',
      period: '2024-12-31',
      value_raw: '标准无保留意见',
      value_num: NaN,
    });
  });

  it('parses 通达信 format (U+2502, numbered section 【1.主要财务指标】)', () => {
    const rows = parseFinanceIndicatorsAllTables(tdxText);
    expect(rows.length).toBeGreaterThan(100);
    const periods = new Set(rows.map((r) => r.period));
    expect(periods.has('2026-03-31')).toBe(true); // 季度期存在（表2并入）
    const metrics = new Set(rows.map((r) => r.metric));
    expect(metrics.has('归母净利(未调整:万)')).toBe(true);
    // (metric, period) 无重复
    const keys = rows.map((r) => `${r.metric}\u0000${r.period}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('F27:数据行短于期数列 → value_raw 空串而非 undefined(undefined 进 string 字段)', () => {
    const text = [
      '【主要财务指标】',
      '2026-06-30｜2026-03-31',
      '净资产收益率｜15.2｜14.1',
      '营业总收入｜1234', // 缺 2026-03-31 列
      '扣非净利润｜', // 全空
    ].join('\n');
    const rows = parseFinanceIndicatorsAllTables(text);
    const rev = rows.find((r) => r.metric === '净资产收益率');
    expect(rev?.value_raw).toBe('15.2');
    const short = rows.find((r) => r.metric === '营业总收入' && r.period === '2026-03-31');
    expect(short?.value_raw).toBe(''); // 旧实现:undefined 进 string 字段
    expect(Number.isNaN(short?.value_num)).toBe(true);
  });

  it('toNum normalizes 亿/万 and bad values', () => {
    expect(toNum('12.5亿')).toBe(12.5e8);
    expect(toNum('3.2万')).toBe(3.2e4);
    expect(Number.isNaN(toNum('-'))).toBe(true);
    expect(Number.isNaN(toNum('null'))).toBe(true);
    // F26:裸「万」/「亿」(无数值前缀)→ NaN,不得乘出 0
    expect(Number.isNaN(toNum('万'))).toBe(true);
    expect(Number.isNaN(toNum('亿'))).toBe(true);
  });
});
