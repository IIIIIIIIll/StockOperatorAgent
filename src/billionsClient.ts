// 亿信 Fin 开放平台客户端 —— 移植自 Python data_source/chinese_mainland/
// billions/client.py（08-13-ts-capability-completion, R1）。4 端点薄包装
// （fin_db / search / twitter_search / fetch），全部 POST + `X-API-KEY` 头，
// BASE https://openapi.billionsintelligence.com/api。
//
// 约定（对齐 Python client.py 逐项 + error-handling 降级）：
// - 返回响应 JSON dict 原样（字段提取由调用方做），**不重试**
// - 失败归一化 BillionsApiError：网络/超时异常（statusCode=null）/ HTTP
//   非 2xx（取 body error/code）/ 2xx 但 `success === false`（上游超时等
//   业务失败语义）→ 抛错，由调用方降级（不阻断 agent 流程）
// - 超时参数化：fin_db 120s；search/twitter 按档位 fast 25 / advanced 70 /
//   expert 120（未知档位回退 fast）；fetch 90s；AbortSignal.timeout 实现
// - 密钥：构造 opts.apiKey 覆盖 env `BILLIONS_API_KEY`；**不写日志**
// - fetch 注入点（house style 无 mock 框架，对齐 Python `_http`）
import { envValue } from './env.ts';

/** 亿信 API 调用失败（归一化错误，client 内唯一异常）。
 *
 * @param message 人类可读错误信息
 * @param code 上游返回的业务错误码/错误信息（body 的 error 或 code），无 → null
 * @param statusCode HTTP 状态码（网络异常无响应 → null）
 */
export class BillionsApiError extends Error {
  readonly code: string | null;
  readonly statusCode: number | null;

  constructor(message: string, code: string | null = null, statusCode: number | null = null) {
    super(message);
    this.name = 'BillionsApiError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export type FetchLike = typeof fetch;

export interface BillionsClientOptions {
  /** 测试注入点（对齐 Python `_http`）；缺省 globalThis.fetch。 */
  fetch?: FetchLike;
  /** 覆盖 env `BILLIONS_API_KEY`。 */
  apiKey?: string;
  /** 覆盖默认 BASE。 */
  baseUrl?: string;
}

export interface SearchOptions {
  /** source 枚举 web/academic/image/video/announcement/report/expert；缺省 'web'。 */
  source?: string;
  /** fast / advanced / expert（更慢档位后端等待更长）；缺省 'fast'。 */
  searchMode?: string;
  /** 1-50；缺省 10。 */
  count?: number;
  /** 如 "past 3 months"（缺省不传，结果量优先受 time_range 控制）。 */
  timeRange?: string | null;
}

export interface TwitterSearchOptions {
  /** 三档深度同 search；缺省 'fast'。 */
  searchMode?: string;
  /** 1-50；缺省 10。 */
  count?: number;
}

export interface FetchDocOptions {
  /** 网页全文；与 docId 互斥，二选一（都传/都不传 → 上游 422，client 不本地校验）。 */
  url?: string | null;
  /** search 结果 extra.doc_id，原样传入（公告全文精读入口）。 */
  docId?: string | null;
  /** ≥1，分页模式；超范围返回最后一页。 */
  page?: number | null;
  /** 500-12000，默认 6000；显式传值进入分页模式。 */
  maxChars?: number | null;
}

export const BILLIONS_BASE = 'https://openapi.billionsintelligence.com/api';

/** 同源代理 fetch(web 端亿信 CORS 根治):亿信实际 POST 响应不带
 *  Access-Control-Allow-Origin(预检 204 有、响应 401/2xx 无,08-29 实证),
 *  浏览器直连被 CORS 拦截 → 改经同源 /billions-proxy 转发(server 固定 host
 *  + path 白名单,见 proxies.cjs handleBillionsProxy)。Node/RN 无 CORS,
 *  不走此分支,维持直连。base 由调用方传(web 取 location.origin),函数惰性
 *  ——对齐 makeProxySearcher/makeProxyMcpFetch 先例。头白名单仅透传
 *  x-api-key/content-type/accept(密钥只经白名单头),其余头拒绝。 */
export function makeProxyBillionsFetch(base: string): typeof fetch {
  const FORWARD: Record<string, true> = {
    'x-api-key': true,
    'content-type': true,
    accept: true,
  };
  return (input, init) => {
    // input 三形态(string URL / URL / Request)统一取 href;白名单头组装。
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    const url = new URL(raw);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      if (Object.hasOwn(FORWARD, k.toLowerCase())) headers[k] = v;
    });
    return fetch(`${base}/billions-proxy${url.pathname}${url.search}`, { ...init, headers });
  };
}

const _FIN_DB_PATH = '/v1/fin_db';
const _SEARCH_PATH = '/v2/search';
const _TWITTER_PATH = '/v2/twitter/search';
const _FETCH_PATH = '/v2/fetch';

// 客户端超时（毫秒）按档位：fast 25s / advanced 70s / expert 120s
// （未知档位回退 fast）。
const _MODE_TIMEOUTS: Record<string, number> = { fast: 25_000, advanced: 70_000, expert: 120_000 };
const FIN_DB_TIMEOUT = 120_000;
const FETCH_TIMEOUT = 90_000;

export class BillionsClient {
  private readonly _fetch: FetchLike;
  private readonly _apiKey: string | undefined;
  private readonly _baseUrl: string;

  constructor(opts: BillionsClientOptions = {}) {
    // F1:Chrome 强制 fetch 的 this 须为 undefined/Window,方法形式调用
    // `this._fetch(...)`(this=实例)会抛 Illegal invocation(08-29-e2e 实证)。
    // 缺省包装为裸调用 fetch(...):ESM 严格模式 this === undefined,满足
    // Chrome 约束;箭头函数无 this 依赖,方法调用不受影响。注入的 fake fetch
    // (opts.fetch)优先,行为零变化。
    this._fetch = opts.fetch ?? ((input: URL | RequestInfo, init?: RequestInit) => fetch(input, init));
    this._apiKey = opts.apiKey ?? envValue('BILLIONS_API_KEY');
    this._baseUrl = opts.baseUrl ?? BILLIONS_BASE;
  }

  /** 是否配置 API key（注入或 env）——调用方门控（对齐 Python 主闸：无 key
   *  亿信路径静默关闭、不发起请求）。 */
  get hasApiKey(): boolean {
    return Boolean(this._apiKey);
  }

  /** POST JSON 并归一化响应；失败 → 抛 BillionsApiError（**不重试**）。
   *
   * 网络/连接/超时异常 → BillionsApiError(statusCode=null)；HTTP 非 2xx →
   * 取 body error/code 作 code；2xx 但 `success === false`（上游超时等业务
   * 失败语义）→ 同样归一化。
   */
  private async _post(
    path: string,
    payload: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this._apiKey) headers['X-API-KEY'] = this._apiKey;
    let resp: Response;
    try {
      resp = await this._fetch(`${this._baseUrl}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (exc) {
      // 网络/连接/超时异常 → 归一化（client 不做重试，调用方降级）
      const detail = exc instanceof Error ? exc.message : String(exc);
      throw new BillionsApiError(`亿信 API 请求失败：${detail}`);
    }
    let data: unknown = null;
    try {
      data = await resp.json();
    } catch {
      data = null; // 非 JSON body → 按无 body 归一化（对齐 Python ValueError 分支）
    }
    // JSON dict 判定（对齐 Python isinstance(data, dict)）；非 dict → null
    const dataObj =
      typeof data === 'object' && data !== null && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : null;
    if (resp.status < 200 || resp.status >= 300) {
      let code: string | null = null;
      if (dataObj !== null) {
        const raw = dataObj['error'] || dataObj['code'];
        if (raw !== undefined && raw !== null && raw !== '') code = String(raw);
      }
      throw new BillionsApiError(
        `亿信 API 错误：HTTP ${resp.status}${code ? `（${code}）` : ''}`,
        code,
        resp.status,
      );
    }
    if (dataObj === null || dataObj['success'] === false) {
      // HTTP 2xx 仅表示已处理；业务成败看 success（twitter 上游超时即
      // HTTP 200 + success:false，research 语义）
      const error = dataObj?.['error'];
      const errStr = error !== undefined && error !== null && error !== '' ? String(error) : null;
      throw new BillionsApiError(`亿信 API 业务失败：${errStr ?? 'success=false'}`, errStr, resp.status);
    }
    return dataObj;
  }

  /** fin-db 自然语言金融问数（v1，auto 路由；客户端超时 120s）。
   *
   * @param query 自然语言问题（1-2000 字符）
   * @param dataSources 默认 "auto"；枚举 `A股财务行情数据库` / `海外财务行情数据库` / `宏观行业数据库`
   * @return 响应 JSON dict（``result[].content`` 为 Markdown 表格）
   * @throws BillionsApiError 失败归一化（调用方降级）
   */
  async finDb(query: string, dataSources?: string | string[] | null): Promise<Record<string, unknown>> {
    return this._post(_FIN_DB_PATH, { query, data_sources: dataSources ?? 'auto' }, FIN_DB_TIMEOUT);
  }

  /** search 检索（v2；source 枚举 web/academic/image/video/announcement/
   * report/expert）。timeout 按档位 fast 25s / advanced 70s / expert 120s
   * （未知档位回退 fast）。
   *
   * @return 响应 JSON dict（``result[0].content[]`` 为
   *   title/link/snippet/date/extra 条目列表）
   * @throws BillionsApiError 失败归一化（调用方降级）
   */
  async search(query: string, opts: SearchOptions = {}): Promise<Record<string, unknown>> {
    const payload: Record<string, unknown> = {
      query,
      source: opts.source ?? 'web',
      search_mode: opts.searchMode ?? 'fast',
      count: opts.count ?? 10,
    };
    if (opts.timeRange) payload['time_range'] = opts.timeRange;
    const mode = opts.searchMode ?? 'fast';
    const timeoutMs = _MODE_TIMEOUTS[mode] ?? _MODE_TIMEOUTS['fast'];
    return this._post(_SEARCH_PATH, payload, timeoutMs);
  }

  /** twitter 检索（v2/twitter/search，三档深度同 search）。
   *
   * @return 响应 JSON dict（``result[0].content[]`` 为
   *   title("@user: " 前缀)/link/snippet/date/extra{username, view_count} 条目列表）
   * @throws BillionsApiError 失败归一化（上游超时 → HTTP 200 + success:false，同样归一化）
   */
  async twitterSearch(query: string, opts: TwitterSearchOptions = {}): Promise<Record<string, unknown>> {
    const payload: Record<string, unknown> = {
      query,
      search_mode: opts.searchMode ?? 'fast',
      count: opts.count ?? 10,
    };
    const mode = opts.searchMode ?? 'fast';
    const timeoutMs = _MODE_TIMEOUTS[mode] ?? _MODE_TIMEOUTS['fast'];
    return this._post(_TWITTER_PATH, payload, timeoutMs);
  }

  /** fetch 网页全文 / 公告全文（v2；url 与 docId 互斥，二选一；只传非空字段）。
   *
   * 已知限制：report/expert 的 doc_id 全文未开放（403 SOURCE_NOT_LICENSED）；
   * announcement 的 doc_id 全套餐可用。url 与 docId 都传/都不传 → 上游 422
   * （INVALID_ARGUMENT），client 不做本地校验（薄包装，归一化为 BillionsApiError）。
   *
   * @return 响应 JSON dict（content 为 Markdown，分页前缀 [Page N/M]；
   *   pages/total_pages/total_chars/truncated）
   * @throws BillionsApiError 失败归一化（调用方降级）
   */
  async fetchDoc(opts: FetchDocOptions = {}): Promise<Record<string, unknown>> {
    const payload: Record<string, unknown> = {};
    if (opts.url) payload['url'] = opts.url;
    if (opts.docId) payload['doc_id'] = opts.docId;
    if (opts.page !== undefined && opts.page !== null) payload['page'] = opts.page;
    if (opts.maxChars !== undefined && opts.maxChars !== null) payload['max_chars'] = opts.maxChars;
    return this._post(_FETCH_PATH, payload, FETCH_TIMEOUT);
  }
}
