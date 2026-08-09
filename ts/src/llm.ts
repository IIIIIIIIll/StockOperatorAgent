// LLM 工厂 —— 移植自 Python core/llms/llm_factory.py
// 三键必填强校验（缺任一构造即抛错）+ base_url http(s) 前缀校验；
// 可选 LLM_REASONING_EFFORT。seed 对齐 Python 114514。
import { ChatOpenAI } from '@langchain/openai';

const REQUIRED = ['LLM_API_KEY', 'LLM_MODEL', 'LLM_BASE_URL'] as const;

export class MissingLlmConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissingLlmConfigError';
  }
}

export interface LlmConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  reasoningEffort?: string;
}

/** 读环境变量 → 配置；缺键/坏 base_url → MissingLlmConfigError（消息点名缺失键）。 */
export function readLlmEnv(env: Record<string, string | undefined> = process.env): LlmConfig {
  const missing = REQUIRED.filter((name) => !(env[name] ?? '').trim());
  if (missing.length) {
    throw new MissingLlmConfigError(
      `缺少 LLM 配置：${missing.join(' / ')}（详见 .env.example）`,
    );
  }
  const baseUrl = (env.LLM_BASE_URL as string).trim();
  if (!/^https?:\/\//.test(baseUrl)) {
    throw new MissingLlmConfigError('LLM_BASE_URL 必须以 http:// 或 https:// 开头');
  }
  const cfg: LlmConfig = {
    apiKey: (env.LLM_API_KEY as string).trim(),
    model: (env.LLM_MODEL as string).trim(),
    baseUrl,
  };
  const effort = (env.LLM_REASONING_EFFORT ?? '').trim();
  if (effort) cfg.reasoningEffort = effort;
  return cfg;
}

/** 构造 OpenAI 兼容 LLM（全库唯一 ChatOpenAI 构造点，对齐 Python make_llm）。
 *  proxyBase：浏览器同源代理前缀(如 '/llm-proxy/v1')——baseURL 指向代理,
 *  真实端点经 X-LLM-Base 头透传(绕开 CORS;Node/真机不传则直连)。 */
export function createLlm(cfg: LlmConfig, opts?: { proxyBase?: string }): ChatOpenAI {
  const viaProxy = !!opts?.proxyBase;
  return new ChatOpenAI({
    model: cfg.model,
    apiKey: cfg.apiKey,
    configuration: {
      baseURL: viaProxy ? opts.proxyBase : cfg.baseUrl,
      ...(viaProxy ? { defaultHeaders: { 'X-LLM-Base': cfg.baseUrl } } : {}),
    },
    // Python 侧 seed=114514 为供应商兼容参数;JS ChatOpenAIFields 无 seed,
    // 经 modelKwargs 透传 OpenAISDK 自定义字段
    modelKwargs: { seed: 114514 },
    ...(cfg.reasoningEffort ? { reasoningEffort: cfg.reasoningEffort } : {}),
  });
}

/** make_llm 等价：读 env → createLlm。 */
export function makeLlm(env: Record<string, string | undefined> = process.env): ChatOpenAI {
  return createLlm(readLlmEnv(env));
}
