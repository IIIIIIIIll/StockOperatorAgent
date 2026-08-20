import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { Store, type DailyBar } from '../src/store.ts';
import {
  buildStockInformation,
  fallbackMarketIntel,
  financialIndicatorsText,
  fmtNumber,
  formatStockOutput,
  macdVhState,
  momentumZone,
  trendIndicatorsText,
  turnoverPct,
  yahooFinancialIndicatorsText,
} from '../src/pipeline.ts';

const fixtureRaw = JSON.parse(fs.readFileSync('test/fixtures/600036_daily.json', 'utf8')).raw as DailyBar[];
const bars = fixtureRaw.map((b) => ({ ...b, date: b.date.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') }));
const f10Text = fs.readFileSync('test/fixtures/f10_tdx.txt', 'utf8');

function makeStore(): Store {
  const store = new Store();
  store.putStock({ ticker: '600036', name: '招商银行', overview: null, overviewLastUpdate: null, lastDataUpdate: null });
  store.addDatas('600036', bars);
  store.addPerformanceReports('600036', [
    { report_date: '20260331', fields: { eps: 1.49, net_profit: 15200000000, net_profit_YoY_rate: 8.5, net_profit_QoQ_rate: -2.1, net_worth_per_share: 44.9, net_worth_return_rate: 3.4, cash_flow_per_share: 5.1, sales_gross_margin: 45.2 } },
    { report_date: '20260630', fields: { eps: 2.9, net_profit: 31000000000, net_profit_YoY_rate: 9.8, net_profit_QoQ_rate: 6.2, net_worth_per_share: 46.1, net_worth_return_rate: 6.3, cash_flow_per_share: -2.3, sales_gross_margin: 44.8 } },
  ]);
  return store;
}

const SNAPSHOT = { price: 38.8, high: 39.1, low: 38.48, open: 38.9 };

describe('fmtNumber (对齐 Python fmt_number)', () => {
  it('NaN/None → N/A; 数值保留小数位', () => {
    expect(fmtNumber(NaN, 2)).toBe('N/A');
    expect(fmtNumber(null, 2)).toBe('N/A');
    expect(fmtNumber(undefined, 2)).toBe('N/A');
    expect(fmtNumber(38.8, 2)).toBe('38.80');
    expect(fmtNumber(0.1234, 3)).toBe('0.123');
  });
});

describe('macdVhState / momentumZone (对齐 extra_indicators)', () => {
  it('四色柱态', () => {
    expect(macdVhState(1, 0.5)).toBe('正扩张');
    expect(macdVhState(1, 2)).toBe('正衰减');
    expect(macdVhState(-1, -0.5)).toBe('负扩张');
    expect(macdVhState(-1, -2)).toBe('负衰减');
    expect(macdVhState(NaN, 1)).toBe('N/A');
    expect(macdVhState(1, null)).toBe('N/A');
  });
  it('5 区动量', () => {
    expect(momentumZone(200)).toBe('超买');
    expect(momentumZone(100)).toBe('强势');
    expect(momentumZone(0)).toBe('震荡');
    expect(momentumZone(-100)).toBe('弱势');
    expect(momentumZone(-200)).toBe('超卖');
    expect(momentumZone(NaN)).toBe('N/A');
  });
});

describe('formatStockOutput (StockOutputFormatter 移植)', () => {
  it('overview 首块字段与格式', () => {
    const store = makeStore();
    const text = formatStockOutput('600036', '招商银行', { latest_price: 38.8, pe_dynamic: 13.2, pb: 0.84, momentum: NaN }, bars, []);
    expect(text.startsWith('\n-----------\nStock: 招商银行 (600036)\n')).toBe(true);
    expect(text).toContain('Latest price: 38.80\n');
    expect(text).toContain('Dynamic PE: 13.20\n');
    expect(text).toContain('Momentum: N/A%\n');
    expect(text).toContain('Last 60 days prices:\n');
    expect(text).toContain('  Date: 2026-08-07, Open:38.90, Close: 38.80');
    expect(text).toContain('Change Percent: ');
  });

  it('业绩 20 行形状(字段名/百分号)', () => {
    const store = makeStore();
    const reports = store.getPerformanceReports('600036').map((r) => ({ report_date: r.report_date, fields: r.fields as Record<string, unknown> }));
    const text = formatStockOutput('600036', '招商银行', { latest_price: 38.8, pe_dynamic: NaN, pb: NaN, momentum: NaN }, bars, reports);
    expect(text).toContain('  Report Date: 20260630, EPS: 2.90, Net Profit: 31000000000.00');
    expect(text).toContain('Net Profit YoY percent 9.80');
    expect(text).toContain('Cash flow per share -2.30');
  });
});

describe('trendIndicatorsText (get_trend_indicators 移植)', () => {
  it('块头/末根值/MACD-VH/乖离率文本', () => {
    const text = trendIndicatorsText(bars, '600036');
    expect(text.startsWith(`【技术指标（${bars[bars.length - 1].date} 收盘）】`)).toBe(true);
    expect(text).toContain('MA5/10/20/60: MA5=');
    expect(text).toContain('MACD: DIF=');
    expect(text).toContain('MACD-VH: MACD_V=');
    expect(text).toMatch(/柱态=(正扩张|正衰减|负扩张|负衰减|N\/A)/);
    expect(text).toMatch(/动量区=(超买|强势|震荡|弱势|超卖|N\/A)/);
    expect(text).toContain('刘晨明乖离率(20日EMA): ');
    expect(text).toContain('%');
  });
});

describe('financialIndicatorsText (get_financial_indicators 移植)', () => {
  it('最新期盈利能力 + 百分号', () => {
    const text = financialIndicatorsText(f10Text, '600036');
    expect(text.startsWith('【盈利能力指标（')).toBe(true);
    expect(text).toContain('%');
    expect(text.split('\n')[0]).toMatch(/20\d\d-\d\d-\d\d/);
  });
  it('无 raw → 占位不 raise', () => {
    expect(financialIndicatorsText(null, '600036')).toBe('（无 600036 的盈利能力指标，跳过）');
  });
});

describe('buildStockInformation (五段唯一组装点)', () => {
  it('块序:个股信息 → 技术指标 → 盈利能力 → 市场情报占位;亿信段缺省不出现', () => {
    const store = makeStore();
    const text = buildStockInformation('600036', {
      store, f10Text, snapshot: SNAPSHOT, today: '2026-08-09',
    });
    const idxInfo = text.indexOf('-----------\nStock: 招商银行');
    const idxTrend = text.indexOf('【技术指标（');
    const idxFin = text.indexOf('【盈利能力指标（');
    const idxMkt = text.indexOf('（未配置 TDX_API_KEY，跳过实时市场情报）');
    expect(idxInfo).toBeGreaterThanOrEqual(0);
    expect(idxTrend).toBeGreaterThan(idxInfo);
    expect(idxFin).toBeGreaterThan(idxTrend);
    expect(idxMkt).toBeGreaterThan(idxFin);
    expect(text.includes('亿信')).toBe(false);
  });

  it('mcp 注入替换占位;billions 注入追加第 5 段', () => {
    const store = makeStore();
    const text = buildStockInformation('600036', {
      store, f10Text, snapshot: SNAPSHOT, today: '2026-08-09',
      mcp: () => '概念板块: 银行;资金流向: 净流入 5 亿',
      billions: () => '（亿信金融数据库查询失败，跳过600036的财务问数）',
    });
    expect(text).toContain('概念板块: 银行');
    expect(text).toContain('（亿信金融数据库查询失败，跳过600036的财务问数）');
    expect(text).not.toContain('未配置 TDX_API_KEY');
  });

  it('空 store → 各段占位不 raise', () => {
    const store = new Store();
    store.putStock({ ticker: '600036', name: '招商银行', overview: null, overviewLastUpdate: null, lastDataUpdate: null });
    const text = buildStockInformation('600036', { store, today: '2026-08-09' });
    expect(text).toContain('（无 600036 的行情数据，跳过技术指标）');
    expect(text).toContain('（无 600036 的盈利能力指标，跳过）');
    expect(text).toContain(fallbackMarketIntel());
  });
});

describe('market 分支（S4:turnoverPct/formatStockOutput/trendIndicatorsText/buildStockInformation）', () => {
  const bar: DailyBar = { date: '2026-08-04', open: 10, close: 10.2, high: 10.6, low: 10.1, volume: 1_000_000 };
  const capital = { zongguben: 1.1e9, liutongguben: 1e9 };

  it('turnoverPct:cn 量×10⁴/股本不变;hk/us 量/股本×100', () => {
    expect(turnoverPct(bar, capital)).toBeCloseTo((1_000_000 * 10_000) / 1e9, 6);
    expect(turnoverPct(bar, capital, 'hk')).toBeCloseTo((1_000_000 / 1e9) * 100, 6);
    expect(turnoverPct(bar, capital, 'us')).toBeCloseTo((1_000_000 / 1e9) * 100, 6);
    expect(Number.isNaN(turnoverPct(bar, null, 'hk'))).toBe(true);
  });

  it('formatStockOutput hk:市场标签/币种行 + 量(股);cn 无市场行且逐字节不变', () => {
    const hk = formatStockOutput('0700.HK', '腾讯控股', { latest_price: 380, pe_dynamic: 20, pb: 4, momentum: 5 }, [bar], [], capital, 'hk');
    expect(hk).toContain('Stock: 腾讯控股 (0700.HK)\n');
    expect(hk).toContain('Market: 港股, Currency: HKD\n');
    expect(hk).toContain('Volume: 1000000.00shares');
    expect(hk).toContain('Turnover Rate: 0.10%');
    expect(hk).not.toContain('lots');
    const us = formatStockOutput('AAPL', 'Apple', { latest_price: 230, pe_dynamic: 30, pb: 40, momentum: 3 }, [bar], [], capital, 'us');
    expect(us).toContain('Market: 美股, Currency: USD\n');
    const cn = formatStockOutput('600036', '招商银行', { latest_price: 38.8, pe_dynamic: 13.2, pb: 0.84, momentum: NaN }, [bar], [], capital);
    expect(cn).toContain('Volume: 1000000.00lots');
    expect(cn).not.toContain('Market: ');
    expect(cn).not.toContain('shares');
  });

  it('trendIndicatorsText hk/us:量(股)×100/股本 = 换手率%;cn 路径不变', () => {
    const hk = trendIndicatorsText([bar], '0700.HK', 1e9, 'hk');
    expect(hk).toContain('换手率: 0.100'); // 1000000×100/1e9
    const us = trendIndicatorsText([bar], 'AAPL', 1e9, 'us');
    expect(us).toContain('换手率: 0.100');
    const cn = trendIndicatorsText([bar], '600036', 1e9);
    expect(cn).toContain('换手率: 10.000'); // 1000000×10⁴/1e9
  });

  it('yahooFinancialIndicatorsText:最新期净利/营收/ROE/EPS + 币种单位', () => {
    const reports = [
      { report_date: '20251231', fields: { net_profit: 8e9, total_income: 5e10, net_worth_return_rate: 12.5, eps: 2.4 } },
      { report_date: '20260630', fields: { net_profit: 9.5e9, total_income: 5.5e10, net_worth_return_rate: 13.2, eps: 2.9 } },
    ];
    const text = yahooFinancialIndicatorsText(reports, '0700.HK', 'hk');
    expect(text.startsWith('【盈利能力指标（20260630）】')).toBe(true);
    expect(text).toContain('净利润: 9500000000.00 HKD');
    expect(text).toContain('营业收入: 55000000000.00 HKD');
    expect(text).toContain('净资产收益率(ROE): 13.20%');
    expect(text).toContain('每股收益(EPS): 2.90 HKD');
  });

  it('yahooFinancialIndicatorsText:无报告占位;us 币种 USD;缺失字段 → N/A', () => {
    expect(yahooFinancialIndicatorsText([], 'AAPL', 'us')).toBe('（无 AAPL 的盈利能力指标，跳过）');
    const text = yahooFinancialIndicatorsText([{ report_date: '20260630', fields: { net_profit: 1e10 } }], 'AAPL', 'us');
    expect(text).toContain('净利润: 10000000000.00 USD');
    expect(text).toContain('营业收入: N/A USD');
    expect(text).toContain('净资产收益率(ROE): N/A%');
    expect(text).toContain('每股收益(EPS): N/A USD');
  });

  it('buildStockInformation hk:块 1 市场行 + 块 3 yahoo 摘要 + 块 4 占位;亿信段不变', () => {
    const store = makeStore();
    store.addDatas('0700.HK', [
      { date: '2026-08-06', open: 370, close: 380, high: 382, low: 368, volume: 1_000_000, amount: 3.8e8 },
      { date: '2026-08-07', open: 380, close: 385, high: 387, low: 378, volume: 1_200_000, amount: 4.6e8 },
    ]);
    store.addPerformanceReports('0700.HK', [
      { report_date: '20260630', fields: { net_profit: 9.5e9, total_income: 5.5e10, net_worth_return_rate: 13.2, eps: 2.9 } },
    ]);
    const text = buildStockInformation('0700.HK', {
      store, today: '2026-08-09', market: 'hk',
      capital: { zongguben: 9e9, liutongguben: 8.9e9 },
      billions: () => '亿信段注入',
    });
    expect(text).toContain('Market: 港股, Currency: HKD\n');
    expect(text).toContain('Volume: 1200000.00shares');
    expect(text).not.toContain('lots');
    expect(text).toContain('【盈利能力指标（20260630）】');
    expect(text).toContain('净利润: 9500000000.00 HKD');
    expect(text).toContain('（港股/美股暂无实时市场情报源，跳过）');
    expect(text).not.toContain(fallbackMarketIntel());
    expect(text.match(/【盈利能力指标（/g)).toHaveLength(1); // 仅 yahoo 块,F10 块不出现
    expect(text).toContain('亿信段注入'); // 块 5 亿信不变
  });

  it('buildStockInformation cn 缺省:块 3 F10 + 块 4 TDX 占位(回归)', () => {
    const store = makeStore();
    const text = buildStockInformation('600036', { store, f10Text, snapshot: SNAPSHOT, today: '2026-08-09' });
    expect(text).toContain('【盈利能力指标（');
    expect(text).toContain(fallbackMarketIntel());
    expect(text).not.toContain('（港股/美股暂无实时市场情报源，跳过）');
    expect(text).not.toContain('Market: 港股');
    expect(text).not.toContain('shares');
  });

  it('deps.reports 注入优先于 store（hk 块 3 数据源）', () => {
    const store = makeStore(); // 无 0700.HK 报告
    const text = buildStockInformation('0700.HK', {
      store, today: '2026-08-09', market: 'hk',
      reports: [{ report_date: '20260331', fields: { net_profit: 7e9, total_income: 4e10, net_worth_return_rate: 11.1, eps: 2.1 } }],
    });
    expect(text).toContain('净利润: 7000000000.00 HKD');
  });

  it('hk 块 1:Yahoo 概览槽(PE/PB)覆盖重算结果,不再 NaN;槽缺失回退重算', () => {
    const store = makeStore();
    store.addDatas('0700.HK', [
      { date: '2026-08-06', open: 370, close: 380, high: 382, low: 368, volume: 1_000_000, amount: 3.8e8 },
    ]);
    store.putStock({
      ticker: '0700.HK',
      name: '腾讯控股',
      overview: { ticker: '0700.HK', name: '腾讯控股', latest_price: 380, pe_dynamic: 14.8, pb: 3.2 },
      overviewLastUpdate: '2026-08-09',
      lastDataUpdate: '2026-08-09',
    });
    const text = buildStockInformation('0700.HK', { store, today: '2026-08-09', market: 'hk' });
    expect(text).toContain('Dynamic PE: 14.80');
    expect(text).toContain('Pb: 3.20');
    // 槽缺失(未采集/演示场景)→ composeOverview 重算兜底(无 F10 → NaN)
    const text2 = buildStockInformation('0700.HK', { store: makeStore(), today: '2026-08-09', market: 'hk' });
    expect(text2).toContain('Dynamic PE: N/A');
    expect(text2).toContain('Pb: N/A');
  });
});
