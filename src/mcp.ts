// TDX MCP 客户端 —— 移植自 data_source/chinese_mainland/tdx/vendor/scripts/tdx_mcp/tdx_client.py
// + core/llms/tools/get_market_intel.py（门控/占位/中文摘要语义）。
// JSON-RPC 2.0 over HTTP：Streamable HTTP（JSON）与 SSE 双响应解析；
// Mcp-Session-Id 透传（_sessionId 状态）。
// 缓存简化决策（design.md）：TS 无 is_trading_time 完整移植 → 不做缓存，
// 每次实时查询（与 Python 交易时段行为一致；mcp_intel_cache.py 不移植）。
// 密钥纪律：apiKey 只进请求头，任何路径不 log 密钥值。
import { envValue } from './env.ts';
import { getCapabilitySwitches } from './switches.ts';

export const MCP_URL = 'https://mcp.tdx.com.cn:3001/mcp';
export const DEFAULT_TIMEOUT_MS = 30_000;

export type FetchLike = typeof fetch;

export interface McpClientOptions {
  fetch?: FetchLike;
  baseUrl?: string;
  timeoutMs?: number;
}

/** 解析后的查询结果（对齐 Python TdxQueryResult）。 */
export class TdxQueryResult {
  raw: Record<string, unknown>;
  code: number;
  total: number;
  message: string;
  headers: string[];
  data: unknown[][];
  summary: string;

  constructor(raw: Record<string, unknown>) {
    this.raw = raw;
    const meta = (raw.meta ?? {}) as Record<string, unknown>;
    this.code = typeof meta.code === 'number' ? meta.code : -1;
    this.total = typeof meta.total === 'number' ? meta.total : 0;
    this.message = typeof meta.message === 'string' ? meta.message : '';
    this.headers = Array.isArray(raw.headers) ? (raw.headers as string[]) : [];
    this.data = Array.isArray(raw.data) ? (raw.data as unknown[][]) : [];
    this.summary = typeof raw.summary === 'string' ? raw.summary : '';
  }

  ok(): boolean {
    return this.code === 0;
  }

  /** data 行 → 字段名->值 dict 列表（对齐 Python dict(zip(headers, row)) 截短语义）。 */
  toDicts(): Array<Record<string, unknown>> {
    return this.data.map((row) => {
      const d: Record<string, unknown> = {};
      const n = Math.min(this.headers.length, row.length);
      for (let i = 0; i < n; i++) d[this.headers[i]] = row[i];
      return d;
    });
  }
}

export class TdxMcpClient {
  private apiKey: string;
  private _fetch: FetchLike;
  private baseUrl: string;
  private timeoutMs: number;
  private sessionId: string | null = null;
  private reqId = 0;

  constructor(apiKey: string, opts: McpClientOptions = {}) {
    if (!apiKey) throw new Error('缺少 TDX_API_KEY，请设置环境变量或传入 apiKey 参数');
    this.apiKey = apiKey;
    this._fetch = opts.fetch ?? fetch;
    this.baseUrl = opts.baseUrl ?? MCP_URL;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private _nextId(): number {
    this.reqId += 1;
    return this.reqId;
  }

  private _baseHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'tdx-api-key': this.apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    };
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
    return headers;
  }

  /** 发送 JSON-RPC 请求；content-type 含 text/event-stream → SSE 解析，否则 resp.json()。 */
  private async _post(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const resp = await this._fetch(this.baseUrl, {
      method: 'POST',
      headers: this._baseHeaders(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!resp.ok) throw new Error(`TDX MCP HTTP ${resp.status}`);
    const sid = resp.headers.get('Mcp-Session-Id');
    if (sid) this.sessionId = sid;
    const ct = resp.headers.get('content-type') ?? '';
    if (ct.includes('text/event-stream')) return TdxMcpClient._parseSse(await resp.text());
    return (await resp.json()) as Record<string, unknown>;
  }

  /** 从 SSE 流提取首个含 result/error 的 data 行；无 → {}（对齐 Python _parse_sse）。 */
  private static _parseSse(text: string): Record<string, unknown> {
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith('data: ')) continue;
      try {
        const obj: unknown = JSON.parse(line.slice(6));
        if (obj && typeof obj === 'object' && ('result' in obj || 'error' in obj)) {
          return obj as Record<string, unknown>;
        }
      } catch {
        continue; // 非 JSON 行跳过（对齐 Python JSONDecodeError: continue）
      }
    }
    return {};
  }

  /** MCP 握手：initialize + initialized 通知（fire-and-forget，失败静默）。 */
  async initialize(): Promise<Record<string, unknown>> {
    const result = await this._post({
      jsonrpc: '2.0',
      id: this._nextId(),
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'tdx-ts-client', version: '1.0' },
      },
    });
    try {
      // initialized 通知（无 id，不需要响应；对齐 Python timeout=10）
      await this._fetch(this.baseUrl, {
        method: 'POST',
        headers: this._baseHeaders(),
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      // 通知失败不阻断握手（对齐 Python try/except: pass）
    }
    return result;
  }

  /** 调用 MCP tool；未 initialize 先初始化；content 文本 → JSON.parse（失败 → raw_text）。 */
  async callTool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (this.sessionId === null) await this.initialize();
    const resp = await this._post({
      jsonrpc: '2.0',
      id: this._nextId(),
      method: 'tools/call',
      params: { name, arguments: args },
    });
    if ('result' in resp) {
      const r = resp.result;
      const content = r !== null && typeof r === 'object' && 'content' in r && Array.isArray(r.content)
        ? (r.content as Array<{ type?: string; text?: string }>)
        : [];
      for (const item of content) {
        if (item.type !== 'text' || typeof item.text !== 'string') continue;
        try {
          return JSON.parse(item.text) as Record<string, unknown>;
        } catch {
          return { raw_text: item.text };
        }
      }
    }
    if ('error' in resp) {
      throw new Error(`MCP 错误: ${JSON.stringify(resp.error)}`);
    }
    return resp;
  }

  /** 自然语言查询（A股；工具名与参数对齐 Python TdxMcpClient.query）。 */
  async query(question: string, size = 10): Promise<TdxQueryResult> {
    const raw = await this.callTool('tdx_wenda_quotes', {
      question,
      range: 'AG',
      size,
      page: 1,
    });
    return new TdxQueryResult(raw);
  }
}

/** 同源代理 fetch(F2:web 端 TdxMcpClient 直连通达信 MCP 服务器受 CORS 限制,
 *  改经同源 /tdx-mcp 代理转发;Node/RN 无 CORS,不走此分支,维持直连)。
 *  base 由调用方传(web 取 location.origin),函数惰性——对齐 makeProxySearcher
 *  先例(webSearch.ts)。头白名单仅透传 tdx-api-key/content-type/accept/
 *  mcp-session-id(小写比较;原键名写入,服务端按原样转发),其余头拒绝——
 *  密钥只经白名单头,不落地其他位置;其余 init 字段原样展开。无超时——
 *  server 端 60s timer 兜底(proxies.cjs handleTdxMcp,同源链路 R4 流式)。 */
export function makeProxyMcpFetch(base: string): typeof fetch {
  // 转发头白名单(S6 纪律;与 proxies.cjs TDX_MCP_FORWARD_HEADERS 同名单,
  // 双端单源防漂移——客户端过滤在先,服务端再按同名单过滤一次)。
  // Record<string, true> 静态查表(ts-set-map 规则;Object.hasOwn 防
  // prototype 键如 'constructor' 误放行)
  const FORWARD: Record<string, true> = {
    'tdx-api-key': true,
    'content-type': true,
    accept: true,
    'mcp-session-id': true,
  };
  return (input, init) => {
    const headers: Record<string, string> = {};
    // Headers 统一解析(接受 Record/数组/Headers 三种 init.headers 形态;
    // forEach 键名已归一化为小写——服务端/上游均大小写不敏感,语义等价)
    new Headers(init?.headers).forEach((v, k) => {
      if (Object.hasOwn(FORWARD, k.toLowerCase())) headers[k] = v;
    });
    return fetch(`${base}/tdx-mcp`, { ...init, headers });
  };
}

// ─── 门控与摘要（对齐 Python get_market_intel，缓存不做） ────────────────

export const MCP_DISABLED_TEXT = '（TDX MCP 已禁用，跳过实时市场情报）';
export const MCP_NO_KEY_TEXT = '（未配置 TDX_API_KEY，跳过实时市场情报）';

/** 优先级:TDX_MCP_ENABLED env 覆盖 > config.tdxMcp > env 默认(TDX_MCP_DISABLED
 *  经 fromEnv 反推,与旧 envDisabled 判定逐位等价)。覆盖层对齐 Python
 *  runtime_bool 假值元组(''/0/false/no → 关)。消费点惰性读 config。 */
export function mcpDisabled(): boolean {
  const override = envValue('TDX_MCP_ENABLED');
  if (override !== undefined) {
    return ['', '0', 'false', 'no'].includes(override.toLowerCase());
  }
  return !getCapabilitySwitches().tdxMcp;
}

/** 一行数据 → `字段: 值` 文本（过滤 null/空值；对齐 Python row_to_text）。 */
export function rowToText(row: Record<string, unknown>): string {
  return Object.entries(row)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');
}

/** 实时查询 MCP 并拼中文摘要；失败/异常 → 降级占位（不 raise）。 */
export async function queryMarketIntel(
  ticker: string,
  apiKey: string,
  opts?: { fetch?: FetchLike },
): Promise<string> {
  try {
    const client = new TdxMcpClient(apiKey, { fetch: opts?.fetch });
    const result = await client.query(`${ticker} 实时行情 资金流向 所属概念板块`, 50);
    if (!result.ok()) return `（通达信 MCP 查询失败：${result.message}）`;
    const rows = result.toDicts();
    if (!rows.length) return '（通达信 MCP 无返回数据）';
    const lines = rows.slice(0, 10).map(rowToText);
    return '【实时市场情报】\n' + lines.join('\n');
  } catch {
    // MCP 网络/解析异常不阻断主流程（图可继续）
    return `（通达信 MCP 查询异常，跳过${ticker}的实时情报）`;
  }
}

/** 按目标股票查询实时情报，返回中文摘要文本；禁用/无 key/失败 → 占位（不 raise）。
 *  apiKey 显式传入覆盖 env（web 端 key 存 localStorage 而非 process.env）；
 *  缺省经 envValue 读 TDX_API_KEY。接线：async —— 调用方 await 后注入
 *  pipeline deps.mcp 的同步闭包（design.md makeMcpIntel；deps.mcp 契约
 *  (ticker) => string）。 */
export async function getMarketIntel(
  ticker: string,
  opts?: { fetch?: FetchLike; apiKey?: string },
): Promise<string> {
  if (mcpDisabled()) return MCP_DISABLED_TEXT;
  const apiKey = opts?.apiKey ?? envValue('TDX_API_KEY') ?? '';
  if (!apiKey) return MCP_NO_KEY_TEXT;
  return queryMarketIntel(ticker, apiKey, opts);
}
