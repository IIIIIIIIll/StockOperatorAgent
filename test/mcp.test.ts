// mcp 客户端单测：SSE/JSON 双响应解析、session 透传、门控、摘要格式。
// 离线（注入 fake fetch），无网络依赖。house style：无 mock 框架——构造注入 _fetch。
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  MCP_DISABLED_TEXT,
  MCP_NO_KEY_TEXT,
  TdxMcpClient,
  TdxQueryResult,
  getMarketIntel,
  mcpDisabled,
  rowToText,
} from '../src/mcp.ts';

// ─── env 快照（TDX_MCP_DISABLED/TDX_MCP_ENABLED/TDX_API_KEY） ──────────────

const ENV_KEYS = ['TDX_MCP_DISABLED', 'TDX_MCP_ENABLED', 'TDX_API_KEY'] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
});
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});
beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

// ─── fake fetch 基建 ────────────────────────────────────────────────────────

interface FakeResp {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  json(): Promise<unknown>;
}

/** 大小写不敏感的头查找（真实 Headers.get 语义；静态键 → Record）。 */
function fakeHeaders(pairs: Record<string, string>): { get(name: string): string | null } {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(pairs)) lower[k.toLowerCase()] = v;
  return { get: (name) => lower[name.toLowerCase()] ?? null };
}

function jsonResponse(body: unknown, extraHeaders: Record<string, string> = {}): FakeResp {
  return {
    ok: true,
    status: 200,
    headers: fakeHeaders({ 'content-type': 'application/json', ...extraHeaders }),
    text: async () => {
      throw new Error('JSON 响应不应走 text()');
    },
    json: async () => body,
  };
}

function sseResponse(text: string, extraHeaders: Record<string, string> = {}): FakeResp {
  return {
    ok: true,
    status: 200,
    headers: fakeHeaders({ 'content-type': 'text/event-stream', ...extraHeaders }),
    text: async () => text,
    json: async () => {
      throw new Error('SSE 响应不应走 json()');
    },
  };
}

interface JsonRpcBody {
  method?: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
}

/** JSON-RPC 请求体解析（in/typeof 逐字段收窄——外部解析数据先验形状）。 */
function parseJsonBody(init?: RequestInit): JsonRpcBody {
  const parsed: unknown = JSON.parse(String(init?.body ?? '{}'));
  if (typeof parsed !== 'object' || parsed === null) return {};
  const out: JsonRpcBody = {};
  if ('method' in parsed && typeof parsed.method === 'string') out.method = parsed.method;
  if ('params' in parsed && typeof parsed.params === 'object' && parsed.params !== null) {
    const p = parsed.params;
    out.params = {};
    if ('name' in p && typeof p.name === 'string') out.params.name = p.name;
    if ('arguments' in p && typeof p.arguments === 'object' && p.arguments !== null) {
      out.params.arguments = p.arguments as Record<string, unknown>;
    }
  }
  return out;
}

interface CapturedRequest {
  headers: Record<string, string>;
  body: JsonRpcBody;
}

/** 按 JSON-RPC method 路由 + 记录每次请求（headers/body）。 */
function makeRouter(routes: Record<string, FakeResp>) {
  const calls: CapturedRequest[] = [];
  const fakeFetch = (async (_url: unknown, init?: RequestInit) => {
    const body = parseJsonBody(init);
    const headers: Record<string, string> = {};
    const h = init?.headers;
    if (h && typeof h === 'object' && !Array.isArray(h)) {
      for (const [k, v] of Object.entries(h as Record<string, string>)) headers[k] = v;
    }
    calls.push({ headers, body });
    const method = body.method ?? '';
    const resp = routes[method];
    if (!resp) throw new Error(`unexpected method: ${method}`);
    return resp;
  }) as unknown as typeof fetch;
  return { fakeFetch, calls };
}

const SSE_INITIALIZE =
  'event: message\ndata: {"jsonrpc":"2.0","id":null,"method":"ping"}\n\n'
  + 'data: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","capabilities":{},"serverInfo":{"name":"tdx-mcp-test","version":"1.0"}}}\n\n';

/** 12 行结果（含 null/'' 字段验证摘要过滤）。 */
const QUERY_RAW = {
  meta: { code: 0, total: 12, message: 'ok' },
  headers: ['code', 'name', 'price', 'concept', 'empty'],
  data: [
    ['600519', '贵州茅台', 1680.5, '白酒', null],
    ['000858', '五粮液', 128.3, '白酒', ''],
    ['601318', '中国平安', 52.1, '保险', null],
    ['600036', '招商银行', 38.9, '银行', null],
    ['000001', '平安银行', 11.2, '银行', null],
    ['600030', '中信证券', 26.7, '证券', null],
    ['000651', '格力电器', 40.5, '家电', null],
    ['600900', '长江电力', 29.8, '电力', null],
    ['002027', '分众传媒', 6.4, '传媒', null],
    ['300750', '宁德时代', 210.0, '电池', null],
    ['601899', '紫金矿业', 18.9, '有色', null],
    ['688111', '金山办公', 310.0, '软件', null],
  ],
};

function sseToolCall(raw: Record<string, unknown>): FakeResp {
  return sseResponse(`data: ${JSON.stringify({
    jsonrpc: '2.0',
    id: 2,
    result: { content: [{ type: 'text', text: JSON.stringify(raw) }] },
  })}\n\n`);
}

describe('TdxMcpClient（JSON-RPC + SSE）', () => {
  it('SSE 解析：取首个含 result 的 data 行；Mcp-Session-Id 回传后续请求', async () => {
    const { fakeFetch, calls } = makeRouter({
      initialize: sseResponse(SSE_INITIALIZE, { 'Mcp-Session-Id': 'sess-1' }),
      'notifications/initialized': jsonResponse({}),
      'tools/call': sseToolCall(QUERY_RAW),
    });
    const client = new TdxMcpClient('test-key', { fetch: fakeFetch, baseUrl: 'http://mcp.test' });

    const result = await client.query('贵州茅台600519 实时行情 资金流向', 10);

    expect(result.ok()).toBe(true);
    expect(result.code).toBe(0);
    expect(result.total).toBe(12);
    expect(result.message).toBe('ok');
    expect(result.toDicts()).toHaveLength(12);
    expect(result.toDicts()[0]).toEqual({ code: '600519', name: '贵州茅台', price: 1680.5, concept: '白酒', empty: null });

    // 三次请求：initialize → initialized 通知 → tools/call
    expect(calls.map((c) => c.body.method)).toEqual(['initialize', 'notifications/initialized', 'tools/call']);
    // 密钥头 + 内容类型（全部请求）
    for (const c of calls) {
      expect(c.headers['tdx-api-key']).toBe('test-key');
      expect(c.headers['Content-Type']).toBe('application/json');
      expect(c.headers['Accept']).toBe('application/json, text/event-stream');
    }
    // 工具调用参数 + session 透传
    expect(calls[2].body.params).toEqual({ name: 'tdx_wenda_quotes', arguments: { question: '贵州茅台600519 实时行情 资金流向', range: 'AG', size: 10, page: 1 } });
    expect(calls[2].headers['Mcp-Session-Id']).toBe('sess-1');
    // 已握手：二次 query 不再走 initialize
    await client.query('第二次查询', 5);
    expect(calls.map((c) => c.body.method)).toEqual(['initialize', 'notifications/initialized', 'tools/call', 'tools/call']);
    expect(calls[3].body.params?.arguments).toEqual({ question: '第二次查询', range: 'AG', size: 5, page: 1 });
  });

  it('JSON 响应路径（content-type 非 SSE → resp.json）', async () => {
    const { fakeFetch, calls } = makeRouter({
      initialize: jsonResponse({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2024-11-05' } }),
      'notifications/initialized': jsonResponse({}),
      'tools/call': jsonResponse({
        jsonrpc: '2.0',
        id: 2,
        result: { content: [{ type: 'text', text: JSON.stringify({ meta: { code: 0, total: 1, message: 'ok' }, headers: ['code'], data: [['600519']] }) }] },
      }),
    });
    const client = new TdxMcpClient('k', { fetch: fakeFetch });

    const result = await client.query('q');
    expect(result.ok()).toBe(true);
    expect(result.toDicts()).toEqual([{ code: '600519' }]);
    expect(calls).toHaveLength(3);
  });

  it('MCP error 响应 → callTool 抛错（对齐 Python RuntimeError）', async () => {
    const { fakeFetch } = makeRouter({
      initialize: jsonResponse({ jsonrpc: '2.0', id: 1, result: {} }),
      'notifications/initialized': jsonResponse({}),
      'tools/call': jsonResponse({ jsonrpc: '2.0', id: 2, error: { code: -32601, message: 'Method not found' } }),
    });
    const client = new TdxMcpClient('k', { fetch: fakeFetch });
    await expect(client.callTool('tdx_wenda_quotes', {})).rejects.toThrow(/MCP 错误/);
  });

  it('非 2xx → 抛错带状态码', async () => {
    const { fakeFetch } = makeRouter({
      initialize: jsonResponse({ jsonrpc: '2.0', id: 1, result: {} }),
      'notifications/initialized': jsonResponse({}),
      'tools/call': { ok: false, status: 401, headers: fakeHeaders({}), text: async () => '', json: async () => ({}) },
    });
    const client = new TdxMcpClient('k', { fetch: fakeFetch });
    await expect(client.query('q')).rejects.toThrow(/TDX MCP HTTP 401/);
  });

  it('空 apiKey 构造抛错', () => {
    expect(() => new TdxMcpClient('')).toThrow(/TDX_API_KEY/);
  });

  it('TdxQueryResult 缺字段默认值（code -1 / ok false）', () => {
    const r = new TdxQueryResult({});
    expect(r.code).toBe(-1);
    expect(r.ok()).toBe(false);
    expect(r.toDicts()).toEqual([]);
  });
});

describe('mcpDisabled 门控（对齐 Python runtime_config 假值元组）', () => {
  it('默认（未设置）→ 开', () => {
    expect(mcpDisabled()).toBe(false);
  });

  it.each(['', '0', 'false', 'no'])('TDX_MCP_DISABLED=%j → 开（显式假值）', (v) => {
    process.env.TDX_MCP_DISABLED = v;
    expect(mcpDisabled()).toBe(false);
  });

  it.each(['1', 'true', 'yes', 'TRUE'])('TDX_MCP_DISABLED=%j → 禁用', (v) => {
    process.env.TDX_MCP_DISABLED = v;
    expect(mcpDisabled()).toBe(true);
  });

  it('TDX_MCP_ENABLED 覆盖层优先：True=开（压过 DISABLED=1）', () => {
    process.env.TDX_MCP_DISABLED = '1';
    process.env.TDX_MCP_ENABLED = '1';
    expect(mcpDisabled()).toBe(false);
    process.env.TDX_MCP_ENABLED = 'true';
    expect(mcpDisabled()).toBe(false);
  });

  it.each(['0', 'false', ''])('TDX_MCP_ENABLED=%j → 关（False=关）', (v) => {
    process.env.TDX_MCP_ENABLED = v;
    expect(mcpDisabled()).toBe(true);
  });
});

describe('getMarketIntel（门控/key/查询/摘要）', () => {
  it('禁用 → 占位文本，不发起查询', async () => {
    process.env.TDX_MCP_DISABLED = '1';
    process.env.TDX_API_KEY = 'k';
    let called = false;
    const text = await getMarketIntel('600036', {
      fetch: (async () => {
        called = true;
        throw new Error('不应发起请求');
      }) as unknown as typeof fetch,
    });
    expect(text).toBe(MCP_DISABLED_TEXT);
    expect(called).toBe(false);
  });

  it('TDX_MCP_ENABLED 覆盖开 + 无 key → 未配置占位（覆盖层生效）', async () => {
    process.env.TDX_MCP_DISABLED = '1';
    process.env.TDX_MCP_ENABLED = '1';
    expect(await getMarketIntel('600036')).toBe(MCP_NO_KEY_TEXT);
  });

  it('无 TDX_API_KEY → 未配置占位', async () => {
    expect(await getMarketIntel('600036')).toBe(MCP_NO_KEY_TEXT);
  });

  it('查询异常（fetch 抛错）→ 占位不抛', async () => {
    process.env.TDX_API_KEY = 'k';
    const text = await getMarketIntel('600036', {
      fetch: (async () => {
        throw new TypeError('network down');
      }) as unknown as typeof fetch,
    });
    expect(text).toBe('（通达信 MCP 查询异常，跳过600036的实时情报）');
  });

  it('meta.code != 0 → 查询失败占位带 message', async () => {
    process.env.TDX_API_KEY = 'k';
    const { fakeFetch } = makeRouter({
      initialize: sseResponse(SSE_INITIALIZE),
      'notifications/initialized': jsonResponse({}),
      'tools/call': sseToolCall({ meta: { code: 500, total: 0, message: '服务器繁忙' }, headers: [], data: [] }),
    });
    expect(await getMarketIntel('600036', { fetch: fakeFetch })).toBe('（通达信 MCP 查询失败：服务器繁忙）');
  });

  it('无返回数据 → 占位', async () => {
    process.env.TDX_API_KEY = 'k';
    const { fakeFetch } = makeRouter({
      initialize: sseResponse(SSE_INITIALIZE),
      'notifications/initialized': jsonResponse({}),
      'tools/call': sseToolCall({ meta: { code: 0, total: 0, message: 'ok' }, headers: ['code'], data: [] }),
    });
    expect(await getMarketIntel('600036', { fetch: fakeFetch })).toBe('（通达信 MCP 无返回数据）');
  });

  it('成功 → 【实时市场情报】+ 前 10 行 + null/空字段过滤', async () => {
    process.env.TDX_API_KEY = 'k';
    const { fakeFetch } = makeRouter({
      initialize: sseResponse(SSE_INITIALIZE, { 'Mcp-Session-Id': 'sess-1' }),
      'notifications/initialized': jsonResponse({}),
      'tools/call': sseToolCall(QUERY_RAW),
    });
    const text = await getMarketIntel('600036', { fetch: fakeFetch });

    const lines = text.split('\n');
    expect(lines[0]).toBe('【实时市场情报】');
    expect(lines).toHaveLength(11); // 标题 + 10 行（12 条只取前 10）
    expect(lines[1]).toBe('code: 600519, name: 贵州茅台, price: 1680.5, concept: 白酒'); // empty=null 过滤
    expect(lines[2]).toBe('code: 000858, name: 五粮液, price: 128.3, concept: 白酒'); // empty='' 过滤
    expect(lines[10]).toContain('宁德时代');
    expect(text).not.toContain('紫金矿业'); // 第 11/12 行不出现
  });
});

describe('rowToText', () => {
  it('过滤 null/空值，保留 0/false；`, ` 连接', () => {
    expect(rowToText({ a: 1, b: null, c: '', d: 'x', e: 0, f: false })).toBe('a: 1, d: x, e: 0, f: false');
  });

  it('全过滤 → 空串', () => {
    expect(rowToText({ a: null, b: '', c: undefined })).toBe('');
  });
});
