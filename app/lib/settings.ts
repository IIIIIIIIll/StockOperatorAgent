// 设置状态 —— 对齐 Python display.py 四节(模型密钥/LangSmith/能力开关/调用上限)
// 持久化 settingsStore(web:localStorage;RN:expo-file-system 沙盒文件);
// 开关在分析前应用到 process.env(DISABLED 语义,
// 消费点 committee.envDisabledBool / webSearchEnabled 同判定)。
import { createLlm, type LlmConfig } from '../../src/llm.ts';
import * as settingsStore from './settingsStore.ts';
import { info, warn, error as logError } from '../../src/log.ts';
import { BILLIONS_DEFAULT_MAX } from '../../src/billionsTools.ts';

export interface SwitchState {
  tdxMcp: boolean; // TDX MCP(实时市场情报)
  webSearch: boolean; // 联网搜索
  billionsMaster: boolean; // 亿信总闸
  findb: boolean; // 金融问数
  search: boolean; // 搜索
  twitter: boolean; // 社交平台
  fetch: boolean; // 数据抓取
  analyst: boolean; // 信息面分析师
}

export interface CapsState {
  searchMax: number; // 默认 3
  twitterMax: number; // 默认 2
  fetchMax: number; // 默认 3
}

export interface KeysState {
  llmApiKey: string;
  llmModel: string;
  llmBaseUrl: string;
  tdxApiKey: string;
  billionsApiKey: string;
  langsmithKey: string;
  langsmithProject: string;
  langsmithTracing: boolean;
}

export interface SettingsState {
  switches: SwitchState;
  caps: CapsState;
  keys: KeysState;
}

const DEFAULT_SWITCHES: SwitchState = {
  tdxMcp: true, webSearch: true, billionsMaster: true,
  findb: true, search: true, twitter: true, fetch: true, analyst: true,
};

// caps 默认值单一来源 = billionsTools.BILLIONS_DEFAULT_MAX（UI 面板默认与
// env/内部兜底同一份；换默认只改 src/billionsTools.ts 一处）。
const DEFAULT_CAPS: CapsState = {
  searchMax: BILLIONS_DEFAULT_MAX.SEARCH,
  twitterMax: BILLIONS_DEFAULT_MAX.TWITTER,
  fetchMax: BILLIONS_DEFAULT_MAX.FETCH,
};

const DEFAULT_KEYS: KeysState = {
  llmApiKey: '', llmModel: '', llmBaseUrl: '',
  tdxApiKey: '', billionsApiKey: '',
  langsmithKey: '', langsmithProject: '', langsmithTracing: false,
};

export function defaultSettings(): SettingsState {
  return { switches: { ...DEFAULT_SWITCHES }, caps: { ...DEFAULT_CAPS }, keys: { ...DEFAULT_KEYS } };
}

export function loadSettings(): SettingsState {
  const d = defaultSettings();
  let loaded = d;
  try {
    const raw = settingsStore.load();
    if (raw) {
      const p = JSON.parse(raw) as Partial<SettingsState>;
      loaded = {
        switches: { ...d.switches, ...(p.switches ?? {}) },
        caps: { ...d.caps, ...(p.caps ?? {}) },
        keys: { ...d.keys, ...(p.keys ?? {}) },
      };
    }
  } catch {
    /* 损坏的存储 → 默认值 */
  }
  // 环境变量兜底:EXPO_PUBLIC_LLM_* 由 Expo 注入(浏览器/构建时),
  // 面板未保存的键从 env 补齐——对齐 Python 读 .env 的配置语义。
  // 注意:必须**直接** process.env.EXPO_PUBLIC_LLM_* 成员访问——babel-preset-expo
  // 只在 release 构建时静态内联直接访问,别名读取(如 const env = process.env)
  // 逃逸内联,release 运行时 process.env 无该键 → 三键缺失(2026-08-15 实测)。
  const k = loaded.keys;
  if (!k.llmApiKey && process.env.EXPO_PUBLIC_LLM_API_KEY) k.llmApiKey = process.env.EXPO_PUBLIC_LLM_API_KEY;
  if (!k.llmModel && process.env.EXPO_PUBLIC_LLM_MODEL) k.llmModel = process.env.EXPO_PUBLIC_LLM_MODEL;
  if (!k.llmBaseUrl && process.env.EXPO_PUBLIC_LLM_BASE_URL) k.llmBaseUrl = process.env.EXPO_PUBLIC_LLM_BASE_URL;
  return loaded;
}

/** 三键状态摘要(日志用):掩码展示已配置值,点名缺失键。 */
export function describeLlmKeys(keys: KeysState): string {
  const mask = (v: string): string => (v.length > 8 ? `${v.slice(0, 4)}…${v.slice(-4)}` : v);
  const parts = [
    `LLM_API_KEY=${keys.llmApiKey ? `${mask(keys.llmApiKey)} ✓` : '✗ 缺失'}`,
    `LLM_MODEL=${keys.llmModel ? `${keys.llmModel} ✓` : '✗ 缺失'}`,
    `LLM_BASE_URL=${keys.llmBaseUrl ? `${keys.llmBaseUrl} ✓` : '✗ 缺失'}`,
  ];
  return parts.join(', ');
}

export function saveSettings(s: SettingsState): void {
  settingsStore.save(JSON.stringify(s));
}

/** DISABLED 语义应用:开 → 值 '0'(不禁用),关 → '1'。消费点 committee.ts。 */
export function applySwitchesToEnv(switches: SwitchState): void {
  const set = (name: string, enabled: boolean): void => {
    if (enabled) delete process.env[name];
    else process.env[name] = '1';
  };
  set('TDX_MCP_DISABLED', switches.tdxMcp);
  set('WEB_SEARCH_DISABLED', switches.webSearch);
  set('BILLIONS_DISABLED', switches.billionsMaster);
  set('BILLIONS_FINDB_DISABLED', switches.findb);
  set('BILLIONS_SEARCH_DISABLED', switches.search);
  set('BILLIONS_TWITTER_DISABLED', switches.twitter);
  set('BILLIONS_FETCH_DISABLED', switches.fetch);
  set('BILLIONS_ANALYST_DISABLED', switches.analyst);
}

/** LLM 三键齐 → 真 LLM;缺 → 演示 stub(门控对齐 Python _llm_configured)。 */
export function llmConfigured(keys: KeysState): boolean {
  return !!(keys.llmApiKey.trim() && keys.llmModel.trim() && keys.llmBaseUrl.trim());
}

export function toLlmConfig(keys: KeysState): LlmConfig {
  return { apiKey: keys.llmApiKey.trim(), model: keys.llmModel.trim(), baseUrl: keys.llmBaseUrl.trim() };
}

/** 与 Python 门控文案同语义:缺键点名。 */
export function missingLlmKeys(keys: KeysState): string[] {
  const missing: string[] = [];
  if (!keys.llmApiKey.trim()) missing.push('LLM_API_KEY');
  if (!keys.llmModel.trim()) missing.push('LLM_MODEL');
  if (!keys.llmBaseUrl.trim()) missing.push('LLM_BASE_URL');
  return missing;
}

export interface ReachabilityResult {
  ok: boolean;
  latencyMs: number;
  message: string;
}

/** LLM 可达性监测:GET {baseUrl}/models(OpenAI 兼容,最轻量验证端点+认证)。
 *  浏览器 CORS 限制下 fetch 可能失败——按错误消息如实展示。 */
export async function checkLlmReachability(keys: KeysState): Promise<ReachabilityResult> {
  const base = keys.llmBaseUrl.trim().replace(/\/+$/, '');
  if (!base || !keys.llmApiKey.trim() || !keys.llmModel.trim()) {
    warn(`LLM 可达性检测跳过:三键不齐`);
    return { ok: false, latencyMs: 0, message: '三键不齐,无法检测' };
  }
  let host = base;
  try {
    host = new URL(base).host;
  } catch {
    /* 保留原文 */
  }
  info(`LLM 可达性检测(同源代理提问):${host} model=${keys.llmModel}`);
  const t0 = Date.now();
  const payload = {
    base,
    model: keys.llmModel.trim(),
    messages: [{ role: 'user', content: 'ping' }],
    max_tokens: 64, // reasoning 模型会消耗部分预算(max_tokens 16 实测回复为空)
  };
  // 1) 同源代理优先(dev server / server.mjs 都有 /llm-proxy)——绕开浏览器
  //    CORS,拿到真实服务端响应;代理本身不可用(纯静态 server)再回退直连
  let proxyUsed = false;
  try {
    const viaProxy = await fetch('/llm-proxy/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${keys.llmApiKey.trim()}` },
      body: JSON.stringify(payload),
    });
    if (viaProxy.status !== 502 && viaProxy.status !== 404) {
      proxyUsed = true;
      return await classifyChatResponse(viaProxy, host, keys, Date.now() - t0);
    }
    warn(`LLM 代理不可用(HTTP ${viaProxy.status})——回退浏览器直连`);
  } catch {
    warn('LLM 代理不可达——回退浏览器直连');
  }
  try {
    const resp = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${keys.llmApiKey.trim()}` },
      body: JSON.stringify(payload),
    });
    return await classifyChatResponse(resp, host, keys, Date.now() - t0);
  } catch (err) {
    const ms = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);
    logError(`LLM 不可达:${host}(${ms}ms)——${msg}`);
    return {
      ok: false,
      latencyMs: ms,
      message: msg.includes('fetch')
        ? `浏览器跨域被拒(CORS)——本环境无 /llm-proxy 代理(请用 npx expo start 或 node server.mjs 启动)。`
          + 'Node/真机 App 无此限制(`npm run probe` 可直连验证)'
        : msg,
    };
  }
}

/** chat 响应分类:成功解析回复内容展示;失败按状态码给原因。 */
async function classifyChatResponse(
  resp: Response,
  host: string,
  keys: KeysState,
  ms: number,
): Promise<ReachabilityResult> {
  const text = await resp.text();
  if (resp.ok) {
    try {
      const data = JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }> };
      const reply = (data.choices?.[0]?.message?.content ?? '').trim();
      info(`LLM 可达且真实回复:${host} ${ms}ms 回复「${reply.slice(0, 40)}」`);
      return { ok: true, latencyMs: ms, message: `${ms}ms,回复:「${reply.slice(0, 60) || '(空)'}」` };
    } catch {
      info(`LLM 可达:${host} ${ms}ms(响应非 JSON)`);
      return { ok: true, latencyMs: ms, message: `${ms}ms` };
    }
  }
  if (resp.status === 401 || resp.status === 403) {
    logError(`LLM 可达但认证失败:${host} HTTP ${resp.status}(${ms}ms)——检查 API Key`);
    return { ok: false, latencyMs: ms, message: `认证失败(HTTP ${resp.status})——检查 API Key` };
  }
  if (resp.status === 404) {
    logError(`LLM 提问 404:${host}(${ms}ms)——Base URL 缺 /v1 或模型名 ${keys.llmModel} 不存在`);
    return { ok: false, latencyMs: ms, message: `端点/模型不存在(404)——检查 Base URL 是否含 /v1 或模型名是否正确` };
  }
  if (resp.status === 429) {
    logError(`LLM 限流:${host} HTTP 429(${ms}ms)`);
    return { ok: false, latencyMs: ms, message: `限流(HTTP 429)——稍后重试` };
  }
  logError(`LLM 提问 HTTP ${resp.status}:${host}(${ms}ms)${text.slice(0, 120)}`);
  return { ok: false, latencyMs: ms, message: `HTTP ${resp.status}:${text.slice(0, 80)}` };
}

export { createLlm };
