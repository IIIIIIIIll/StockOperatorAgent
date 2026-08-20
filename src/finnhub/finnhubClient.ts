// Finnhub 薄包装（形态对齐 src/billionsClient.ts：class per source / method
// per endpoint / 构造注入 fetchImpl / 唯一自定义异常 / 不重试）。
//
// **港股不调用 Finnhub**：港股覆盖不可验证（docs.finnhub.io 本环境不可达，
// research/yahoo-api-verified.md 2026-08-19），本客户端仅服务美股增强
// （S5 设置面板 Finnhub API Key 可选）。
//
// 约定：
// - 无 key → companyProfile2 返回 null 且零网络（调用方按"无增强"降级）
// - 失败归一化 FinnhubApiError(code, status_code, message)：网络异常
//   （status_code=null）/ HTTP 非 2xx（429 配额不重试；code 取 body error）
// - 返回响应 JSON 原样（含 finnhubIndustry；字段提取由调用方做）
// 纯 TS + fetch-only：零 node: 导入（架构断言 #1），进 metro 图安全。

/** Finnhub API 调用失败（归一化错误，client 内唯一异常）。
 *
 * @param code 业务错误码（非 2xx body 的 error 文本；网络异常 → null）
 * @param status_code HTTP 状态码（网络异常无响应 → null）
 * @param message 人类可读错误信息
 */
export class FinnhubApiError extends Error {
  readonly code: string | null;
  readonly status_code: number | null;

  constructor(code: string | null, status_code: number | null, message: string) {
    super(message);
    this.name = 'FinnhubApiError';
    this.code = code;
    this.status_code = status_code;
  }
}

const _PROFILE2_BASE = 'https://finnhub.io/api/v1/stock/profile2';

export class FinnhubClient {
  private readonly _apiKey: string | null;
  private readonly _fetch: typeof fetch;

  /** @param apiKey 可为 null（未配置 → companyProfile2 零网络返回 null）
   *  @param fetchImpl 测试注入点（house style 无 mock 框架）；缺省全局 fetch */
  constructor(apiKey: string | null, fetchImpl?: typeof fetch) {
    this._apiKey = apiKey;
    this._fetch = fetchImpl ?? globalThis.fetch;
  }

  /** 公司画像（美股增强用；含 finnhubIndustry）。
   *  无 key → null（零网络，不抛）。
   * @throws FinnhubApiError 网络异常/HTTP 非 2xx（429 配额不重试，
   *   调用方降级） */
  async companyProfile2(symbol: string): Promise<unknown | null> {
    if (!this._apiKey) return null;
    const url =
      `${_PROFILE2_BASE}?symbol=${encodeURIComponent(symbol)}` +
      `&token=${encodeURIComponent(this._apiKey)}`;
    let resp: Response;
    try {
      resp = await this._fetch(url);
    } catch (exc) {
      const detail = exc instanceof Error ? exc.message : String(exc);
      throw new FinnhubApiError(null, null, `Finnhub 请求失败：${detail}`);
    }
    if (!resp.ok) {
      let code: string | null = null;
      try {
        const body: unknown = await resp.json();
        const error = body !== null && typeof body === 'object'
          ? (body as Record<string, unknown>)['error']
          : undefined;
        if (typeof error === 'string' && error !== '') code = error;
      } catch {
        // 非 JSON body → code null
      }
      const suffix = code !== null ? `（${code}）` : '';
      throw new FinnhubApiError(code, resp.status, `Finnhub API 错误：HTTP ${resp.status}${suffix}`);
    }
    try {
      const body: unknown = await resp.json();
      return body;
    } catch (exc) {
      const detail = exc instanceof Error ? exc.message : String(exc);
      throw new FinnhubApiError(null, resp.status, `Finnhub 响应非 JSON：${detail}`);
    }
  }
}
