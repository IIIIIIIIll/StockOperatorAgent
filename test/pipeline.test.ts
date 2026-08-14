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
