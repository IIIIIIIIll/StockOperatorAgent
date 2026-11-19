// 东财 kline 客户端单测 —— 只验纯函数(secid 映射 / 解析 / 合并)，网络路径
// 由 tools/probe.mts 与 E2E 覆盖(免 mock 框架，house style)。
import { describe, expect, it } from 'vitest';
import { mergeAmounts, parseEmKlineAmounts, secidCandidates } from '../src/eastmoney/klineClient.ts';

describe('secidCandidates(东财市场号映射)', () => {
  it('港股 → 116 + 5 位补零(0700.HK → 116.00700)', () => {
    expect(secidCandidates('hk', '0700.HK')).toEqual(['116.00700']);
    expect(secidCandidates('hk', '9988.HK')).toEqual(['116.09988']);
  });

  it('美股 → NASDAQ/NYSE/AMEX 三个前缀各试一次', () => {
    expect(secidCandidates('us', 'AAPL')).toEqual(['105.AAPL', '106.AAPL', '107.AAPL']);
    // 存储形带 '-' 的股份类别(AAPL 无，BRK-B 有)→ 原样透传，东财无则降级
    expect(secidCandidates('us', 'brk-b')).toEqual(['105.BRK-B', '106.BRK-B', '107.BRK-B']);
  });

  it('cn → 空(cn 走 TDX，有真成交额，不该走本模块)', () => {
    expect(secidCandidates('cn', '600036')).toEqual([]);
  });

  it('无可用数字/符号 → 空', () => {
    expect(secidCandidates('hk', 'ABC.HK')).toEqual([]);
    expect(secidCandidates('us', '   ')).toEqual([]);
  });
});

describe('parseEmKlineAmounts(响应解析)', () => {
  const line = (date: string, amount: string) => `${date},1,2,3,0.5,100,${amount}`;

  it('f51 日期 + f57 成交额 → Map(保留前 10 位日期)', () => {
    const m = parseEmKlineAmounts({
      data: { klines: [line('2026-11-18', '12076857600'), line('2026-11-19', '17599113472')] },
    });
    expect([...m.entries()]).toEqual([
      ['2026-11-18', 12076857600],
      ['2026-11-19', 17599113472],
    ]);
  });

  it('data:null(东财无该符号) → 空 Map', () => {
    expect(parseEmKlineAmounts({ rc: 102, data: null }).size).toBe(0);
  });

  it('缺列/非数值/非正成交额 → 跳过该行，不抛', () => {
    const m = parseEmKlineAmounts({
      data: {
        klines: [
          '2026-11-19,1,2',
          line('2026-11-18', ''),
          line('2026-11-17', '0'),
          line('2026-11-16', 'abc'),
          line('2026-11-15', '1000'),
        ],
      },
    });
    expect([...m.keys()]).toEqual(['2026-11-15']);
  });

  it('非对象/无 data/klines 非数组 → 空 Map', () => {
    expect(parseEmKlineAmounts(null).size).toBe(0);
    expect(parseEmKlineAmounts('x').size).toBe(0);
    expect(parseEmKlineAmounts({}).size).toBe(0);
    expect(parseEmKlineAmounts({ data: { klines: 'x' } }).size).toBe(0);
  });
});

describe('mergeAmounts(按日合并)', () => {
  const amounts = new Map([
    ['2026-11-18', 100],
    ['2026-11-19', 200],
  ]);

  it('null 成交额按日期填真值，其余不变', () => {
    const bars = [
      { date: '2026-11-18', close: 1, amount: null },
      { date: '2026-11-19', close: 2, amount: null },
    ];
    expect(mergeAmounts(bars, amounts).map((b) => b.amount)).toEqual([100, 200]);
  });

  it('已有成交额不覆盖(CN/TDX 真值优先)', () => {
    const bars = [{ date: '2026-11-18', close: 1, amount: 999 }];
    expect(mergeAmounts(bars, amounts)[0]!.amount).toBe(999);
  });

  it('日期不在表里 → 保持原值(undefined 不被写成 NaN)', () => {
    const bars: Array<{ date: string; close: number; amount?: number | null }> = [
      { date: '2020-01-02', close: 1 },
    ];
    expect(mergeAmounts(bars, amounts)[0]!.amount).toBeUndefined();
  });

  it('空表 → 浅拷贝，不共享引用', () => {
    const bars = [{ date: '2026-11-18', close: 1, amount: null }];
    const out = mergeAmounts(bars, new Map());
    expect(out[0]).not.toBe(bars[0]);
    expect(out[0]!.amount).toBeNull();
  });

  it('不改写入参', () => {
    const bars = [{ date: '2026-11-18', close: 1, amount: null }];
    mergeAmounts(bars, amounts);
    expect(bars[0]!.amount).toBeNull();
  });
});
