// 设置状态 —— 对齐 Python display.py 四节(模型密钥/LangSmith/能力开关/调用上限)
// 持久化 localStorage;开关在分析前应用到 process.env(DISABLED 语义,
// 消费点 committee.envDisabledBool / webSearchEnabled 同判定)。
import { createLlm, type LlmConfig } from '../../src/llm.ts';
import { info, warn, error as logError } from './log.ts';

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

const DEFAULT_CAPS: CapsState = { searchMax: 3, twitterMax: 2, fetchMax: 3 };

const DEFAULT_KEYS: KeysState = {
  llmApiKey: '', llmModel: '', llmBaseUrl: '',
  tdxApiKey: '', billionsApiKey: '',
  langsmithKey: '', langsmithProject: '', langsmithTracing: false,
};

export function defaultSettings(): SettingsState {
  return { switches: { ...DEFAULT_SWITCHES }, caps: { ...DEFAULT_CAPS }, keys: { ...DEFAULT_KEYS } };
}

const KEY = 'soa:settings';

export function loadSettings(): SettingsState {
  const d = defaultSettings();
  let loaded = d;
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
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
  // 面板未保存的键从 env 补齐——对齐 Python 读 .env 的配置语义
  const env = process.env as Record<string, string | undefined>;
  const k = loaded.keys;
  if (!k.llmApiKey && env.EXPO_PUBLIC_LLM_API_KEY) k.llmApiKey = env.EXPO_PUBLIC_LLM_API_KEY;
  if (!k.llmModel && env.EXPO_PUBLIC_LLM_MODEL) k.llmModel = env.EXPO_PUBLIC_LLM_MODEL;
  if (!k.llmBaseUrl && env.EXPO_PUBLIC_LLM_BASE_URL) k.llmBaseUrl = env.EXPO_PUBLIC_LLM_BASE_URL;
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
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 非 web */
  }
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
  info(`LLM 可达性检测:${host}/models`);
  const t0 = Date.now();
  try {
    const resp = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${keys.llmApiKey.trim()}` },
    });
    const ms = Date.now() - t0;
    if (resp.ok) {
      info(`LLM 可达:${host} ${ms}ms`);
      return { ok: true, latencyMs: ms, message: `${ms}ms` };
    }
    if (resp.status === 401 || resp.status === 403) {
      logError(`LLM 可达但认证失败:${host} HTTP ${resp.status}(${ms}ms)——检查 API Key`);
      return { ok: false, latencyMs: ms, message: `认证失败(HTTP ${resp.status})——检查 API Key` };
    }
    if (resp.status === 404) {
      logError(`LLM 端点不存在:${host}/models HTTP 404(${ms}ms)——检查 Base URL 是否含 /v1`);
      return { ok: false, latencyMs: ms, message: `端点不存在(HTTP 404)——检查 Base URL 是否含 /v1` };
    }
    logError(`LLM 可达但 HTTP ${resp.status}:${host}(${ms}ms)`);
    return { ok: false, latencyMs: ms, message: `HTTP ${resp.status}` };
  } catch (err) {
    const ms = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);
    logError(`LLM 不可达:${host}(${ms}ms)——${msg}`);
    return {
      ok: false,
      latencyMs: ms,
      message: msg.includes('fetch')
        ? `网络/CORS 失败——浏览器跨域限制或端点不可达;可用 Node 验证:node -e "fetch('${base}/models',{headers:{Authorization:'Bearer <key>'}}).then(r=>console.log(r.status))"`
        : msg,
    };
  }
}

export { createLlm };
