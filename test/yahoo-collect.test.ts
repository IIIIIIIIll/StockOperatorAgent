// Yahoo 采集链单测:collectYahooForDevice(RN 直连)+ collectYahooViaProxy
// (浏览器代理传输)。fake fetch 注入(house style 无 mock 框架——对齐
// yahoo.test.ts 的 handler 路由模式;采集器用全局 fetch,vi.stubGlobal 注入)。
// Android 真机不可达 → 以本单测代替真机冒烟(PRD 验收注记)。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryStore } from '../src/store-memory.ts';
import type { StoreLike } from '../src/store.ts';
import { setYahooStore, applyYahooCollectedToStore } from '../src/yahoo/applyYahooCollectedToStore.ts';
import { collectYahooForDevice, collectYahooPayload } from '../src/yahoo/deviceYahooCollect.ts';
import { YahooClient, YAHOO_REQUEST_TIMEOUT_MS } from '../src/yahoo/yahooClient.ts';
import { collectYahooViaProxy } from '../src/yahoo/webYahooCollect.ts';
import { marketToday } from '../src/gates.ts';
import { collectForWeb, store as runnerStore } from '../app/lib/runner.ts';

interface FetchCall {
  url: string;
  init?: RequestInit;
}

interface Route {
  match: (url: string) => boolean;
  respond: (call: FetchCall) => Response | Promise<Response>;
}

function makeGlobalFetch(routes: Route[]): FetchCall[] {
  const calls: FetchCall[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    calls.push({ url: u, init });
    const route = routes.find((r) => r.match(u));
    if (!route) throw new Error(`unexpected fetch: ${u}`);
    return route.respond(calls[calls.length - 1]);
  }) as unknown as typeof fetch;
  vi.stubGlobal('fetch', fn);
  return calls;
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? '' : JSON.stringify(body), { status, headers });
}

function textResponse(text: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(text, { status, headers });
}

function chartBody(symbol: string): unknown {
  return {
    chart: {
      result: [
        {
          meta: {
            symbol,
            regularMarketPrice: 400,
            regularMarketDayHigh: 405,
            regularMarketDayLow: 395,
            regularMarketDayOpen: 396,
            regularMarketVolume: 12_345_678,
            currency: 'HKD',
            exchangeTimezoneName: 'Asia/Hong_Kong',
            firstTradeDate: 1_087_929_600, // 2004-06-16 → 分页 3 个 10 年窗口
            regularMarketTime: 1_700_086_400, // 与末根同日 → prevClose 取倒数第二根
          },
          timestamp: [1_700_000_000, 1_700_086_400],
          indicators: {
            quote: [
              { open: [396, 400], high: [405, 406], low: [395, 394], close: [400, 401], volume: [12_345_678, 9_000_000] },
            ],
          },
        },
      ],
    },
  };
}

const ERROR_CHART_BODY = { chart: { error: { code: 'Not Found', description: 'No data found' } } };

// HK 实测形状(2026-08-20):quarterly 模块键名为 incomeStatementHistory(仅 4 期),
// 年度模块 incomeStatementHistory 另 4 期(重叠 1231)→ 三源合并供 compose。
const HK_QUOTE_BODY = {
  quoteSummary: {
    result: [
      {
        price: { longName: '腾讯控股有限公司', regularMarketChangePercent: { raw: 0.005 }, regularMarketChange: { raw: 2 } },
        summaryDetail: {},
        defaultKeyStatistics: { sharesOutstanding: { raw: 9_300_000_000 }, floatShares: { raw: 9_000_000_000 } },
        incomeStatementHistoryQuarterly: {
          incomeStatementHistory: [
            { endDate: { fmt: '2026-06-30' }, totalRevenue: { raw: 1.2e11 }, netIncome: { raw: 2.2e10 }, dilutedEPS: { raw: 2.2 }, grossProfit: { raw: 6e10 } },
            { endDate: { fmt: '2025-12-31' }, totalRevenue: { raw: 1.1e11 }, netIncome: { raw: 2e10 }, dilutedEPS: { raw: 2.1 }, grossProfit: { raw: 5.5e10 } },
          ],
        },
        incomeStatementHistory: {
          incomeStatementHistory: [
            { endDate: { fmt: '2024-12-31' }, totalRevenue: { raw: 1e11 }, netIncome: { raw: 1.9e10 }, dilutedEPS: { raw: 2 }, grossProfit: { raw: 5e10 } },
            { endDate: { fmt: '2025-12-31' }, totalRevenue: { raw: 1.1e11 }, netIncome: { raw: 2e10 }, dilutedEPS: { raw: 2.1 }, grossProfit: { raw: 5.5e10 } }, // 与 quarterly 重叠期
          ],
        },
        balanceSheetHistoryQuarterly: {
          balanceSheetStatements: [
            { endDate: { fmt: '2026-06-30' }, totalStockholderEquity: { raw: 6.2e11 } },
            { endDate: { fmt: '2025-12-31' }, totalStockholderEquity: { raw: 6e11 } },
          ],
        },
        cashflowStatementHistoryQuarterly: {
          cashflowStatements: [
            { endDate: { fmt: '2026-06-30' }, operatingCashFlow: { raw: 3.2e10 } },
            { endDate: { fmt: '2025-12-31' }, operatingCashFlow: { raw: 3e10 } },
          ],
        },
      },
    ],
  },
};

const QUOTE_BODY = {
  quoteSummary: {
    result: [
      {
        price: {
          longName: '腾讯控股有限公司',
          regularMarketChangePercent: { raw: 0.005 },
          regularMarketChange: { raw: 2 },
        },
        summaryDetail: { trailingPE: { raw: 20 } },
        defaultKeyStatistics: {
          sharesOutstanding: { raw: 9_300_000_000 },
          floatShares: { raw: 9_000_000_000 },
          marketCap: { raw: 3_720_000_000_000 },
        },
        incomeStatementHistoryQuarterly: {
          incomeStatementStatements: [
            { endDate: { raw: 1_706_000_000, fmt: '2024-03-31' }, totalRevenue: { raw: 1e11 }, netIncome: { raw: 2e10 }, dilutedEPS: { raw: 2.1 }, grossProfit: { raw: 5e10 } },
            { endDate: { raw: 1_686_000_000, fmt: '2023-12-31' }, totalRevenue: { raw: 9e10 }, netIncome: { raw: 1.8e10 }, dilutedEPS: { raw: 1.9 }, grossProfit: { raw: 4.5e10 } },
          ],
        },
        balanceSheetHistoryQuarterly: {
          balanceSheetStatements: [
            { endDate: { fmt: '2024-03-31' }, totalStockholderEquity: { raw: 6e11 } },
            { endDate: { fmt: '2023-12-31' }, totalStockholderEquity: { raw: 5.8e11 } },
          ],
        },
        cashflowStatementHistoryQuarterly: {
          cashflowStatements: [
            { endDate: { fmt: '2024-03-31' }, operatingCashFlow: { raw: 3e10 } },
            { endDate: { fmt: '2023-12-31' }, operatingCashFlow: { raw: 2.8e10 } },
          ],
        },
      },
    ],
  },
};

describe('collectYahooForDevice(RN 直连,fake fetch)', () => {
  let store: StoreLike;

  beforeEach(() => {
    store = new InMemoryStore();
    setYahooStore(store);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('0700.HK 全链:候选 chart → 市场时区 bars/快照/quoteSummary 合成 → 入库(名称/概览/报告/日期戳)', async () => {
    const calls = makeGlobalFetch([
      { match: (u) => u.startsWith('https://fc.yahoo.com'), respond: () => jsonResponse({}, 200, { 'set-cookie': 'A3=device-a3; Path=/' }) },
      {
        match: (u) => u.includes('/v8/finance/chart/'),
        respond: (c) => jsonResponse(chartBody(c.url.split('/chart/')[1].split('?')[0])),
      },
      { match: (u) => u.includes('/v1/test/getcrumb'), respond: () => textResponse('crumb-abc') },
      { match: (u) => u.includes('/v10/finance/quoteSummary/'), respond: () => jsonResponse(QUOTE_BODY) },
    ]);
    const out = await collectYahooForDevice('0700.HK');
    expect(out.f10Text).toBeNull();
    expect(out.name).toBe('腾讯控股有限公司');
    expect(out.snapshot?.price).toBe(400);
    // meta 无 previousClose → 由 bars 推算(末根为当日 → 倒数第二根收盘 400)
    expect((out.snapshot as { prevClose?: number } | null)?.prevClose).toBe(400);
    expect(out.capital?.zongguben).toBe(9_300_000_000);
    const stock = store.getStock('0700.HK');
    expect(stock?.name).toBe('腾讯控股有限公司');
    expect(stock?.overview?.currency).toBe('HKD');
    expect(stock?.overviewLastUpdate).toBe(marketToday('hk'));
    expect(stock?.lastDataUpdate).toBe(marketToday('hk')); // 覆盖 replaceDatas 的末根日期
    const bars = store.getDatas('0700.HK');
    expect(bars).toHaveLength(2);
    expect(bars[0].date).toBe('2023-11-15'); // unix 秒 → 市场时区(Asia/Hong_Kong)
    expect(bars[0].volume).toBe(12_345_678); // volume 原样股数
    expect(store.getPerformanceReports('0700.HK')).toHaveLength(2);
    // 存储形 '.HK' → 原符号优先试探 1 次(range=5d);全量日K period 分页 3 窗口
    expect(calls.filter((c) => c.url.includes('/v8/finance/chart/'))).toHaveLength(4);
  });

  it('quoteSummary crumb 失败 → warn 降级:概览仅 chart meta 字段、reports 空,不抛错', async () => {
    const calls = makeGlobalFetch([
      { match: (u) => u.startsWith('https://fc.yahoo.com'), respond: () => jsonResponse({}, 200, { 'set-cookie': 'A3=device-a3; Path=/' }) },
      { match: (u) => u.includes('/v8/finance/chart/'), respond: () => jsonResponse(chartBody('0700.HK')) },
      { match: (u) => u.includes('/v1/test/getcrumb'), respond: () => textResponse('crumb-abc') },
      // 401 恒失败:client 清 crumb 刷新重试一次后抛 YahooApiError → 调用方降级
      { match: (u) => u.includes('/v10/finance/quoteSummary/'), respond: () => jsonResponse({ error: { code: 'Unauthorized' } }, 401) },
    ]);
    const out = await collectYahooForDevice('0700.HK'); // 不抛(分析继续)
    const stock = store.getStock('0700.HK');
    expect(stock?.overview?.currency).toBe('HKD'); // chart meta 可映射字段仍在
    expect(Number.isNaN(stock?.overview?.pe_dynamic)).toBe(true); // summary 缺失 → NaN(InMemory 不序列化)
    expect(store.getPerformanceReports('0700.HK')).toHaveLength(0);
    expect(store.getDatas('0700.HK')).toHaveLength(2); // 日K 不受影响
    expect(out.name).toBeNull();
    expect(calls.filter((c) => c.url.includes('/v10/finance/quoteSummary/'))).toHaveLength(2); // 401 → 刷新重试
  });

  it('HK 候选全败(无效符号 chart error 壳)→ 抛 无法解析港股代码', async () => {
    const calls = makeGlobalFetch([
      { match: (u) => u.includes('/v8/finance/chart/'), respond: () => jsonResponse(ERROR_CHART_BODY) },
    ]);
    await expect(collectYahooForDevice('00700')).rejects.toThrow('无法解析港股代码');
    // '00700' → 候选 ['0700.HK', '00700.HK', '700.HK(零剥离)'] 逐个试探
    expect(calls.filter((c) => c.url.includes('/v8/finance/chart/'))).toHaveLength(3);
  });

  it('HK 形状收入表(quarterly 键名 incomeStatementHistory + 年度模块)→ 合并入 payload;store PK 去重后唯一', async () => {
    const store = new InMemoryStore();
    setYahooStore(store);
    makeGlobalFetch([
      {
        match: (u) => u.includes('/v8/finance/chart/'),
        respond: (c) => jsonResponse(chartBody(c.url.split('/chart/')[1].split('?')[0])),
      },
      { match: (u) => u.includes('/v1/test/getcrumb'), respond: () => textResponse('crumb-abc') },
      { match: (u) => u.includes('/v10/finance/quoteSummary/'), respond: () => jsonResponse(HK_QUOTE_BODY) },
    ]);
    const client = new YahooClient(undefined, () => 'fake-a3'); // cookieProvider 注入,免 fc 请求
    const payload = await collectYahooPayload(client, '0700.HK');
    // 2 quarterly + 2 annual(含 1 重叠期)→ 8 行契约同源合并(不去重,store PK 幂等)
    expect(payload.reports).toHaveLength(4);
    expect(payload.reports.map((r) => r.report_date)).toEqual(['20241231', '20251231', '20251231', '20260630']);
    const out = applyYahooCollectedToStore(store, payload, 'hk');
    expect(out.capital?.zongguben).toBe(9_300_000_000);
    const stored = store.getPerformanceReports('0700.HK');
    expect(stored).toHaveLength(3); // 20251231 重叠期按 PK 去重
    expect(stored.map((r) => r.report_date)).toEqual(['20241231', '20251231', '20260630']);
  });

  it('HK 5 位输入:09988 → 首候选 9988.HK(官方 4 位码)命中;5 位原样形不再试探', async () => {
    const store = new InMemoryStore();
    setYahooStore(store);
    const calls = makeGlobalFetch([
      {
        match: (u) => u.includes('/v8/finance/chart/'),
        respond: (c) => {
          const sym = c.url.split('/chart/')[1].split('?')[0];
          if (sym === '9988.HK') return jsonResponse(chartBody(sym));
          return jsonResponse({ chart: { error: { code: 'Not Found' } } }, 404);
        },
      },
      { match: (u) => u.includes('/v1/test/getcrumb'), respond: () => textResponse('crumb-abc') },
      { match: (u) => u.includes('/v10/finance/quoteSummary/'), respond: () => jsonResponse(QUOTE_BODY) },
    ]);
    const client = new YahooClient(undefined, () => 'fake-a3');
    const payload = await collectYahooPayload(client, '09988');
    expect(payload.ticker).toBe('9988.HK'); // 4 位官方码 = store 键(normalizeTicker 首候选一致)
    // 试探 1 次(9988.HK 首候选即命中)+ 全量日K 分页 3 窗口
    expect(calls.filter((c) => c.url.includes('/v8/finance/chart/'))).toHaveLength(4);
    expect(calls[0].url).toContain('/chart/9988.HK?');
    expect(applyYahooCollectedToStore(store, payload, 'hk').name).toBe('腾讯控股有限公司');
  });

  it('skipDaily(同日已采集)→ bars 置空且保留既有日K/概览仍入库', async () => {
    const before = new InMemoryStore();
    setYahooStore(before);
    // 预置既有日K + 同日戳(触发 resolveSkipGates skipDaily;addDatas 会重写
    // lastDataUpdate 为末根日期,故先 addDatas 再 putStock 覆盖为今天)
    before.addDatas('0700.HK', [{ date: '2024-01-02', open: 1, close: 2, high: 3, low: 1, volume: 100 }]);
    before.putStock({
      ticker: '0700.HK',
      name: '腾讯',
      overview: null,
      overviewLastUpdate: null,
      lastDataUpdate: marketToday('hk'),
    });
    const calls = makeGlobalFetch([
      { match: (u) => u.startsWith('https://fc.yahoo.com'), respond: () => jsonResponse({}, 200, { 'set-cookie': 'A3=device-a3; Path=/' }) },
      { match: (u) => u.includes('/v8/finance/chart/'), respond: () => jsonResponse(chartBody('0700.HK')) },
      { match: (u) => u.includes('/v1/test/getcrumb'), respond: () => textResponse('crumb-abc') },
      { match: (u) => u.includes('/v10/finance/quoteSummary/'), respond: () => jsonResponse(QUOTE_BODY) },
    ]);
    await collectYahooForDevice('0700.HK');
    // chart 仍拉(快照/meta/概览部分 fresh),bars 置空 → 既有日K 不清空
    expect(calls.filter((c) => c.url.includes('/v8/finance/chart/'))).toHaveLength(1);
    expect(before.getDatas('0700.HK')).toHaveLength(1);
    expect(before.getDatas('0700.HK')[0].date).toBe('2024-01-02');
    expect(before.getStock('0700.HK')?.overview?.currency).toBe('HKD');
    expect(before.getStock('0700.HK')?.lastDataUpdate).toBe(marketToday('hk'));
  });
});

describe('collectYahooViaProxy(浏览器 → /yahoo-collect)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POST body {ticker} + skipDaily 查询参数 → payload 入库 → WebCollectResult', async () => {
    const store = new InMemoryStore();
    setYahooStore(store);
    const payload = {
      ticker: 'AAPL',
      name: 'Apple Inc.',
      bars: [{ date: '2024-01-02', open: 190, close: 191, high: 192, low: 189, volume: 50_000_000 }],
      snapshot: { price: 191, high: 192, low: 189, open: 190, volume: 50_000_000, amount: NaN, prevClose: 190 },
      overview: { ticker: 'AAPL', name: 'Apple Inc.', currency: 'USD' },
      reports: [{ report_date: '20240331', fields: { eps: 1.5 } }],
      capital: { zongguben: 1.5e10, liutongguben: 1.4e10 },
      skipDaily: true,
    };
    const calls: FetchCall[] = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse(payload);
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fakeFetch);
    const out = await collectYahooViaProxy('AAPL', 'http://localhost:8090', { skipDaily: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://localhost:8090/yahoo-collect?skipDaily=1');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ ticker: 'AAPL' });
    expect(out.name).toBe('Apple Inc.');
    expect(out.f10Text).toBeNull();
    expect(out.capital?.zongguben).toBe(1.5e10);
    const stock = store.getStock('AAPL');
    expect(stock?.name).toBe('Apple Inc.');
    expect(stock?.overview?.currency).toBe('USD');
    expect(stock?.overviewLastUpdate).toBe(marketToday('us'));
    expect(stock?.lastDataUpdate).toBe(marketToday('us'));
    expect(store.getDatas('AAPL')).toHaveLength(1);
    expect(store.getPerformanceReports('AAPL')).toHaveLength(1);
  });

  it('缺省不带查询参数 = 全量', async () => {
    const store = new InMemoryStore();
    setYahooStore(store);
    const calls: FetchCall[] = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse({
        ticker: 'AAPL', name: null, bars: [], snapshot: null, overview: { ticker: 'AAPL', currency: 'USD' },
        reports: [], capital: { zongguben: NaN, liutongguben: NaN },
      });
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fakeFetch);
    await collectYahooViaProxy('AAPL', 'http://localhost:8090');
    expect(calls[0].url).toBe('http://localhost:8090/yahoo-collect');
  });

  it('HTTP 非 2xx → 解析 {error} 抛 Error(对齐 collectViaProxy 语义)', async () => {
    vi.stubGlobal(
      'fetch',
      (async () => jsonResponse({ error: '非法代码' }, 400)) as unknown as typeof fetch,
    );
    await expect(collectYahooViaProxy('AAPL', 'http://localhost:8090')).rejects.toThrow(
      'Yahoo 采集失败(400):非法代码',
    );
  });

  it('CN ticker 进 Yahoo 链 → 抛(接线兜底,不发请求)', async () => {
    const fn = vi.fn();
    vi.stubGlobal('fetch', fn);
    await expect(collectYahooViaProxy('600036', 'http://localhost:8090')).rejects.toThrow(
      '非港美股代码:600036',
    );
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('collectForWeb 市场分派(runner 接线:us → /yahoo-collect + 同日跳过门 + finnhub 合并)', () => {
  beforeEach(() => {
    runnerStore.close();
    setYahooStore(runnerStore); // 与 runner 模块级 store 同实例(生产接线一致)
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    runnerStore.close();
  });

  it('us 同日已采集 → skipDaily=1 查询参数(不重拉日K);finnhub key → 浏览器端合并 industry 入库', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-20T02:00:00Z')); // 纽约今天 2026-08-19
    runnerStore.putStock({
      ticker: 'AAPL',
      name: 'Apple',
      overview: null,
      overviewLastUpdate: null,
      lastDataUpdate: marketToday('us'),
    });
    const payload = {
      ticker: 'AAPL',
      name: 'Apple Inc.',
      bars: [],
      snapshot: null,
      overview: { ticker: 'AAPL', name: 'Apple Inc.', currency: 'USD', pe_dynamic: 30 },
      reports: [],
      capital: { zongguben: 1.5e10, liutongguben: 1.4e10 },
      skipDaily: true,
    };
    const calls: FetchCall[] = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.includes('/yahoo-collect')) return jsonResponse(payload);
      if (url.startsWith('https://finnhub.io/')) return jsonResponse({ finnhubIndustry: 'Technology' });
      throw new Error(`unexpected url: ${url}`);
    }) as unknown as typeof fetch;
    vi.stubGlobal('location', { origin: 'http://test' });
    vi.stubGlobal('fetch', fakeFetch);
    const out = await collectForWeb('AAPL', { market: 'us', finnhub: { apiKey: 'k' } });
    expect(calls[0].url).toBe('http://test/yahoo-collect?skipDaily=1');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ ticker: 'AAPL' });
    const finnhubCall = calls.find((c) => c.url.startsWith('https://finnhub.io/'));
    expect(finnhubCall?.url).toBe('https://finnhub.io/api/v1/stock/profile2?symbol=AAPL&token=k');
    expect(out.name).toBe('Apple Inc.');
    // 同日跳过:既有日K 保留、lastDataUpdate 维持今天;概览/名称仍入库
    expect(runnerStore.getDatas('AAPL')).toHaveLength(0);
    expect(runnerStore.getStock('AAPL')?.lastDataUpdate).toBe(marketToday('us'));
    expect(runnerStore.getStock('AAPL')?.overview?.industry).toBe('Technology'); // finnhub 合并
    expect(runnerStore.getStock('AAPL')?.overviewLastUpdate).toBe(marketToday('us'));
  });

  it('跨日 us:全量路径(无跳过参数);无 finnhub key → 零 finnhub 请求', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-20T02:00:00Z'));
    runnerStore.putStock({
      ticker: 'AAPL',
      name: 'Apple',
      overview: null,
      overviewLastUpdate: null,
      lastDataUpdate: '2026-08-18', // 跨日 → skipDaily false
    });
    const payload = {
      ticker: 'AAPL',
      name: 'Apple Inc.',
      bars: [{ date: '2024-01-02', open: 190, close: 191, high: 192, low: 189, volume: 50_000_000 }],
      snapshot: null,
      overview: { ticker: 'AAPL', name: 'Apple Inc.', currency: 'USD' },
      reports: [],
      capital: { zongguben: 1.5e10, liutongguben: 1.4e10 },
    };
    const calls: FetchCall[] = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.includes('/yahoo-collect')) return jsonResponse(payload);
      throw new Error(`unexpected url: ${url}`);
    }) as unknown as typeof fetch;
    vi.stubGlobal('location', { origin: 'http://test' });
    vi.stubGlobal('fetch', fakeFetch);
    await collectForWeb('AAPL', { market: 'us' });
    expect(calls[0].url).toBe('http://test/yahoo-collect'); // 全量,无跳过参数
    expect(calls).toHaveLength(1); // 无 finnhub 请求
    expect(runnerStore.getDatas('AAPL')).toHaveLength(1);
  });
});

describe('Yahoo 链超时(B1:AbortController 40s < 代理 504 定时器 45s;Hermes 兼容手写 setTimeout+abort)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** 永不 settle 的 fetch:signal 被 abort(超时)时拒绝 —— 模拟挂死的网络。
   *  记录器暴露最后一次 init.signal(断言被 abort 而非等回调超时)。 */
  function hangingFetch(): { fn: typeof fetch; signal: { current: AbortSignal | undefined } } {
    const recorder = { current: undefined as AbortSignal | undefined };
    const fn = (async (_url: string | URL | Request, init?: RequestInit) => {
      recorder.current = init?.signal ?? undefined;
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }) as unknown as typeof fetch;
    return { fn, signal: recorder };
  }

  it('client.chart 挂起 → 超时 abort → YahooApiError(code=timeout),链不再悬挂', async () => {
    vi.useFakeTimers();
    const { fn, signal } = hangingFetch();
    const client = new YahooClient(fn, () => 'fake-a3');
    const p = collectYahooPayload(client, 'AAPL');
    const assertion = expect(p).rejects.toMatchObject({
      name: 'YahooApiError',
      code: 'timeout',
      status_code: null,
    });
    await vi.advanceTimersByTimeAsync(YAHOO_REQUEST_TIMEOUT_MS);
    await assertion;
    expect(signal.current?.aborted).toBe(true); // 请求被 abort,不是等回调超时
  });

  it('全量日K分页挂起(fetchChartWindow 裸 fetch)→ 相同 timeout 语义', async () => {
    vi.useFakeTimers();
    const recorder = { current: undefined as AbortSignal | undefined };
    const fn = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      recorder.current = init?.signal ?? undefined;
      // 候选试探(range=5d)命中;分页(period1/period2)永不 settle
      if (u.includes('range=5d')) return jsonResponse(chartBody('AAPL'));
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fn); // fetchChartWindow 走全局 fetch(device 路径)
    const client = new YahooClient(fn, () => 'fake-a3');
    const p = collectYahooPayload(client, 'AAPL');
    const assertion = expect(p).rejects.toMatchObject({ name: 'YahooApiError', code: 'timeout' });
    await vi.advanceTimersByTimeAsync(YAHOO_REQUEST_TIMEOUT_MS);
    await assertion;
    expect(recorder.current?.aborted).toBe(true);
  });
});
