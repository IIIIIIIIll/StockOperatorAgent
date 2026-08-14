// 换手率链路单测:股本结构解析(parseCapitalStructure)+ 上下文渲染
// (formatStockOutput 60 日行 Turnover Rate / trendIndicatorsText 换手率)。
import { describe, expect, it } from 'vitest';
import { parseCapitalStructure } from '../src/f10.ts';
import { formatStockOutput, trendIndicatorsText } from '../src/pipeline.ts';

/** 构造 F10「股本结构」节文本(通达信 │ 格式,单位万股)。 */
function capitalText(opts: { zongguben?: string; liutongguben?: string; shiji?: string }): string {
  const rows = [
    `│日期/(万股)   │    2026-06-30│    2026-03-31│`,
    `│总股本        │    ${opts.zongguben ?? '1444219.97'}│    1444219.97│`,
    `│流通A股       │    ${opts.liutongguben ?? '1444219.97'}│    1444219.97│`,
    `│实际流通A股   │    ${opts.shiji ?? '1444219.97'}│    1444219.97│`,
  ];
  return `股本结构☆ ◇002027 分众传媒◇ 通达信沪深京F10\n★本栏包括【1.股本结构】【2.股本变化】【3.限售解禁】【4.股票回购】\n【1.股本结构】\n${rows.join('\n')}`;
}

describe('parseCapitalStructure(F10 股本结构节)', () => {
  it('总/流通股本 ×10⁴(万股→股),取最新期', () => {
    const r = parseCapitalStructure(capitalText({}));
    expect(r?.zongguben).toBeCloseTo(1.44421997e10, 0); // 144.42 亿股
    expect(r?.liutongguben).toBeCloseTo(1.44421997e10, 0);
  });

  it('流通A股缺失 → 实际流通A股回退', () => {
    const r = parseCapitalStructure(capitalText({ liutongguben: '---' }));
    expect(r?.liutongguben).toBeCloseTo(1.44421997e10, 0);
  });

  it('最新期缺值 → 回退上一期股本(股本变动不频繁)', () => {
    const r = parseCapitalStructure(capitalText({ zongguben: '---' }));
    expect(r?.zongguben).toBeCloseTo(1.44421997e10, 0);
  });

  it('无股本节/空文本 → null', () => {
    expect(parseCapitalStructure('财务分析☆ 无股本结构')).toBeNull();
    expect(parseCapitalStructure(null)).toBeNull();
    expect(parseCapitalStructure('')).toBeNull();
  });
});

const CAPITAL = { zongguben: 1.44421997e10, liutongguben: 1.44421997e10 };
const BARS = [{ date: '2026-08-10', open: 5.13, close: 5.29, high: 5.3, low: 5.11, volume: 1_623_433 }];
const OVERVIEW = {
  latest_price: 5.29, pe_dynamic: 26, pb: 1, momentum: NaN,
  change_percent_60d: 0, change_percent_ytd: 0,
} as Record<string, number | string>;

describe('换手率渲染(pipeline)', () => {
  it('formatStockOutput:有股本 → 60 日行 Turnover Rate 真值(量×10⁴/股本)', () => {
    const out = formatStockOutput('002027', '分众传媒', OVERVIEW, BARS, [], CAPITAL);
    // 1623433×10000/1.44421997e10 = 1.124%
    expect(out).toContain('Turnover Rate: 1.12%');
  });

  it('formatStockOutput:无股本 → N/A(不崩)', () => {
    const out = formatStockOutput('002027', '分众传媒', OVERVIEW, BARS, [], null);
    expect(out).toContain('Turnover Rate: N/A%');
  });

  it('trendIndicatorsText:传流通股本 → 换手率真值(vendor 语义:量手/万股 = %)', () => {
    const t = trendIndicatorsText(BARS, '002027', CAPITAL.liutongguben);
    // 1623433 / 1444219.97(万股) = 1.1241%
    expect(t).toContain('换手率: 1.124');
  });

  it('trendIndicatorsText:不传股本 → 换手率 N/A', () => {
    const t = trendIndicatorsText(BARS, '002027');
    expect(t).toContain('换手率: N/A');
  });
});
