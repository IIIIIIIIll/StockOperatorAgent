// YahooClient + composeYahooOverview + composeYahooReports 单测
// （fake fetch 注入，house style 无 mock 框架——对齐 billions-client.test.ts /
// web-search.test.ts 的 handler 路由模式）。
import { describe, expect, it, vi } from 'vitest';
import { YahooClient, YahooApiError, YAHOO_HOSTS } from '../src/yahoo/yahooClient.ts';
import { composeYahooOverview } from '../src/yahoo/composeYahooOverview.ts';
import { composeYahooReports } from '../src/yahoo/composeYahooReports.ts';

interface FetchCall {
  url: string;
  init?: RequestInit;
}

interface Route {
  match: (url: string) => boolean;
  respond: () => Response | Promise<Response>;
}

function makeFetch(routes: Route[]): { fetchImpl: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const route = routes.find((r) => r.match(url));
    if (!route) throw new Error(`unexpected fetch: ${url}`);
    return route.respond();
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? '' : JSON.stringify(body), { status, headers });
}

function textResponse(text: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(text, { status, headers });
}

function header(init: RequestInit | undefined, name: string): string | undefined {
  const h = init?.headers as Record<string, string> | undefined;
  return h?.[name];
}

const FC_ROUTE: Route = {
  match: (url) => url.startsWith('https://fc.yahoo.com'),
  respond: () => textResponse('', 200, { 'set-cookie': 'A3=fc-a3; Path=/; Domain=.yahoo.com' }),
};

function crumbRoute(crumb: string): Route {
  return {
    match: (url) => url.includes('/v1/test/getcrumb'),
    respond: () => textResponse(crumb),
  };
}

const CHART_BODY = {
  chart: {
    result: [
      {
        meta: { symbol: '0700.HK', currency: 'HKD', regularMarketPrice: 370.4 },
        timestamp: [1_700_000_000],
        indicators: { quote: [{ open: [370], high: [372], low: [368], close: [371], volume: [10_000_000] }] },
      },
    ],
  },
};

const QUOTE_BODY = {
  quoteSummary: { result: [{ price: { regularMarketPrice: { raw: 370.4, fmt: '370.40' } } }] },
};

describe('YahooClient.chart', () => {
  it('默认参数 URL（range=max&interval=1d&events=div%2Csplit）与 UA 头，解析 JSON 透传', async () => {
    const { fetchImpl, calls } = makeFetch([
      { match: (url) => url.includes('/v8/finance/chart/'), respond: () => jsonResponse(CHART_BODY) },
    ]);
    const out = await new YahooClient(fetchImpl).chart('0700.HK');
    expect(out).toEqual(CHART_BODY);
    expect(calls[0].url).toBe(
      'https://query1.finance.yahoo.com/v8/finance/chart/0700.HK?range=max&interval=1d&events=div%2Csplit',
    );
    expect(header(calls[0].init, 'User-Agent')).toBe('Mozilla/5.0');
  });

  it('opts 覆盖默认参数（range/interval/events）', async () => {
    const { fetchImpl, calls } = makeFetch([
      { match: () => true, respond: () => jsonResponse(CHART_BODY) },
    ]);
    await new YahooClient(fetchImpl).chart('AAPL', { range: '1y', interval: '1wk', events: 'div' });
    expect(calls[0].url).toBe(
      'https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=1y&interval=1wk&events=div',
    );
  });

  it('无效符号 200 + error JSON 不抛（调用方以 result 判定）', async () => {
    const { fetchImpl } = makeFetch([
      {
        match: () => true,
        respond: () => jsonResponse({ chart: { error: { code: 'Not Found', description: 'No data found' } } }),
      },
    ]);
    const out = await new YahooClient(fetchImpl).chart('ZZZZZZ');
    const body = out as { chart: { error: { code: string } } };
    expect(body.chart.error.code).toBe('Not Found');
  });

  it('网络异常 → YahooApiError(code=null, status_code=null)', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('net down');
    }) as unknown as typeof fetch;
    await expect(new YahooClient(fetchImpl).chart('AAPL')).rejects.toMatchObject({
      name: 'YahooApiError',
      code: null,
      status_code: null,
    });
  });

  it('非 2xx → YahooApiError（code 取 body error.code，status_code 透传）', async () => {
    const { fetchImpl } = makeFetch([
      {
        match: () => true,
        respond: () => jsonResponse({ chart: { error: { code: 'Too Many Requests' } } }, 503),
      },
    ]);
    await expect(new YahooClient(fetchImpl).chart('AAPL')).rejects.toMatchObject({
      name: 'YahooApiError',
      code: 'Too Many Requests',
      status_code: 503,
    });
  });
});

describe('YahooClient.quoteSummary / crumb 流程', () => {
  it('首取 crumb 成功：fc.yahoo.com Set-Cookie 解析 A3 → getcrumb → 模块/Cookie/UA 透传', async () => {
    let fcCalls = 0;
    const { fetchImpl, calls } = makeFetch([
      { ...FC_ROUTE, respond: () => { fcCalls += 1; return textResponse('', 200, { 'set-cookie': 'A3=fc-a3; Path=/' }); } },
      crumbRoute('crumb-abc'),
      { match: (url) => url.includes('/v10/finance/quoteSummary/'), respond: () => jsonResponse(QUOTE_BODY) },
    ]);
    const client = new YahooClient(fetchImpl);
    const out = await client.quoteSummary('AAPL', ['price', 'summaryDetail']);
    expect(out).toEqual(QUOTE_BODY);
    expect(calls[0].url).toBe('https://fc.yahoo.com');
    const crumbCall = calls.find((c) => c.url.includes('/v1/test/getcrumb'))!;
    expect(crumbCall.url).toBe('https://query2.finance.yahoo.com/v1/test/getcrumb');
    expect(header(crumbCall.init, 'Cookie')).toBe('A3=fc-a3');
    const qsCall = calls.find((c) => c.url.includes('/v10/finance/quoteSummary/'))!;
    expect(qsCall.url).toBe(
      'https://query2.finance.yahoo.com/v10/finance/quoteSummary/AAPL?modules=price,summaryDetail&crumb=crumb-abc',
    );
    expect(header(qsCall.init, 'Cookie')).toBe('A3=fc-a3');
    expect(header(qsCall.init, 'User-Agent')).toBe('Mozilla/5.0');
    // crumb 实例缓存：第二次 quoteSummary 不再走 fc/getcrumb
    await client.quoteSummary('AAPL', ['price']);
    expect(fcCalls).toBe(1);
    expect(calls.filter((c) => c.url.includes('/v1/test/getcrumb'))).toHaveLength(1);
  });

  it('fc.yahoo.com 404 + Set-Cookie A3 → 状态码无关解析:A3 作 crumb 链入口,不抛 crumb/404', async () => {
    const { fetchImpl, calls } = makeFetch([
      { match: (url) => url.startsWith('https://fc.yahoo.com'), respond: () => textResponse('', 404, { 'set-cookie': 'A3=fc-a3; Path=/' }) },
      crumbRoute('crumb-404a3'),
      { match: (url) => url.includes('/v10/finance/quoteSummary/'), respond: () => jsonResponse(QUOTE_BODY) },
    ]);
    const client = new YahooClient(fetchImpl);
    const out = await client.quoteSummary('AAPL', ['price']);
    expect(out).toEqual(QUOTE_BODY);
    const fcCall = calls.find((c) => c.url === 'https://fc.yahoo.com')!;
    expect(fcCall.init?.signal).toBeInstanceOf(AbortSignal); // U4 组合:回落路径经 fetchWithTimeout(带超时信号),无异常
    const crumbCall = calls.find((c) => c.url.includes('/v1/test/getcrumb'))!;
    expect(header(crumbCall.init, 'Cookie')).toBe('A3=fc-a3');
    expect(crumbCall.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('fc.yahoo.com 404 且无 Set-Cookie → 原错误语义保留:YahooApiError(status_code=404)', async () => {
    const { fetchImpl } = makeFetch([
      { match: (url) => url.startsWith('https://fc.yahoo.com'), respond: () => textResponse('not found', 404) },
    ]);
    await expect(new YahooClient(fetchImpl).quoteSummary('AAPL', ['price'])).rejects.toMatchObject({
      name: 'YahooApiError',
      code: null,
      status_code: 404,
    });
  });

  it('fc.yahoo.com 200 但无 Set-Cookie → 抛 YahooApiError(code=crumb)', async () => {
    const { fetchImpl } = makeFetch([
      { match: (url) => url.startsWith('https://fc.yahoo.com'), respond: () => textResponse('', 200) },
    ]);
    await expect(new YahooClient(fetchImpl).quoteSummary('AAPL', ['price'])).rejects.toMatchObject({
      name: 'YahooApiError',
      code: 'crumb',
      status_code: 200,
    });
  });

  it('401 → 清缓存刷新 crumb 重试一次成功（fc/getcrumb/quoteSummary 各两次，用新 crumb）', async () => {
    let crumbCalls = 0;
    let qsCalls = 0;
    const { fetchImpl, calls } = makeFetch([
      FC_ROUTE,
      {
        match: (url) => url.includes('/v1/test/getcrumb'),
        respond: () => {
          crumbCalls += 1;
          return textResponse(crumbCalls === 1 ? 'crumb-old' : 'crumb-new');
        },
      },
      {
        match: (url) => url.includes('/v10/finance/quoteSummary/'),
        respond: () => {
          qsCalls += 1;
          return qsCalls === 1 ? jsonResponse({ error: 'unauthorized' }, 401) : jsonResponse(QUOTE_BODY);
        },
      },
    ]);
    const out = await new YahooClient(fetchImpl).quoteSummary('0700.HK', ['price']);
    expect(out).toEqual(QUOTE_BODY);
    expect(qsCalls).toBe(2);
    expect(crumbCalls).toBe(2);
    const qsUrls = calls.filter((c) => c.url.includes('/v10/finance/quoteSummary/')).map((c) => c.url);
    expect(qsUrls[0]).toContain('crumb=crumb-old');
    expect(qsUrls[1]).toContain('crumb=crumb-new');
  });

  it('刷新后仍 401 → YahooApiError(code=crumb, status_code=401)', async () => {
    const { fetchImpl } = makeFetch([
      FC_ROUTE,
      crumbRoute('crumb-x'),
      {
        match: (url) => url.includes('/v10/finance/quoteSummary/'),
        respond: () => jsonResponse({ error: 'unauthorized' }, 401),
      },
    ]);
    await expect(new YahooClient(fetchImpl).quoteSummary('0700.HK', ['price'])).rejects.toMatchObject({
      name: 'YahooApiError',
      code: 'crumb',
      status_code: 401,
    });
  });

  it('cookieProvider 分支：不发 fc.yahoo.com 请求，getcrumb/quoteSummary 的 Cookie 用其返回值', async () => {
    const { fetchImpl, calls } = makeFetch([
      crumbRoute('crumb-provider'),
      { match: (url) => url.includes('/v10/finance/quoteSummary/'), respond: () => jsonResponse(QUOTE_BODY) },
    ]);
    const client = new YahooClient(fetchImpl, () => 'provider-a3');
    await client.quoteSummary('0700.HK', ['price']);
    expect(calls.filter((c) => c.url.startsWith('https://fc.yahoo.com'))).toHaveLength(0);
    const crumbCall = calls.find((c) => c.url.includes('/v1/test/getcrumb'))!;
    expect(header(crumbCall.init, 'Cookie')).toBe('A3=provider-a3');
    const qsCall = calls.find((c) => c.url.includes('/v10/finance/quoteSummary/'))!;
    expect(header(qsCall.init, 'Cookie')).toBe('A3=provider-a3');
  });

  it('C3 吊销自愈:401 触发 invalidateA3 钩子 → getter 重读 null → fc 取新 A3 成功', async () => {
    let providerCalls = 0;
    let fcCalls = 0;
    let crumbCalls = 0;
    let qsCalls = 0;
    let invalidated = 0;
    const { fetchImpl, calls } = makeFetch([
      {
        match: (url) => url.startsWith('https://fc.yahoo.com'),
        respond: () => {
          fcCalls += 1;
          return textResponse('', 404, { 'set-cookie': `A3=a3-fresh-${fcCalls}; Path=/` });
        },
      },
      {
        match: (url) => url.includes('/v1/test/getcrumb'),
        respond: () => {
          crumbCalls += 1;
          return textResponse(`crumb-${crumbCalls}`);
        },
      },
      {
        match: (url) => url.includes('/v10/finance/quoteSummary/'),
        respond: () => {
          qsCalls += 1;
          return qsCalls === 1 ? jsonResponse({ error: 'unauthorized' }, 401) : jsonResponse(QUOTE_BODY);
        },
      },
    ]);
    // getter 语义:首读返回旧值(模拟缓存命中),失效后重读 → null(C3 禁值闭包的根因)
    const provider = (): string | null => {
      providerCalls += 1;
      return providerCalls === 1 ? 'a3-stale' : null;
    };
    const out = await new YahooClient(fetchImpl, provider, () => {
      invalidated += 1;
    }).quoteSummary('0700.HK', ['price']);
    expect(out).toEqual(QUOTE_BODY); // 二次自愈成功
    expect(invalidated).toBe(1); // 401 → 恰一次失效通知
    const crumbCookies = calls
      .filter((c) => c.url.includes('/v1/test/getcrumb'))
      .map((c) => header(c.init, 'Cookie'));
    expect(crumbCookies).toEqual(['A3=a3-stale', 'A3=a3-fresh-1']); // 刷新链用新 A3,非旧缓存值
    expect(fcCalls).toBe(1); // 首链走 provider(零 fc);仅吊销后重取一次
    const qsUrls = calls.filter((c) => c.url.includes('/v10/finance/quoteSummary/')).map((c) => c.url);
    expect(qsUrls[0]).toContain('crumb=crumb-1');
    expect(qsUrls[1]).toContain('crumb=crumb-2');
  });

  it('C3 刷新后仍 401 → 抛 crumb/401,invalidateA3 只触发一次且 getter 已被重读', async () => {
    let providerCalls = 0;
    let invalidated = 0;
    const { fetchImpl } = makeFetch([
      FC_ROUTE,
      crumbRoute('crumb-x'),
      {
        match: (url) => url.includes('/v10/finance/quoteSummary/'),
        respond: () => jsonResponse({ error: 'unauthorized' }, 401),
      },
    ]);
    const provider = (): string | null => {
      providerCalls += 1;
      return providerCalls === 1 ? 'a3-stale' : null;
    };
    await expect(
      new YahooClient(fetchImpl, provider, () => {
        invalidated += 1;
      }).quoteSummary('0700.HK', ['price']),
    ).rejects.toMatchObject({ name: 'YahooApiError', code: 'crumb', status_code: 401 });
    expect(invalidated).toBe(1); // 自愈路径单次进入,不重复失效
    expect(providerCalls).toBeGreaterThanOrEqual(2); // 失效后 getter 被重读(返回 null → fc)
  });

  it('YAHOO_HOSTS 白名单常量（S3 代理防 SSRF 用）', () => {
    expect(YAHOO_HOSTS).toEqual([
      'query1.finance.yahoo.com',
      'query2.finance.yahoo.com',
      'fc.yahoo.com',
    ]);
  });
});

describe('composeYahooOverview', () => {
  const META = {
    symbol: '0700.HK',
    currency: 'HKD',
    regularMarketPrice: 370.4,
    previousClose: 372.6,
    chartPreviousClose: 372.6,
    regularMarketDayOpen: 371.0,
    regularMarketDayHigh: 375.2,
    regularMarketDayLow: 368.8,
    regularMarketVolume: 15_000_000,
    regularMarketDayVolume: 5_550_000_000,
  };
  const SUMMARY = {
    quoteSummary: {
      result: [
        {
          price: {
            longName: 'Tencent Holdings Limited',
            shortName: 'Tencent',
            regularMarketChange: { raw: -2.2 },
            regularMarketChangePercent: { raw: -0.0059 },
          },
          summaryDetail: {
            trailingPE: { raw: 14.8 },
            priceToBook: { raw: 3.2 },
            dividendYield: { raw: 0.0041 },
            trailingEps: { raw: 25.03 },
            '52WeekHigh': { raw: 399.6 },
            '52WeekLow': { raw: 258.2 },
          },
          defaultKeyStatistics: {
            marketCap: { raw: 3_400_000_000_000 },
            trailingEps: { raw: 25.03 },
            sharesOutstanding: { raw: 9_200_000_000 },
            floatShares: { raw: 8_900_000_000 },
            '52WeekHigh': { raw: 399.6 },
            '52WeekLow': { raw: 258.2 },
          },
        },
      ],
    },
  };

  it('映射表：CN 22 键 + Yahoo 专有键 + capital', () => {
    const { overview, capital } = composeYahooOverview(META, SUMMARY, { firstClose: 300, lastClose: 330 });
    expect(overview.ticker).toBe('0700.HK');
    expect(overview.name).toBe('Tencent Holdings Limited');
    expect(overview.latest_price).toBe(370.4);
    expect(overview.open_).toBe(371.0);
    expect(overview.high).toBe(375.2);
    expect(overview.low).toBe(368.8);
    expect(overview.prev_close).toBe(372.6);
    expect(overview.change_percent).toBeCloseTo(-0.59, 2); // raw 小数 ×100
    expect(overview.change_amount).toBe(-2.2);
    expect(overview.volume).toBe(15_000_000);
    expect(overview.amount).toBe(5_550_000_000);
    expect(overview.amplitude).toBeCloseTo(((375.2 - 368.8) / 372.6) * 100, 6);
    expect(overview.turnover_rate).toBeCloseTo((15_000_000 / 8_900_000_000) * 100, 6);
    expect(overview.pe_dynamic).toBe(14.8);
    expect(overview.pb).toBe(3.2);
    expect(overview.market_cap).toBe(3_400_000_000_000);
    expect(overview.circulating_market_cap).toBe(370.4 * 8_900_000_000);
    expect(overview.dividend_yield).toBe(0.0041);
    expect(overview.eps).toBe(25.03);
    expect(overview.week_52_high).toBe(399.6);
    expect(overview.week_52_low).toBe(258.2);
    expect(overview.currency).toBe('HKD');
    expect(overview.change_percent_60d).toBeCloseTo(((330 - 300) / 300) * 100, 6);
    // Yahoo 无 → NaN（对齐 CN pytdx 缺字段约定）
    expect(overview.volume_ratio).toBeNaN();
    expect(overview.momentum).toBeNaN();
    expect(overview.change_percent_5min).toBeNaN();
    expect(overview.change_percent_ytd).toBeNaN();
    expect(capital.zongguben).toBe(9_200_000_000);
    expect(capital.liutongguben).toBe(8_900_000_000);
  });

  it('容错与 NaN 语义：opts 缺 → 60d NaN；chartPreviousClose 回退；涨跌幅自算；缺失 → NaN', () => {
    const meta = { symbol: 'AAPL', currency: 'USD', regularMarketPrice: 200, chartPreviousClose: 190 };
    const summary = { quoteSummary: { result: [{ price: { longName: 'Apple Inc.' } }] } };
    const { overview, capital } = composeYahooOverview(meta, summary);
    expect(overview.latest_price).toBe(200);
    expect(overview.prev_close).toBe(190); // previousClose 缺 → chartPreviousClose
    expect(overview.change_percent).toBeCloseTo(((200 - 190) / 190) * 100, 4); // 自算
    expect(overview.change_amount).toBe(10);
    expect(overview.change_percent_60d).toBeNaN(); // opts 缺
    expect(overview.pe_dynamic).toBeNaN();
    expect(overview.pb).toBeNaN();
    expect(overview.market_cap).toBeNaN();
    expect(overview.dividend_yield).toBeNaN();
    expect(overview.eps).toBeNaN();
    expect(overview.week_52_high).toBeNaN();
    expect(overview.week_52_low).toBeNaN();
    expect(overview.volume).toBeNaN();
    expect(overview.amount).toBeNaN();
    expect(overview.turnover_rate).toBeNaN();
    expect(overview.high).toBeNaN();
    expect(overview.low).toBeNaN();
    expect(overview.open_).toBeNaN();
    expect(overview.amplitude).toBeNaN();
    expect(capital.zongguben).toBeNaN();
    expect(capital.liutongguben).toBeNaN();
  });

  it('字段缺失 {} → NaN（quoteSummary 值形态约定）', () => {
    const meta = { symbol: 'AAPL', regularMarketPrice: 100 };
    const summary = {
      quoteSummary: {
        result: [{ summaryDetail: { trailingPE: {} }, defaultKeyStatistics: { marketCap: {} } }],
      },
    };
    const { overview } = composeYahooOverview(meta, summary);
    expect(overview.pe_dynamic).toBeNaN();
    expect(overview.market_cap).toBeNaN();
  });
});

describe('composeYahooReports', () => {
  function q(endDate: string, over: Record<string, unknown> = {}): Record<string, unknown> {
    return { endDate: { raw: Date.parse(`${endDate}T00:00:00Z`) / 1000, fmt: endDate }, ...over };
  }

  function wrap(modules: Record<string, unknown>): Record<string, unknown> {
    return { quoteSummary: { result: [modules] } };
  }

  it('三模块映射 + 升序 + YoY（同月日上年同季）+ QoQ 相邻直算 + industry/ticker/name', () => {
    const modules = wrap({
      incomeStatementHistoryQuarterly: {
        incomeStatementStatements: [
          q('2025-06-30', { totalRevenue: { raw: 6000 }, netIncome: { raw: 1200 }, dilutedEPS: { raw: 0.6 }, grossProfit: { raw: 2400 } }),
          q('2025-03-31', { totalRevenue: { raw: 5000 }, netIncome: { raw: 1000 }, dilutedEPS: { raw: 0.5 }, grossProfit: { raw: 2000 } }),
          q('2024-06-30', { totalRevenue: { raw: 4000 }, netIncome: { raw: 800 }, dilutedEPS: { raw: 0.4 }, grossProfit: { raw: 1600 } }),
        ],
      },
      balanceSheetHistoryQuarterly: {
        balanceSheetStatements: [
          q('2025-06-30', { totalStockholderEquity: { raw: 30_000 } }),
          q('2025-03-31', { totalStockholderEquity: { raw: 28_000 } }),
          q('2024-06-30', { totalStockholderEquity: { raw: 25_000 } }),
        ],
      },
      cashflowStatementHistoryQuarterly: {
        cashflowStatements: [
          q('2025-06-30', { operatingCashFlow: { raw: 1800 } }),
          q('2025-03-31', { operatingCashFlow: { raw: 1500 } }),
          q('2024-06-30', { operatingCashFlow: { raw: 1200 } }),
        ],
      },
    });
    const rows = composeYahooReports(modules, 10_000, { ticker: '0700.HK', name: 'Tencent', industry: '互联网' });
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.report_date)).toEqual(['20240630', '20250331', '20250630']); // 升序
    const last = rows[2].fields;
    expect(last.eps).toBe(0.6);
    expect(last.total_income).toBe(6000); // 原币原始值，不做 ×10⁴
    expect(last.net_profit).toBe(1200);
    expect(last.net_worth_per_share).toBe(30_000 / 10_000);
    expect(last.net_worth_return_rate).toBeCloseTo((1200 / 30_000) * 100, 6);
    expect(last.cash_flow_per_share).toBeCloseTo(1800 / 10_000, 6);
    expect(last.sales_gross_margin).toBeCloseTo((2400 / 6000) * 100, 6);
    expect(last.industry).toBe('互联网');
    expect(last.ticker).toBe('0700.HK');
    expect(last.name).toBe('Tencent');
    // YoY：2025-06-30 vs 2024-06-30
    expect(last.total_income_YoY_rate).toBeCloseTo(((6000 - 4000) / 4000) * 100, 6);
    expect(last.net_profit_YoY_rate).toBeCloseTo(((1200 - 800) / 800) * 100, 6);
    // QoQ：相邻期直算（首期 NaN；2025-03-31 无上年同季 → YoY NaN）
    expect(last.total_income_QoQ_rate).toBeCloseTo(((6000 - 5000) / 5000) * 100, 6);
    expect(last.net_profit_QoQ_rate).toBeCloseTo(((1200 - 1000) / 1000) * 100, 6);
    expect(rows[0].fields.total_income_QoQ_rate).toBeNaN();
    expect(rows[1].fields.net_profit_YoY_rate).toBeNaN();
    expect(rows[1].fields.total_income_YoY_rate).toBeNaN();
  });

  it('半年报间隔 QoQ 仍直算（与 reports.ts adjacentQuarterGap 88~93 分歧——港股半年报）', () => {
    const modules = wrap({
      incomeStatementHistoryQuarterly: {
        incomeStatementStatements: [
          q('2025-12-31', { totalRevenue: { raw: 5000 }, netIncome: { raw: 1000 } }),
          q('2025-06-30', { totalRevenue: { raw: 3000 }, netIncome: { raw: 600 } }),
        ],
      },
    });
    const rows = composeYahooReports(modules, null, { industry: '综合' });
    expect(rows).toHaveLength(2);
    expect(rows[1].fields.total_income_QoQ_rate).toBeCloseTo(((5000 - 3000) / 3000) * 100, 6);
    expect(rows[1].fields.net_profit_QoQ_rate).toBeCloseTo(((1000 - 600) / 600) * 100, 6);
    // shares null → 每股类指标 NaN
    expect(rows[1].fields.net_worth_per_share).toBeNaN();
    expect(rows[1].fields.cash_flow_per_share).toBeNaN();
  });

  it('除零/缺失 → NaN；负上期净利 → YoY/QoQ NaN（overview divide 语义：分母≤0）', () => {
    const modules = wrap({
      incomeStatementHistoryQuarterly: {
        incomeStatementStatements: [
          q('2024-12-31', { totalRevenue: { raw: 0 }, netIncome: { raw: -100 }, grossProfit: { raw: 0 } }),
          q('2025-12-31', { totalRevenue: { raw: 2000 }, netIncome: { raw: 200 }, grossProfit: { raw: 500 } }),
        ],
      },
    });
    const rows = composeYahooReports(modules, null, {});
    const last = rows[1].fields;
    expect(last.total_income_QoQ_rate).toBeNaN(); // (2000-0)/0 除零
    expect(last.net_profit_QoQ_rate).toBeNaN(); // (200-(-100))/(-100) 分母≤0
    expect(last.net_profit_YoY_rate).toBeNaN(); // 上年同季净利为负 → 分母≤0
    expect(last.total_income_YoY_rate).toBeNaN(); // (2000-0)/0 除零
    expect(last.sales_gross_margin).toBeCloseTo((500 / 2000) * 100, 6);
    // 无 balance/cashflow 模块对齐 → NaN
    expect(rows[0].fields.net_worth_return_rate).toBeNaN();
    expect(last.net_worth_per_share).toBeNaN();
  });

  it('quarterly 模块缺失/空 → [] 不抛（含 modules 为 null）', () => {
    expect(composeYahooReports(wrap({ incomeStatementHistoryQuarterly: { incomeStatementStatements: [] } }), 100)).toEqual([]);
    expect(composeYahooReports({ quoteSummary: { result: [{}] } }, 100)).toEqual([]);
    expect(composeYahooReports(null, 100)).toEqual([]);
  });

  it('兼容直接传 result[0]（无 quoteSummary 壳）', () => {
    const direct = {
      incomeStatementHistoryQuarterly: {
        incomeStatementStatements: [
          q('2025-06-30', { totalRevenue: { raw: 100 }, netIncome: { raw: 10 } }),
        ],
      },
    };
    const rows = composeYahooReports(direct, 1000, { ticker: 'AAPL', name: 'Apple', industry: '' });
    expect(rows).toHaveLength(1);
    expect(rows[0].report_date).toBe('20250630');
    expect(rows[0].fields.ticker).toBe('AAPL');
    expect(rows[0].fields.industry).toBe('');
    expect(rows[0].fields.eps).toBeNaN(); // dilutedEPS 缺失 → NaN
  });
});
