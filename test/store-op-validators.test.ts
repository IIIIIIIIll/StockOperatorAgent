// Store-op 入参校验真值表(TQ2):src/storeOps.ts 是桌面写操作唯一安全门
// (desktop/child.mjs dispatch 前置),本文件钉其可观察行为 —— 六 op 白名单
// 合法形状全过、原型链形状拒、ticker 路径分隔符拒、逐字段类型错拒。错误文案
// 即 IPC error 消息直达渲染层,一并按字面断言。
import { describe, expect, it } from 'vitest';
import { checkStoreOpArgs } from '../src/storeOps.ts';

const TICKER = '600036';
const STAMP = '2026-08-23';

function bar(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    date: '2026-08-21',
    open: 10,
    close: 11,
    high: 12,
    low: 9,
    volume: 1000,
    ...overrides,
  };
}

/** 缺省字段形态(DailyBar.amount 可整体缺席)。 */
function barWithout(key: string): Record<string, unknown> {
  const b = bar();
  delete b[key];
  return b;
}

function stock(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ticker: TICKER,
    name: '招商银行',
    overview: null,
    overviewLastUpdate: null,
    lastDataUpdate: null,
    ...overrides,
  };
}

const report = { report_date: '20260630', fields: { eps: '1.23' } };

describe('五 op 合法形状全过(null = 放行)', () => {
  it('putStock:minimal 全空可选 + overview 对象与字符串戳全填两形态', () => {
    expect(checkStoreOpArgs('putStock', [stock()])).toBeNull();
    expect(
      checkStoreOpArgs('putStock', [stock({ overview: { pe: 5 }, overviewLastUpdate: STAMP, lastDataUpdate: STAMP })]),
    ).toBeNull();
  });

  it('addDatas / replaceDatas:ticker + 日K 数组(空数组 = 零写入也放行)', () => {
    expect(checkStoreOpArgs('addDatas', [TICKER, [bar()]])).toBeNull();
    expect(checkStoreOpArgs('replaceDatas', [TICKER, []])).toBeNull();
  });

  it('DailyBar.amount 三态合法:数字(含 0)/null/整体缺省', () => {
    expect(checkStoreOpArgs('addDatas', [TICKER, [bar({ amount: 12345 })]])).toBeNull();
    expect(checkStoreOpArgs('addDatas', [TICKER, [bar({ amount: 0 })]])).toBeNull();
    expect(checkStoreOpArgs('addDatas', [TICKER, [bar({ amount: null })]])).toBeNull();
    expect(checkStoreOpArgs('addDatas', [TICKER, [barWithout('amount')]])).toBeNull();
  });

  it('addPerformanceReports / setMeta 合法形状(含空串 value)', () => {
    expect(checkStoreOpArgs('addPerformanceReports', [TICKER, [report]])).toBeNull();
    expect(checkStoreOpArgs('setMeta', ['demo:f10', '{}'])).toBeNull();
    expect(checkStoreOpArgs('setMeta', ['k', ''])).toBeNull(); // 空串是合法存储值(getMeta 返回面)
  });

  it('H1:updateOverview 已从 IPC 白名单移除(零生产调用者)→ 拒', () => {
    expect(checkStoreOpArgs('updateOverview', [TICKER, { pe: 5 }, STAMP])).toBe(
      'unknown store op: updateOverview',
    );
  });
});

describe('白名单门:非转发 op / 原型链键 / args 非数组一律拒', () => {
  it('StoreLike 真实读方法也被拒 —— 方向契约:读操作不经此桥', () => {
    expect(checkStoreOpArgs('getDatas', [TICKER])).toBe('unknown store op: getDatas');
    expect(checkStoreOpArgs('getStock', [TICKER])).toBe('unknown store op: getStock');
  });

  it("Object.prototype 继承键('__proto__'/constructor/toString/hasOwnProperty)不是自有属性 → 拒", () => {
    expect(checkStoreOpArgs('__proto__', [])).toBe('unknown store op: __proto__');
    expect(checkStoreOpArgs('constructor', [])).toBe('unknown store op: constructor');
    expect(checkStoreOpArgs('toString', [])).toBe('unknown store op: toString');
    expect(checkStoreOpArgs('hasOwnProperty', [])).toBe('unknown store op: hasOwnProperty');
  });

  it('门序:白名单先于 args 形状判定', () => {
    expect(checkStoreOpArgs('nope', null)).toBe('unknown store op: nope');
  });

  it('args 非数组拒(null/字符串/array-like 对象)', () => {
    expect(checkStoreOpArgs('setMeta', null)).toBe('store-op setMeta args must be an array');
    expect(checkStoreOpArgs('setMeta', 'k')).toBe('store-op setMeta args must be an array');
    expect(checkStoreOpArgs('setMeta', { length: 2 })).toBe('store-op setMeta args must be an array');
  });
});

describe('ticker 路径分隔符拒(FileStore 以 <ticker>.json 落盘,分隔符可逃出 store 目录)', () => {
  it('正斜杠与反斜杠在每个 ticker 位形均拒,文案点名该位形', () => {
    expect(checkStoreOpArgs('putStock', [stock({ ticker: '../escape' })]))
      .toBe('putStock record.ticker must be a non-empty string without path separators');
    expect(checkStoreOpArgs('addDatas', ['a/b', [bar()]]))
      .toBe('addDatas ticker must be a non-empty string without path separators');
    expect(checkStoreOpArgs('replaceDatas', ['..\\..\\win', [bar()]]))
      .toBe('replaceDatas ticker must be a non-empty string without path separators');
    expect(checkStoreOpArgs('addPerformanceReports', ['700.HK/', [report]]))
      .toBe('addPerformanceReports ticker must be a non-empty string without path separators');
  });
});

describe('逐字段类型错拒', () => {
  const BARS_MSG = 'addDatas bars must be an array of DailyBar objects';
  const REPORTS_MSG = 'addPerformanceReports reports must be an array of PerformanceReport objects';

  it('putStock:arity 与记录本体形状(null/数组/标量均非 StockRecord)', () => {
    expect(checkStoreOpArgs('putStock', [])).toBe('putStock expects 1 argument (StockRecord)');
    expect(checkStoreOpArgs('putStock', [stock(), {}])).toBe('putStock expects 1 argument (StockRecord)');
    expect(checkStoreOpArgs('putStock', [null])).toBe('putStock argument must be a StockRecord object');
    expect(checkStoreOpArgs('putStock', [[stock()]])).toBe('putStock argument must be a StockRecord object'); // 数组不算对象
    expect(checkStoreOpArgs('putStock', [TICKER])).toBe('putStock argument must be a StockRecord object');
  });

  it('putStock:record 字段逐一类型错(基线合法先行)', () => {
    expect(checkStoreOpArgs('putStock', [stock()])).toBeNull();
    const TICKER_MSG = 'putStock record.ticker must be a non-empty string without path separators';
    expect(checkStoreOpArgs('putStock', [stock({ ticker: 600036 })])).toBe(TICKER_MSG);
    expect(checkStoreOpArgs('putStock', [stock({ ticker: '' })])).toBe(TICKER_MSG);
    expect(checkStoreOpArgs('putStock', [stock({ name: null })])).toBe('putStock record.name must be a string');
    expect(checkStoreOpArgs('putStock', [stock({ overview: 42 })])).toBe('putStock record.overview must be an object or null');
    expect(checkStoreOpArgs('putStock', [stock({ overview: [1] })])).toBe('putStock record.overview must be an object or null');
    expect(checkStoreOpArgs('putStock', [stock({ overviewLastUpdate: 20260823 })]))
      .toBe('putStock record.overviewLastUpdate must be a string or null');
    expect(checkStoreOpArgs('putStock', [stock({ lastDataUpdate: false })]))
      .toBe('putStock record.lastDataUpdate must be a string or null');
  });

  it('addDatas/replaceDatas:arity 错误文案携带各自 op 名(共享 helper)', () => {
    expect(checkStoreOpArgs('addDatas', [TICKER])).toBe('addDatas expects 2 arguments (ticker, bars)');
    expect(checkStoreOpArgs('addDatas', [TICKER, [], {}])).toBe('addDatas expects 2 arguments (ticker, bars)');
    expect(checkStoreOpArgs('replaceDatas', [])).toBe('replaceDatas expects 2 arguments (ticker, bars)');
  });

  it('addDatas:bars 容器形状错(非数组/null/元素非 DailyBar 对象)', () => {
    expect(checkStoreOpArgs('addDatas', [TICKER, '2026-08-21'])).toBe(BARS_MSG);
    expect(checkStoreOpArgs('addDatas', [TICKER, null])).toBe(BARS_MSG);
    expect(checkStoreOpArgs('addDatas', [TICKER, [null]])).toBe(BARS_MSG);
    expect(checkStoreOpArgs('addDatas', [TICKER, [{ date: '2026-08-21' }]])).toBe(BARS_MSG); // 缺 OHLCV
  });

  it('DailyBar 必填字段逐个类型错(date/open/close/high/low/volume/amount)', () => {
    expect(checkStoreOpArgs('addDatas', [TICKER, [bar({ date: 20260821 })]])).toBe(BARS_MSG);
    expect(checkStoreOpArgs('addDatas', [TICKER, [bar({ open: '10' })]])).toBe(BARS_MSG);
    expect(checkStoreOpArgs('addDatas', [TICKER, [barWithout('close')]])).toBe(BARS_MSG);
    expect(checkStoreOpArgs('addDatas', [TICKER, [bar({ high: true })]])).toBe(BARS_MSG);
    expect(checkStoreOpArgs('addDatas', [TICKER, [bar({ low: null })]])).toBe(BARS_MSG); // amount 可空,low 不可
    expect(checkStoreOpArgs('addDatas', [TICKER, [bar({ volume: '1000' })]])).toBe(BARS_MSG);
    expect(checkStoreOpArgs('addDatas', [TICKER, [bar({ amount: '1' })]])).toBe(BARS_MSG);
  });

  it('volume=0 合法:falsy 数字不误判(防未来 !v.volume 式回归)', () => {
    expect(checkStoreOpArgs('addDatas', [TICKER, [bar({ volume: 0 })]])).toBeNull();
  });

  it('addPerformanceReports:reports 容器与元素形状(report_date/fields 缺一即拒,fields 数组拒)', () => {
    expect(checkStoreOpArgs('addPerformanceReports', [TICKER])).toBe(
      'addPerformanceReports expects 2 arguments (ticker, reports)',
    );
    expect(checkStoreOpArgs('addPerformanceReports', [TICKER, report])).toBe(REPORTS_MSG); // 单对象未包数组
    expect(checkStoreOpArgs('addPerformanceReports', [TICKER, [null]])).toBe(REPORTS_MSG);
    expect(checkStoreOpArgs('addPerformanceReports', [TICKER, [{ fields: {} }]])).toBe(REPORTS_MSG);
    expect(checkStoreOpArgs('addPerformanceReports', [TICKER, [{ report_date: '20260630' }]])).toBe(REPORTS_MSG);
    expect(checkStoreOpArgs('addPerformanceReports', [TICKER, [{ report_date: '20260630', fields: [] }]])).toBe(REPORTS_MSG);
  });


  it('setMeta:key 空/非串,value 非串(含 null)', () => {
    expect(checkStoreOpArgs('setMeta', ['k'])).toBe('setMeta expects 2 arguments (key, value)');
    expect(checkStoreOpArgs('setMeta', ['', 'v'])).toBe('setMeta key must be a non-empty string');
    expect(checkStoreOpArgs('setMeta', [7, 'v'])).toBe('setMeta key must be a non-empty string');
    expect(checkStoreOpArgs('setMeta', ['k', 7])).toBe('setMeta value must be a string');
    expect(checkStoreOpArgs('setMeta', ['k', null])).toBe('setMeta value must be a string');
  });
});
