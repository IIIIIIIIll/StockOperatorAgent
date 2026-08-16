// RN env 键位单测 —— EXPO_PUBLIC_* 优先 fallback(真机可达键位,父任务
// 08-16-audit-remediation 跨子契约 6)。webSearch.defaultSearcher 在调用时读
// process.env → 直接伪造 env;DEVICE_TDX_HOSTS 是模块加载期常量 → vi.resetModules
// + 动态 import 后断言。不建网络:fetch 全 stub,断言 Tavily 请求体 api_key。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSearcher, ddgSearcher } from '../src/webSearch.ts';

/** 保存→patch→fn→还原 process.env(对齐 committee.test/agents.test 先例)。 */
async function withEnv(
  patch: Record<string, string | undefined>,
  fn: () => Promise<void> | void,
): Promise<void> {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(patch)) {
    saved[k] = process.env[k];
    if (patch[k] === undefined) delete process.env[k];
    else process.env[k] = patch[k]!;
  }
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** 断言 defaultSearcher 选中 Tavily 路径,且请求体 api_key == 期望值(fetch 全 stub)。 */
async function expectTavilyKey(expected: string): Promise<void> {
  const fetchMock = vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify({ results: [] }), { status: 200 }),
  );
  vi.stubGlobal('fetch', fetchMock);
  try {
    const searcher = defaultSearcher();
    expect(searcher).not.toBe(ddgSearcher);
    await searcher('测试');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.tavily.com/search');
    expect(JSON.parse(String(init?.body ?? '{}'))).toMatchObject({ api_key: expected });
  } finally {
    vi.unstubAllGlobals();
  }
}

describe('webSearch.defaultSearcher env 键位(EXPO_PUBLIC_TAVILY_API_KEY 优先)', () => {
  it('两键皆无 → ddgSearcher(免 key 兜底,默认行为不变)', async () => {
    await withEnv({ EXPO_PUBLIC_TAVILY_API_KEY: undefined, TAVILY_API_KEY: undefined }, () => {
      expect(defaultSearcher()).toBe(ddgSearcher);
    });
  });

  it('仅 TAVILY_API_KEY → 用 TAVILY_API_KEY(现状 fallback)', async () => {
    await withEnv(
      { EXPO_PUBLIC_TAVILY_API_KEY: undefined, TAVILY_API_KEY: 'tavily-fallback' },
      () => expectTavilyKey('tavily-fallback'),
    );
  });

  it('EXPO_PUBLIC_TAVILY_API_KEY 优先于 TAVILY_API_KEY', async () => {
    await withEnv(
      { EXPO_PUBLIC_TAVILY_API_KEY: 'expo-key', TAVILY_API_KEY: 'tavily-fallback' },
      () => expectTavilyKey('expo-key'),
    );
  });
});

describe('deviceCollect.DEVICE_TDX_HOSTS env 键位(EXPO_PUBLIC_TDX_HOST 优先)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  /** 模块加载期常量:静态 import 会在 env patch 前求值(求值一次即固定) →
   * 必须 resetModules 后动态 import 重新求值,才能观察伪造的 process.env
   * (ts-no-dynamic-import 例外:测试刻意走模块加载边界)。 */
  async function loadHosts(): Promise<string[]> {
    const { DEVICE_TDX_HOSTS } = await import('../src/tdx/deviceCollect.ts');
    return DEVICE_TDX_HOSTS;
  }

  it('EXPO_PUBLIC_TDX_HOST 优先于 TDX_HOST', async () => {
    await withEnv({ EXPO_PUBLIC_TDX_HOST: '10.0.0.9', TDX_HOST: '10.0.0.8' }, async () => {
      expect((await loadHosts())[0]).toBe('10.0.0.9');
    });
  });

  it('仅 TDX_HOST → 回退 TDX_HOST(现状)', async () => {
    await withEnv({ EXPO_PUBLIC_TDX_HOST: undefined, TDX_HOST: '10.0.0.8' }, async () => {
      expect((await loadHosts())[0]).toBe('10.0.0.8');
    });
  });

  it('两键皆无 → 默认 150.158.160.2,列表 5 节点不变', async () => {
    await withEnv({ EXPO_PUBLIC_TDX_HOST: undefined, TDX_HOST: undefined }, async () => {
      const hosts = await loadHosts();
      expect(hosts[0]).toBe('150.158.160.2');
      expect(hosts).toHaveLength(5);
    });
  });
});
