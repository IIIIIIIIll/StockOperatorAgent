// LLM 可达性响应的错误分类单测 —— 401/403 分流(代理拒绝 vs 上游认证失败)与
// 上游错误体透传。2026-11-04 实证:代理 SSRF 拒绝曾与 key 错误合流成
// 「认证失败 —— 检查 API Key」,用户无法区分「key 错」和「请求没发出去」。
import { describe, expect, it } from 'vitest';
import { classifyChatResponse } from '../app/lib/settings.ts';
import { defaultSettings, toLlmConfig, type KeysState } from '../app/lib/settings.ts';
import { sanitizeLlmValue } from '../src/llm.ts';

const KEYS: KeysState = { ...defaultSettings().keys, llmApiKey: 'sk-test', llmModel: 'deepseek-v4.1-flash', llmBaseUrl: 'https://ark.example.com/api/v3' };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
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
  it('代理自身策略拒绝(信封 error 为字符串)→ 标「代理拒绝」并带原文,不误导成 key 问题', async () => {
    const r = await classifyChatResponse(
      json(403, { error: 'LLM 代理目标被拒:仅允许公网 host(拒绝内网/环回地址)' }),
      'ark.example.com',
      KEYS,
      7,
    );
    expect(r.ok).toBe(false);
    expect(r.message).toContain('代理拒绝(HTTP 403)');
    expect(r.message).toContain('仅允许公网 host');
    expect(r.message).not.toContain('API Key');
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
