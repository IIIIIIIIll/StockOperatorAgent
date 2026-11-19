// hk/us 对 CN 的补齐项单测(2026-11-19 侦察后的一批修复):
// 1) qfqAdjustByAdjClose —— Yahoo adjclose 前复权(CN 用 xdxr+qfqAdjust)
// 2) periodKindOf —— 报表期次自查(防跨期假环比,含 HK 半年报)
// 3) composeYahooReports —— eps 回退 / grossProfit 空壳哨兵 / 跨期 QoQ=NaN
// 4) usCandidates —— 美股 '.'/'−' 符号互探(BRK.B → BRK-B)
import { describe, expect, it } from 'vitest';
import { qfqAdjustByAdjClose, type AdjCloseBar } from '../src/adjust.ts';
import { composeYahooReports, periodKindOf } from '../src/yahoo/composeYahooReports.ts';

function bar(date: string, close: number, adjClose: number | null, volume: number | null = 100): AdjCloseBar {
  return { date, open: close, high: close, low: close, close, volume, adjClose };
}

describe('qfqAdjustByAdjClose(Yahoo 前复权)', () => {
  it('历史按 adjClose/close 缩放,最新一根保持原始价', () => {
    const out = qfqAdjustByAdjClose([
      bar('2026-01-05', 10, 5),
      bar('2026-01-06', 11, 11),
      bar('2026-01-07', 12, 12),
    ]);
    expect(out.map((b) => b.close)).toEqual([5, 11, 12]);
    expect(out[0]!.open).toBe(5);
    expect(out[0]!.high).toBe(5);
    expect(out[0]!.low).toBe(5);
  });

  it('整体归一到最后一根(adjclose 与 close 基期不一致时仍成立)', () => {
    // 因子 [1, 2, 2] → 除以末因子 2 → [0.5, 1, 1]
    const out = qfqAdjustByAdjClose([bar('a', 10, 10), bar('b', 11, 22), bar('c', 12, 24)]);
    expect(out.map((b) => b.close)).toEqual([5, 11, 12]);
  });

  it('volume/amount 不缩放(Yahoo 成交量已是拆股调整后股数)', () => {
    const out = qfqAdjustByAdjClose([bar('a', 10, 5, 1234)]);
    expect(out[0]!.volume).toBe(1234);
  });

  it('单根因子缺失 → 取最近有效因子(先前向、再无前值则后向)', () => {
    const out = qfqAdjustByAdjClose([
      bar('a', 10, 5), // 0.5
      bar('b', 10, null), // 前向携带 0.5 → 5
      bar('c', 10, 10), // 1.0
    ]);
    expect(out.map((b) => b.close)).toEqual([5, 5, 10]);
  });

  it('adjClose 全缺失 → 原样返回(等价不复权,不抛)', () => {
    const out = qfqAdjustByAdjClose([bar('a', 10, null), bar('b', 11, null)]);
    expect(out.map((b) => b.close)).toEqual([10, 11]);
  });

  it('空数组 → 空数组', () => {
    expect(qfqAdjustByAdjClose([])).toEqual([]);
  });
});

describe('periodKindOf(报表期次自查)', () => {
  it('相邻季度(88~93 天) → quarter', () => {
    expect(periodKindOf('20250331', '20250630')).toBe('quarter');
    expect(periodKindOf('20251231', '20260331')).toBe('quarter');
  });

  it('半年报(~182 天) → half', () => {
    expect(periodKindOf('20241231', '20250630')).toBe('half');
  });

  it('跨两季(年度行顶掉季度行后) → null，绝不当环比', () => {
    expect(periodKindOf('20250630', '20251231')).toBe('half'); // 半年视窗
    expect(periodKindOf('20250331', '20251231')).toBe(null); // 三季间隔
    expect(periodKindOf('20251231', '20251231')).toBe(null); // 同期
  });
});

/** quoteSummary 壳:直接给 result[0] 形态(composer 两种都认)。 */
function summaryWith(statements: unknown[]): unknown {
  return {
    quoteSummary: {
      result: [{ incomeStatementHistoryQuarterly: { incomeStatementStatements: statements } }],
    },
  };
}

function stmt(endDate: string, totalRevenue: number, netIncome: number, grossProfitRaw = 0): unknown {
  return {
    endDate: { fmt: endDate },
    totalRevenue: { raw: totalRevenue },
    netIncome: { raw: netIncome },
    grossProfit: { raw: grossProfitRaw },
  };
}

describe('composeYahooReports 保真度补齐', () => {
  it('eps 回退 netIncome/shares(dilutedEPS/basicEPS 均缺失的 HK/US 实测形)', () => {
    const rows = composeYahooReports(summaryWith([stmt('2026-03-31', 1000, 120)]), 1000);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.fields.eps).toBeCloseTo(0.12, 10);
  });

  it('eps 优先用已披露的 dilutedEPS', () => {
    const s = { ...(stmt('2026-03-31', 1000, 120) as Record<string, unknown>), dilutedEPS: { raw: 9.99 } };
    const rows = composeYahooReports(summaryWith([s]), 1000);
    expect(rows[0]!.fields.eps).toBe(9.99);
  });

  it('grossProfit.raw === 0 视为空壳哨兵 → 毛利率 NaN(不是 0.00%)', () => {
    const rows = composeYahooReports(summaryWith([stmt('2026-03-31', 1000, 120, 0)]), 1000);
    expect(rows[0]!.fields.sales_gross_margin).toBeNaN();
  });

  it('grossProfit 有值 → 毛利率照算', () => {
    const rows = composeYahooReports(summaryWith([stmt('2026-03-31', 1000, 120, 400)]), 1000);
    expect(rows[0]!.fields.sales_gross_margin).toBeCloseTo(40, 10);
  });

  it('相邻季度 → QoQ 有值', () => {
    const rows = composeYahooReports(
      summaryWith([stmt('2026-03-31', 100, 10), stmt('2026-06-30', 110, 11)]),
      1000,
    );
    expect(rows[1]!.fields.total_income_QoQ_rate).toBeCloseTo(10, 10);
    expect(rows[0]!.fields.total_income_QoQ_rate).toBeNaN(); // 首期无基数
  });

  it('期次不连续(跨两季) → QoQ 为 NaN,不输出假环比', () => {
    const rows = composeYahooReports(
      summaryWith([stmt('2025-03-31', 100, 10), stmt('2025-12-31', 200, 20)]),
      1000,
    );
    expect(rows[1]!.fields.total_income_QoQ_rate).toBeNaN();
    expect(rows[1]!.fields.net_profit_QoQ_rate).toBeNaN();
  });

  it('半年报间隔 → 仍给环比(半年口径),不静默丢弃', () => {
    const rows = composeYahooReports(
      summaryWith([stmt('2024-12-31', 100, 10), stmt('2025-06-30', 150, 15)]),
      1000,
    );
    expect(rows[1]!.fields.total_income_QoQ_rate).toBeCloseTo(50, 10);
  });
});
