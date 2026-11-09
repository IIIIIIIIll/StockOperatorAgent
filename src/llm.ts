// LLM 工厂 —— 移植自 Python core/llms/llm_factory.py
// 三键必填强校验（缺任一构造即抛错）+ base_url http(s) 前缀校验；
// 可选 LLM_REASONING_EFFORT。seed 对齐 Python 114514。
import { ChatOpenAI } from '@langchain/openai';
import { envValue } from './env.ts';

const REQUIRED = ['LLM_API_KEY', 'LLM_MODEL', 'LLM_BASE_URL'] as const;
const LLM_ENV_KEYS = ['LLM_API_KEY', 'LLM_MODEL', 'LLM_BASE_URL', 'LLM_REASONING_EFFORT'] as const;

/** 缺省 env 来源（envValue 逐键读取,typeof process 守卫单点）——优先级:
 *  构造注入 env > envValue > 默认。 */
function defaultLlmEnv(): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const k of LLM_ENV_KEYS) out[k] = envValue(k);
  return out;
}

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

/** 读环境变量 → 配置；缺键/坏 base_url → MissingLlmConfigError（消息点名缺失键）。
 *  env 注入优先（测试）；缺省 → envValue 逐键读取（env.ts 单点）。 */
export function readLlmEnv(env?: Record<string, string | undefined>): LlmConfig {
  const e = env ?? defaultLlmEnv();
  const missing = REQUIRED.filter((name) => !(e[name] ?? '').trim());
  if (missing.length) {
    throw new MissingLlmConfigError(
      `缺少 LLM 配置：${missing.join(' / ')}（详见 .env.example）`,
    );
  }
  const baseUrl = (e.LLM_BASE_URL as string).trim();
  if (!/^https?:\/\//.test(baseUrl)) {
    throw new MissingLlmConfigError('LLM_BASE_URL 必须以 http:// 或 https:// 开头');
  }
  const cfg: LlmConfig = {
    apiKey: (e.LLM_API_KEY as string).trim(),
    model: (e.LLM_MODEL as string).trim(),
    baseUrl,
  };
  const effort = (e.LLM_REASONING_EFFORT ?? '').trim();
  if (effort) cfg.reasoningEffort = effort;
  return cfg;
}

/** 配置字符串净化:剥控制字符(含粘贴/输入法带入的 NUL `\u0000`)与首尾空白。
 *  实测(2026-11-04,安卓模拟器):Base URL 尾部夹一个 NUL → 键/路径/模型都对,
 *  但 undici(web/Node) 回 400、OkHttp(RN) 回 404,表面看像「路径或模型不存在」，
 *  用户无从自行诊断。三键共用这一道净化(键/模型/URL 同一来源、同一风险)。 */
export function sanitizeLlmValue(v: string): string {
  return v.replace(/[\u0000-\u001F\u007F]/g, '').trim();
}

/** 构造 OpenAI 兼容 LLM(全库唯一 ChatOpenAI 构造点,对齐 Python make_llm)。
 *  proxyBase:浏览器同源代理前缀(如 '/llm-proxy/v1')——baseURL 指向代理,
 *  真实端点经 X-LLM-Base 头透传(绕开 CORS;Node/真机不传则直连)。 */
export function createLlm(cfg: LlmConfig, opts?: { proxyBase?: string }): ChatOpenAI {
  // 直接调用方(非设置面板)也吃同一道净化:配置里夹控制字符不得逃进请求 URL
  const model = sanitizeLlmValue(cfg.model);
  const apiKey = sanitizeLlmValue(cfg.apiKey);
  const baseUrl = sanitizeLlmValue(cfg.baseUrl);
  const viaProxy = !!opts?.proxyBase;
  // S6:远程模式(server HOST=0.0.0.0 非回环)要求 X-SOA-Token == SOA_ACCESS_TOKEN。
  // 直接成员访问(EXPO_PUBLIC_* 内联契约,architecture 契约 6 豁免);未设 → 不带头。
  const soaToken = process.env.EXPO_PUBLIC_SOA_ACCESS_TOKEN;
  return new ChatOpenAI({
    model,
    apiKey,
    // 2026-11-09 巡检 P1-2:AsyncCaller 默认 maxRetries=6,叠上 retry.ts 的 3 次
    // → 单节点最坏 21 次请求,且内层重发完整 prompt、对外完全不可见(无日志无
    // onRetry)。钉成 0 让 retry.ts 成为唯一重试权威(它带日志与 roleStatus)。
    maxRetries: 0,
    configuration: {
      baseURL: viaProxy ? opts.proxyBase : baseUrl,
      // 不设 timeout:基本面分析师长 prompt/长生成可达数分钟(Python 版
      // 同语义);超时会误杀正常生成
      ...(viaProxy
        ? {
            defaultHeaders: {
              'X-LLM-Base': baseUrl,
              ...(soaToken ? { 'X-SOA-Token': soaToken } : {}),
            },
          }
        : {}),
    },
    // Python 侧 seed=114514 为供应商兼容参数;JS ChatOpenAIFields 无 seed,
    // 经 modelKwargs 透传 OpenAISDK 自定义字段
    modelKwargs: { seed: 114514 },
    ...(cfg.reasoningEffort ? { reasoningEffort: cfg.reasoningEffort } : {}),
  });
}

/** make_llm 等价：读 env → createLlm。env 注入优先；缺省 → envValue 逐键。 */
export function makeLlm(env?: Record<string, string | undefined>): ChatOpenAI {
  return createLlm(readLlmEnv(env));
}
