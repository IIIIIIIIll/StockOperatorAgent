// LLM 可达性响应的错误分类单测 —— 401/403 分流(代理拒绝 vs 上游认证失败)与
// 上游错误体透传。2026-11-04 实证:代理 SSRF 拒绝曾与 key 错误合流成
// 「认证失败 —— 检查 API Key」,用户无法区分「key 错」和「请求没发出去」。
import { describe, expect, it } from 'vitest';
import { checkLlmReachability, classifyChatResponse } from '../app/lib/settings.ts';
import { defaultSettings, toLlmConfig, type KeysState } from '../app/lib/settings.ts';
import { sanitizeLlmValue } from '../src/llm.ts';

const KEYS: KeysState = { ...defaultSettings().keys, llmApiKey: 'sk-test', llmModel: 'deepseek-v4.1-flash', llmBaseUrl: 'https://ark.example.com/api/v3' };

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('配置字符串净化(sanitizeLlmValue)', () => {
  it('剥 NUL/控制字符与首尾空白(安卓实测:Base URL 尾部 NUL → 400/404)', () => {
    expect(sanitizeLlmValue('https://ark.cn-beijing.volces.com/api/coding/v3\u0000')).toBe(
      'https://ark.cn-beijing.volces.com/api/coding/v3',
    );
    expect(sanitizeLlmValue('\u0000 sk-abc \u001F')).toBe('sk-abc');
    expect(sanitizeLlmValue('deepseek-v4.1-flash\u007F')).toBe('deepseek-v4.1-flash');
    // 正常值逐字节不变(不误伤 URL/模型名里的合法字符)
    expect(sanitizeLlmValue('https://ark.cn-beijing.volces.com/api/v3')).toBe(
      'https://ark.cn-beijing.volces.com/api/v3',
    );
  });

  it('toLlmConfig 输出已净化(面板里的脏值不得进请求)', () => {
    const cfg = toLlmConfig({ ...KEYS, llmBaseUrl: `${KEYS.llmBaseUrl}\u0000`, llmModel: ` ${KEYS.llmModel} ` });
    expect(cfg.baseUrl).toBe('https://ark.example.com/api/v3');
    expect(cfg.model).toBe('deepseek-v4.1-flash');
    expect(cfg.apiKey).toBe('sk-test');
  });
});

describe('classifyChatResponse · 401/403 分流', () => {
  it('代理自身策略拒绝(带 x-soa-proxy-reject 标记头)→ 标「代理拒绝」并带原文', async () => {
    const r = await classifyChatResponse(
      json(403, { error: 'LLM 代理目标被拒:仅允许公网 host(拒绝内网/环回地址)' }, { 'x-soa-proxy-reject': '1' }),
      'ark.example.com',
      KEYS,
      7,
    );
    expect(r.ok).toBe(false);
    expect(r.message).toContain('代理拒绝(HTTP 403)');
    expect(r.message).toContain('仅允许公网 host');
    expect(r.message).not.toContain('API Key');
  });

  // R-27:上游也用 {error:"..."} 形状 —— 只按形状判别会把上游认证失败误标成
  // 「代理拒绝」并丢掉「检查 API Key」提示。没有标记头就必须走认证失败分支。
  it('上游 401 + 字符串 error(无代理标记头)→ 仍标认证失败并保留 API Key 提示', async () => {
    const r = await classifyChatResponse(
      json(401, { error: 'Unauthorized' }),
      'ark.example.com',
      KEYS,
      31,
    );
    expect(r.ok).toBe(false);
    expect(r.message).toContain('认证失败(HTTP 401)');
    expect(r.message).toContain('检查 API Key');
    expect(r.message).not.toContain('代理拒绝');
  });

  it('上游认证失败(error 为对象)→ 带 code/message,保留「检查 API Key」指引', async () => {
    const r = await classifyChatResponse(
      json(401, {
        error: { code: 'AuthenticationError', message: 'The API key format is incorrect.', type: 'Unauthorized' },
      }),
      'ark.example.com',
      KEYS,
      72,
    );
    expect(r.ok).toBe(false);
    expect(r.message).toContain('认证失败(HTTP 401)');
    expect(r.message).toContain('AuthenticationError');
    expect(r.message).toContain('API key format is incorrect');
  });

  it('明文 403 响应 → 原文截断进消息(不吞掉上游提示)', async () => {
    const r = await classifyChatResponse(
      new Response('Forbidden by edge policy', { status: 403 }),
      'ark.example.com',
      KEYS,
      10,
    );
    expect(r.ok).toBe(false);
    expect(r.message).toContain('认证失败(HTTP 403)');
    expect(r.message).toContain('Forbidden by edge policy');
  });

  it('200 + choices → 成功且展示回复', async () => {
    const r = await classifyChatResponse(
      json(200, { choices: [{ message: { content: '  pong  ' } }] }),
      'ark.example.com',
      KEYS,
      88,
    );
    expect(r.ok).toBe(true);
    expect(r.message).toContain('pong');
  });
});

describe('checkLlmReachability · 请求头净化(R-04)', () => {
  // 脏值 = 粘贴带入的 NUL/控制字符 + 首尾空白(安卓实测 11-04:逐字节进 header →
  // undici/OkHttp 拒收,UI 却报「不可达/路径不存在」)。
  const dirty: KeysState = {
    ...KEYS,
    llmApiKey: '  sk-abc\u0000  ',
    llmModel: ' deepseek-v4.1-flash\u007F ',
    llmBaseUrl: `\u0000${KEYS.llmBaseUrl}\u0000`,
  };

  async function withFetch<T>(
    impl: (url: string, init?: RequestInit) => Promise<Response>,
    body: () => Promise<T>,
  ): Promise<T> {
    const orig = globalThis.fetch;
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => impl(String(url), init)) as unknown as typeof fetch;
    try {
      return await body();
    } finally {
      globalThis.fetch = orig;
    }
  }

  it('代理路径:Authorization 剥掉控制字符;base/model 同源净化', async () => {
    const seen: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    const r = await withFetch(
      async (url, init) => {
        seen.push({
          url,
          headers: (init?.headers ?? {}) as Record<string, string>,
          body: String(init?.body ?? ''),
        });
        return json(200, { choices: [{ message: { content: 'pong' } }] });
      },
      () => checkLlmReachability(dirty),
    );
    expect(r.ok).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0].headers.Authorization).toBe('Bearer sk-abc');
    // 整条请求(URL/头/体)不得残留 NUL 或 DEL
    expect(JSON.stringify(seen[0])).not.toMatch(/[\u0000\u007F]/);
    expect(JSON.parse(seen[0].body).model).toBe('deepseek-v4.1-flash');
    expect(JSON.parse(seen[0].body).base).toBe('https://ark.example.com/api/v3');
  });

  it('直连回退(代理非 JSON):第二个 Authorization 同样净化', async () => {
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    const r = await withFetch(
      async (url, init) => {
        seen.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
        if (seen.length === 1) {
          return new Response('<!doctype html><html></html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
          });
        }
        return json(200, { choices: [{ message: { content: 'pong' } }] });
      },
      () => checkLlmReachability(dirty),
    );
    expect(r.ok).toBe(true);
    expect(seen).toHaveLength(2);
    expect(seen[1].url).toBe('https://ark.example.com/api/v3/chat/completions');
    expect(seen[1].headers.Authorization).toBe('Bearer sk-abc');
  });
});
