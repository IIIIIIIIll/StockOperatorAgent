// Yahoo Finance REST 客户端 —— 薄包装（形态对齐 src/billionsClient.ts：
// class per source / method per endpoint / 构造注入 fetchImpl / 唯一自定义
// 异常 / 不重试；消费方 catch → 降级占位，见 error-handling spec）。
// 免 key：chart 免 crumb；quoteSummary 需 crumb（A3 cookie → crumb 两跳，
// 实例缓存）。
//
// 实测基准（research/yahoo-api-verified.md，2026-08-19）：
// - chart 免 crumb，range=max&interval=1d&events=div%2Csplit，0700.HK/AAPL
//   均 200；无效符号 → HTTP 200 + {"chart":{"error":…}}（client 不抛，
//   调用方以 result 存在与否判定）
// - fc.yahoo.com 设置 A3 cookie；v1/test/getcrumb（带 Cookie: A3=…）返回
//   12 位随机 crumb；quoteSummary 需 crumb + Cookie
// - 注意：v7/finance/quote 端点 401 不可用（勿用）
//
// 约定：
// - 每请求带 User-Agent: Mozilla/5.0
// - 失败归一化 YahooApiError(code, status_code, message)：网络异常
//   （status_code=null）/ 超时（code='timeout'，status_code=null）/
//   HTTP 非 2xx（尽力取 body error.code）；**不重试**
// - quoteSummary 遇 401 → 清 crumb 缓存 → 重新取 A3+crumb → 重试一次 →
//   仍失败抛 YahooApiError('crumb', 401, …)
// - cookieProvider 注入（S3 RN 路径）：非空时 crumb 流程直接用其返回值作
//   A3 值，不发 fc.yahoo.com 网络请求（fetchImpl 场景则从 Set-Cookie 解析）
// 纯 TS + fetch-only：零 node: 导入（架构断言 #1），进 metro 图安全。

/** Yahoo API 调用失败（归一化错误，client 内唯一异常）。
 *
 * @param code 业务错误码（非 2xx body 的 error.code；crumb 失效 → 'crumb'；
 *   网络异常 → null）
 * @param status_code HTTP 状态码（网络异常无响应 → null）
 * @param message 人类可读错误信息
 */
export class YahooApiError extends Error {
  readonly code: string | null;
  readonly status_code: number | null;

  constructor(code: string | null, status_code: number | null, message: string) {
    super(message);
    this.name = 'YahooApiError';
    this.code = code;
    this.status_code = status_code;
  }
}

/** Yahoo host 白名单（S3 代理防 SSRF 用；本切片仅导出常量）。 */
export const YAHOO_HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com', 'fc.yahoo.com'];

/** Set-Cookie 头 → A3 cookie 值（多 cookie 逗号拼接容错：起始/分号/逗号后
 *  均可出现 A3=；无 → null）。S3 真机/代理路径（deviceYahooCollect.obtainA3）
 *  复用同一解析，避免两处正则漂移。 */
export function parseA3FromSetCookie(setCookie: string): string | null {
  return setCookie.match(/(?:^|[;,])\s*A3=([^;,\s]+)/)?.[1] ?? null;
}

const USER_AGENT = 'Mozilla/5.0';

const _CHART_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const _QUOTE_SUMMARY_BASE = 'https://query2.finance.yahoo.com/v10/finance/quoteSummary/';
const _GETCRUMB_URL = 'https://query2.finance.yahoo.com/v1/test/getcrumb';
const _FC_URL = 'https://fc.yahoo.com';
/** Yahoo 链单次请求超时(ms):40s < 代理 504 定时器 45s(YAHOO_COLLECT_TIMEOUT_MS,
 *  app/lib/proxies.cjs)→ 采集链任何单次请求最迟 40s 内 settle,代理锁必在
 *  有限时间释放(429 窗口有界;B1)。deviceYahooCollect 的裸 fetch 共用此常量
 *  (经 fetchWithTimeout 缺省参数),单一来源。 */
export const YAHOO_REQUEST_TIMEOUT_MS = 40_000;

/** fetch + 超时(Hermes 兼容:AbortController 全局存在——app/lib/polyfill.ts
 *  已为 AbortSignal 补 throwIfAborted,证明其存在;AbortSignal.timeout 静态
 *  API 在 Hermes 未打补丁、不可靠 → 手写 setTimeout + controller.abort(),
 *  零新增 polyfill/依赖)。超时 abort → YahooApiError(code='timeout',
 *  status_code=null)——与其他网络异常同族(status_code=null),但 code 可辨;
 *  其余异常原样抛出,由调用方归一化(_request/fetchChartWindow)。 */
export async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit = {},
  timeoutMs: number = YAHOO_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (exc) {
    if (controller.signal.aborted) {
      throw new YahooApiError('timeout', null, `Yahoo 请求超时(${timeoutMs / 1000}s)`);
    }
    throw exc;
  } finally {
    clearTimeout(timer);
  }
}

export interface ChartOptions {
  /** 日K窗口；缺省 'max'（全量）。 */
  range?: string;
  /** bar 粒度；缺省 '1d'。 */
  interval?: string;
  /** 事件类型（逗号分隔）；缺省 'div,split'（分红/拆股）。 */
  events?: string;
}

/** 尽力从非 2xx 响应 body 提取 error.code（chart/finance 壳 + 顶层 error
 *  三种形态，research 实测 chart 错误壳为 {"chart":{"error":…}}）。 */
function extractErrorCode(body: unknown): string | null {
  if (body === null || typeof body !== 'object') return null;
  const rec = body as Record<string, unknown>;
  for (const shellKey of ['chart', 'finance']) {
    const shell = rec[shellKey];
    if (shell !== null && typeof shell === 'object') {
      const err = (shell as Record<string, unknown>)['error'];
      if (err !== null && typeof err === 'object') {
        const code = (err as Record<string, unknown>)['code'];
        if (typeof code === 'string' && code !== '') return code;
      }
    }
  }
  const topErr = rec['error'];
  if (topErr !== null && typeof topErr === 'object') {
    const code = (topErr as Record<string, unknown>)['code'];
    if (typeof code === 'string' && code !== '') return code;
  }
  return null;
}

export class YahooClient {
  private readonly _fetch: typeof fetch;
  private readonly _cookieProvider: (() => string | null) | null;
  private _crumb: string | null = null;
  private _a3: string | null = null;

  /** @param fetchImpl 测试注入点（house style 无 mock 框架）；缺省全局 fetch
   *  @param cookieProvider S3 RN 路径注入：非空时其返回值直接作 A3 cookie
   *    值（免 fc.yahoo.com 网络请求）；返回 null/空 → 回退 Set-Cookie 解析 */
  constructor(fetchImpl?: typeof fetch, cookieProvider?: () => string | null) {
    this._fetch = fetchImpl ?? globalThis.fetch;
    this._cookieProvider = cookieProvider ?? null;
  }

  /** 全量日K（复权）+ meta + 分红/拆股事件。免 crumb。
   *  无效符号不抛（HTTP 200 + {"chart":{"error":…}}，调用方判定）。
   * @return 解析后原始 JSON（结构见 research/yahoo-api-verified.md）
   * @throws YahooApiError 网络异常/HTTP 非 2xx（不重试，调用方降级） */
  async chart(symbol: string, opts: ChartOptions = {}): Promise<unknown> {
    const url =
      `${_CHART_BASE}${encodeURIComponent(symbol)}` +
      `?range=${encodeURIComponent(opts.range ?? 'max')}` +
      `&interval=${encodeURIComponent(opts.interval ?? '1d')}` +
      `&events=${encodeURIComponent(opts.events ?? 'div,split')}`;
    const resp = await this._request(url);
    if (!resp.ok) throw await this._errorFrom(resp, 'chart');
    return this._json(resp, 'chart');
  }

  /** 概览/财报模块查询（price/summaryDetail/defaultKeyStatistics/
   *  incomeStatementHistoryQuarterly 等，逗号分隔透传）。带 Cookie + crumb。
   *  crumb 失效可自愈一次：401 → 清缓存刷新 crumb 重试；仍败抛
   *  YahooApiError('crumb', 401, …)。
   * @return 解析后原始 JSON（结构见 research/yahoo-api-verified.md）
   * @throws YahooApiError 网络异常/HTTP 非 2xx/crumb 刷新后仍失败 */
  async quoteSummary(symbol: string, modules: string[]): Promise<unknown> {
    const url = (crumb: string) =>
      `${_QUOTE_SUMMARY_BASE}${encodeURIComponent(symbol)}` +
      `?modules=${modules.join(',')}&crumb=${encodeURIComponent(crumb)}`;
    const cookie = () => (this._a3 !== null ? `A3=${this._a3}` : undefined);

    let crumb = await this.ensureCrumb();
    let resp = await this._request(url(crumb), cookie());
    if (resp.status === 401) {
      // crumb 失效（A3/crumb 均可能过期）：清缓存 → 刷新 → 重试一次
      this._crumb = null;
      this._a3 = null;
      try {
        crumb = await this.ensureCrumb();
        resp = await this._request(url(crumb), cookie());
      } catch (exc) {
        const detail = exc instanceof Error ? exc.message : String(exc);
        throw new YahooApiError('crumb', 401, `Yahoo quoteSummary 刷新 crumb 后仍失败：${detail}`);
      }
      if (!resp.ok) {
        throw new YahooApiError('crumb', 401, `Yahoo quoteSummary 刷新 crumb 后仍失败：HTTP ${resp.status}`);
      }
    } else if (!resp.ok) {
      throw await this._errorFrom(resp, 'quoteSummary');
    }
    return this._json(resp, 'quoteSummary');
  }

  /** 取 crumb（实例缓存）。cookieProvider 注入 → 直接用其 A3 值（零网络）；
   *  否则 GET fc.yahoo.com 从 Set-Cookie 解析 A3=。A3 → GET
   *  v1/test/getcrumb（Cookie: A3=…）→ 文本 crumb。
   * @throws YahooApiError 链上任一环失败（网络异常 → status_code=null） */
  async ensureCrumb(): Promise<string> {
    if (this._crumb !== null) return this._crumb;
    const a3 = await this._obtainA3();
    const resp = await this._request(_GETCRUMB_URL, `A3=${a3}`);
    if (!resp.ok) throw await this._errorFrom(resp, 'getcrumb');
    let text: string;
    try {
      text = (await resp.text()).trim();
    } catch (exc) {
      const detail = exc instanceof Error ? exc.message : String(exc);
      throw new YahooApiError('crumb', resp.status, `Yahoo getcrumb 响应读取失败：${detail}`);
    }
    if (!text) throw new YahooApiError('crumb', resp.status, 'Yahoo getcrumb 返回空');
    this._crumb = text;
    this._a3 = a3;
    return text;
  }

  private async _obtainA3(): Promise<string> {
    if (this._cookieProvider) {
      const v = this._cookieProvider();
      if (v !== null && v !== '') return v;
    }
    const resp = await this._request(_FC_URL);
    if (!resp.ok) throw await this._errorFrom(resp, 'fc.yahoo.com');
    // Set-Cookie 可能是多 cookie 逗号拼接（undici get('set-cookie')），
    // 起始/分号/逗号后均可出现 A3=（解析单源见 parseA3FromSetCookie）
    const a3 = parseA3FromSetCookie(resp.headers.get('set-cookie') ?? '');
    if (a3 === null) throw new YahooApiError('crumb', resp.status, 'Yahoo fc.yahoo.com 未返回 A3 cookie');
    return a3;
  }

  /** GET + UA 头；网络异常归一化（不重试）；带超时（AbortController,40s）。
   *  超时 → YahooApiError('timeout')（fetchWithTimeout 归一,原样透传）。 */
  private async _request(url: string, cookie?: string): Promise<Response> {
    const headers: Record<string, string> = { 'User-Agent': USER_AGENT };
    if (cookie) headers['Cookie'] = cookie;
    let resp: Response;
    try {
      resp = await fetchWithTimeout(this._fetch, url, { headers });
    } catch (exc) {
      if (exc instanceof YahooApiError) throw exc; // 归一化错误(超时)原样透传
      const detail = exc instanceof Error ? exc.message : String(exc);
      throw new YahooApiError(null, null, `Yahoo 请求失败：${detail}`);
    }
    return resp;
  }

  /** 非 2xx → YahooApiError：尽力取 body 的 error.code，取不到 → code null。 */
  private async _errorFrom(resp: Response, what: string): Promise<YahooApiError> {
    let code: string | null = null;
    try {
      const body: unknown = await resp.json();
      code = extractErrorCode(body);
    } catch {
      // 非 JSON body → code null
    }
    const suffix = code !== null ? `（${code}）` : '';
    return new YahooApiError(code, resp.status, `Yahoo ${what} 错误：HTTP ${resp.status}${suffix}`);
  }

  /** 解析响应 JSON；非 JSON body → YahooApiError（status_code=resp.status）。 */
  private async _json(resp: Response, what: string): Promise<unknown> {
    try {
      const body: unknown = await resp.json();
      return body;
    } catch (exc) {
      const detail = exc instanceof Error ? exc.message : String(exc);
      throw new YahooApiError(null, resp.status, `Yahoo ${what} 响应非 JSON：${detail}`);
    }
  }
}
