// E6:loadSettings 的 EXPO_PUBLIC_LLM_* 环境兜底分支单元测试(app/lib/settings.ts
// 「环境变量兜底」段)。该分支此前零覆盖——settings-store.test.ts 只 delete 屏蔽
// 三键保证确定性,从未 SET 验证补齐语义。
// 模式对齐 settings-store.test.ts「settings.ts 经 settingsStore 路由(web 分支)」:
// stub window/document/localStorage 走真实分发链(isWebEnv 探针 → 单例 web 分支;
// 单例在模块求值时捕获后端,故必须先 stub 再动态 import),beforeEach 保存并清空
// 三键、afterEach 原样还原(本文件自建同款,不改既有文件)。NODE_ENV=test 下 log
// 文件禁写(src/log.ts fileWriteDisabled),不产生 logs/ 污染。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../app/lib/settings.ts';

const ENV_LLM_KEYS = ['EXPO_PUBLIC_LLM_API_KEY', 'EXPO_PUBLIC_LLM_MODEL', 'EXPO_PUBLIC_LLM_BASE_URL'] as const;

/** 测试注入的 env 值(非真实凭据;与面板保存值可区分即可)。 */
const ENV_VALUES: Record<(typeof ENV_LLM_KEYS)[number], string> = {
  EXPO_PUBLIC_LLM_API_KEY: 'env-key',
  EXPO_PUBLIC_LLM_MODEL: 'env-model',
  EXPO_PUBLIC_LLM_BASE_URL: 'https://env.example/v1',
};

function setAllEnv(): void {
  for (const k of ENV_LLM_KEYS) process.env[k] = ENV_VALUES[k];
}

describe('loadSettings EXPO_PUBLIC_LLM_* 环境兜底(web 环境真实分发链)', () => {
  let mem: Map<string, string>;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    mem = new Map<string, string>();
    savedEnv = {};
    // 确定性:先保存再屏蔽 EXPO_PUBLIC_LLM_*(用例内按需 SET,afterEach 还原)
    for (const k of ENV_LLM_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    // 模拟 web 环境:isWebEnv() 探针为真 → settingsStore 单例走 localStorage 分支
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', {});
    vi.stubGlobal('localStorage', {
      getItem: (k: string): string | null => mem.get(k) ?? null,
      setItem: (k: string, v: string): void => {
        mem.set(k, v);
      },
      removeItem: (k: string): void => {
        mem.delete(k);
      },
    });
    vi.resetModules();
  });

  afterEach(() => {
    for (const k of ENV_LLM_KEYS) {
      const v = savedEnv[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('面板未保存键 + env 三键齐 → 三键全部从 env 补齐', async () => {
    setAllEnv();
    const { loadSettings } = await import('../app/lib/settings.ts');
    const d = defaultSettings();
    expect(loadSettings()).toEqual({
      ...d,
      keys: { ...d.keys, llmApiKey: 'env-key', llmModel: 'env-model', llmBaseUrl: 'https://env.example/v1' },
    });
  });

  it('已保存键优先:面板存的 llmModel 不被 env 覆盖,仅空键补齐', async () => {
    setAllEnv();
    // 面板只存了 llmModel(部分 JSON,其余键经默认深合并后为空串)
    mem.set('soa:settings', JSON.stringify({ keys: { llmModel: 'panel-model' } }));
    const { loadSettings } = await import('../app/lib/settings.ts');
    const s = loadSettings();
    expect(s.keys.llmModel).toBe('panel-model'); // 已保存值胜出,env 同名不覆盖
    expect(s.keys.llmApiKey).toBe('env-key'); // 合并后为空的键才从 env 补齐
    expect(s.keys.llmBaseUrl).toBe('https://env.example/v1');
  });

  it('env 缺某键 → 该键留空(不误填)', async () => {
    process.env.EXPO_PUBLIC_LLM_MODEL = 'env-model'; // 仅 MODEL 有值
    const { loadSettings } = await import('../app/lib/settings.ts');
    const s = loadSettings();
    expect(s.keys.llmModel).toBe('env-model');
    expect(s.keys.llmApiKey).toBe(''); // env 无此键 → 保持空,不臆造
    expect(s.keys.llmBaseUrl).toBe('');
  });

  it('损坏存储 + env 有值 → catch 兜底后环境分支仍生效', async () => {
    mem.set('soa:settings', '{not-json'); // JSON.parse 抛出 → catch 走默认值
    setAllEnv();
    const { loadSettings } = await import('../app/lib/settings.ts');
    const d = defaultSettings();
    // 兜底分支位于 try/catch 之后:损坏存储不影响 env 补齐
    expect(loadSettings()).toEqual({
      ...d,
      keys: { ...d.keys, llmApiKey: 'env-key', llmModel: 'env-model', llmBaseUrl: 'https://env.example/v1' },
    });
  });
});
