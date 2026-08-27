import { describe, expect, it } from 'vitest';
import { createLlm, makeLlm, MissingLlmConfigError, readLlmEnv } from '../src/llm.ts';

const FULL = {
  LLM_API_KEY: 'k',
  LLM_MODEL: 'deepseek-v4-flash',
  LLM_BASE_URL: 'https://api.example.com/v1',
};

describe('llm factory (AC1)', () => {
  it('all three keys present → config parsed', () => {
    const cfg = readLlmEnv(FULL);
    expect(cfg).toEqual({ apiKey: 'k', model: 'deepseek-v4-flash', baseUrl: 'https://api.example.com/v1' });
  });

  it('each missing key named in error', () => {
    expect(() => readLlmEnv({})).toThrowError(MissingLlmConfigError);
    expect(() => readLlmEnv({})).toThrow('LLM_API_KEY / LLM_MODEL / LLM_BASE_URL');
    expect(() => readLlmEnv({ LLM_API_KEY: 'k', LLM_MODEL: 'm' })).toThrow('LLM_BASE_URL');
    expect(() => readLlmEnv({ LLM_API_KEY: 'k', LLM_BASE_URL: 'https://x' })).toThrow('LLM_MODEL');
  });

  it('blank value treated as missing', () => {
    expect(() => readLlmEnv({ ...FULL, LLM_API_KEY: '  ' })).toThrow('LLM_API_KEY');
  });

  it('non-http(s) base_url rejected', () => {
    expect(() => readLlmEnv({ ...FULL, LLM_BASE_URL: 'localhost:8080' })).toThrow('必须以 http:// 或 https:// 开头');
  });

  it('reasoning effort optional', () => {
    expect(readLlmEnv({ ...FULL, LLM_REASONING_EFFORT: 'high' }).reasoningEffort).toBe('high');
    expect(readLlmEnv(FULL).reasoningEffort).toBeUndefined();
  });

  it('makeLlm constructs ChatOpenAI without network call', () => {
    const llm = makeLlm(FULL);
    expect(llm.model).toBe('deepseek-v4-flash');
    expect(llm.apiKey).toBe('k');
    // baseURL 注入 configuration
    const config = (llm as unknown as { clientConfig: { baseURL?: string } }).clientConfig;
    expect(config.baseURL).toBe('https://api.example.com/v1');
  });

  it('createLlm accepts minimal config (validation lives in readLlmEnv, not constructor)', () => {
    expect(() => createLlm({ apiKey: '', model: 'm', baseUrl: 'https://x' })).not.toThrow();
  });

  it('S6:proxyBase + EXPO_PUBLIC_SOA_ACCESS_TOKEN 已设 → defaultHeaders 含 X-SOA-Token(X-LLM-Base 不变)', () => {
    const cfg = { apiKey: 'k', model: 'm', baseUrl: 'https://api.example.com/v1' };
    const old = process.env.EXPO_PUBLIC_SOA_ACCESS_TOKEN;
    try {
      process.env.EXPO_PUBLIC_SOA_ACCESS_TOKEN = 'sekrit';
      const llm = createLlm(cfg, { proxyBase: '/llm-proxy/v1' });
      const config = (llm as unknown as { clientConfig: { defaultHeaders?: Record<string, string> } }).clientConfig;
      expect(config.defaultHeaders).toEqual({
        'X-LLM-Base': 'https://api.example.com/v1',
        'X-SOA-Token': 'sekrit',
      });
    } finally {
      if (old === undefined) delete process.env.EXPO_PUBLIC_SOA_ACCESS_TOKEN;
      else process.env.EXPO_PUBLIC_SOA_ACCESS_TOKEN = old;
    }
    // 未设 token → 仅 X-LLM-Base(回环逐字节不变)
    const llm2 = createLlm(cfg, { proxyBase: '/llm-proxy/v1' });
    const config2 = (llm2 as unknown as { clientConfig: { defaultHeaders?: Record<string, string> } }).clientConfig;
    expect(config2.defaultHeaders).toEqual({ 'X-LLM-Base': 'https://api.example.com/v1' });
  });
});
