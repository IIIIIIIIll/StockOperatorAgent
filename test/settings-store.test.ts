// settingsStore(平台分发 KV)与 settings.ts(JSON merge/默认)单元测试。
// settingsStore 本身不解析 JSON(字符串面);注入 fake localStorage / fake
// expo-file-system File 验证 web/RN 两分支(同 log.test.ts 的 makeReporter /
// store-file.test.ts 的 adapter 注入先例);settings.ts 路由测试用 stubGlobal
// 模拟 web 环境走真实分发链(同 store-gates.test.ts 的 stubGlobal 先例)。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSettingsStore,
  type RnFileSystem,
  type SettingsStorageLike,
} from '../app/lib/settingsStore.ts';
import { defaultSettings } from '../app/lib/settings.ts';

// ─── fake 后端 ─────────────────────────────────────────────────────────────

/** fake localStorage(内存 Map;形状对齐 SettingsStorageLike)。 */
function makeFakeLs(): { ls: SettingsStorageLike; mem: Map<string, string> } {
  const mem = new Map<string, string>();
  return {
    ls: {
      getItem: (k: string): string | null => mem.get(k) ?? null,
      setItem: (k: string, v: string): void => {
        mem.set(k, v);
      },
    },
    mem,
  };
}

/** fake expo-file-system(内存 Map 文件;textSync 对缺失文件抛错,同真实语义)。 */
function makeFakeFs(): { fs: RnFileSystem; files: Map<string, string> } {
  const files = new Map<string, string>();
  class FakeFile {
    readonly path: string;
    constructor(...uris: unknown[]) {
      this.path = uris.map(String).join('/');
    }
    get exists(): boolean {
      return files.has(this.path);
    }
    create(): void {
      files.set(this.path, '');
    }
    write(contents: string): void {
      files.set(this.path, contents);
    }
    textSync(): string {
      if (!files.has(this.path)) throw new Error(`missing file: ${this.path}`);
      return files.get(this.path) as string;
    }
  }
  return { fs: { File: FakeFile, Paths: { document: '/doc' } }, files };
}

// ─── settingsStore:web 分支 ────────────────────────────────────────────────

describe('settingsStore web 分支(注入 fake localStorage)', () => {
  it('往返:save → load 原样返回,键名 soa:settings', () => {
    const { ls, mem } = makeFakeLs();
    const store = createSettingsStore(ls);
    expect(store.load()).toBeNull();
    store.save('{"a":1}');
    expect(store.load()).toBe('{"a":1}');
    expect(mem.get('soa:settings')).toBe('{"a":1}');
  });

  it('getItem 抛错 → load 返回 null;setItem 抛错 → save 不抛出', () => {
    const throwing: SettingsStorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    const store = createSettingsStore(throwing);
    expect(store.load()).toBeNull();
    expect(() => store.save('x')).not.toThrow();
  });
});

// ─── settingsStore:RN 分支 ─────────────────────────────────────────────────

describe('settingsStore RN 分支(注入 fake expo-file-system)', () => {
  it('缺失文件 → null;往返:textSync 返回已存串,落盘 soa-settings.json', () => {
    const { fs, files } = makeFakeFs();
    const store = createSettingsStore(null, fs);
    expect(store.load()).toBeNull(); // 文件不存在(exists=false → 不调 textSync)
    store.save('{"b":2}');
    expect(store.load()).toBe('{"b":2}');
    expect(files.has('/doc/soa-settings.json')).toBe(true);
  });

  it('textSync 抛错 → load 返回 null;write 抛错 → save 不抛出', () => {
    const broken: RnFileSystem = {
      File: class {
        exists = true;
        create(): void {}
        write(): void {
          throw new Error('disk full');
        }
        textSync(): string {
          throw new Error('io error');
        }
      },
      Paths: { document: '/doc' },
    };
    const store = createSettingsStore(null, broken);
    expect(store.load()).toBeNull();
    expect(() => store.save('x')).not.toThrow();
  });

  it('存储内容为损坏 JSON 字符串 → load 原样返回(存储层透明,不解析不抛出)', () => {
    const { fs } = makeFakeFs();
    const store = createSettingsStore(null, fs);
    store.save('{not-json'); // 写坏串
    expect(store.load()).toBe('{not-json'); // JSON 解析/兜底在 settings.ts 层
  });
});

// ─── settings.ts 经 settingsStore 路由(web 环境真实分发链)──────────────────

const ENV_LLM_KEYS = ['EXPO_PUBLIC_LLM_API_KEY', 'EXPO_PUBLIC_LLM_MODEL', 'EXPO_PUBLIC_LLM_BASE_URL'] as const;

describe('settings.ts 经 settingsStore 路由(web 分支)', () => {
  let mem: Map<string, string>;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    mem = new Map<string, string>();
    savedEnv = {};
    // 确定性:屏蔽 EXPO_PUBLIC_LLM_* 环境兜底(loadSettings 会读 process.env)
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

  it('无存储 → 默认值', async () => {
    const { loadSettings } = await import('../app/lib/settings.ts');
    expect(loadSettings()).toEqual(defaultSettings());
  });

  it('损坏 JSON → 默认值(不抛出)', async () => {
    mem.set('soa:settings', '{not-json');
    const { loadSettings } = await import('../app/lib/settings.ts');
    expect(loadSettings()).toEqual(defaultSettings());
  });

  it('部分设置 → 与默认深合并(未存字段保持默认)', async () => {
    mem.set('soa:settings', JSON.stringify({ switches: { webSearch: false }, caps: { searchMax: 5 } }));
    const { loadSettings } = await import('../app/lib/settings.ts');
    const s = loadSettings();
    expect(s.switches.webSearch).toBe(false);
    expect(s.switches.tdxMcp).toBe(true); // 未存开关保持默认
    expect(s.caps.searchMax).toBe(5);
    expect(s.caps.twitterMax).toBe(2); // 未存上限保持默认
    expect(s.keys.tdxApiKey).toBe(''); // 未存键保持默认
  });

  it('saveSettings → loadSettings 往返(经 settingsStore 落盘)', async () => {
    const { loadSettings, saveSettings } = await import('../app/lib/settings.ts');
    const d = defaultSettings();
    const saved: typeof d = {
      switches: { ...d.switches, webSearch: false },
      caps: { ...d.caps, fetchMax: 7 },
      keys: { ...d.keys, llmModel: 'gpt-x' },
    };
    saveSettings(saved);
    expect(mem.get('soa:settings')).toBe(JSON.stringify(saved));
    const s = loadSettings();
    expect(s.switches.webSearch).toBe(false);
    expect(s.switches.tdxMcp).toBe(true);
    expect(s.caps.fetchMax).toBe(7);
    expect(s.keys.llmModel).toBe('gpt-x');
  });
});
