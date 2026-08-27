// 真机采集单测 —— 离线零网络:mock node-tdx-market TdxClient(假客户端,
// connect/disconnect 桩,不建 TCP)+ tdx/quoteClient.collectAll + tdx/f10Client
// 三函数(getCompanyInfoCategory/getCompanyInfoContent/f10MarketFor);store 用
// InMemoryStore 经 setDeviceStore 注入。不测真实 TCP。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoreLike } from '../src/store.ts';

const mocks = vi.hoisted(() => ({
  TdxClient: vi.fn(),
  collectAll: vi.fn(),
  getCompanyInfoCategory: vi.fn(),
  getCompanyInfoContent: vi.fn(),
  f10MarketFor: vi.fn(),
}));

vi.mock('node-tdx-market', () => ({ TdxClient: mocks.TdxClient }));
vi.mock('../src/tdx/quoteClient.ts', () => ({ collectAll: mocks.collectAll }));
vi.mock('../src/tdx/f10Client.ts', () => ({
  getCompanyInfoCategory: mocks.getCompanyInfoCategory,
  getCompanyInfoContent: mocks.getCompanyInfoContent,
  f10MarketFor: mocks.f10MarketFor,
}));

import { collectForDevice, setDeviceStore, DEVICE_TDX_HOSTS } from '../src/tdx/deviceCollect.ts';
import { InMemoryStore } from '../src/store-memory.ts';
import { asiaToday, latestPastQuarterEnd } from '../src/gates.ts';
import { capitalKey, f10Key } from '../src/metaKeys.ts';

const TICKER = '600036';

/** 假客户端:只用 on/connect/disconnect 面(真 TdxClient connect 才建 TCP)。 */
function makeFakeClient() {
  return {
    on: vi.fn(),
    connect: vi.fn().mockResolvedValue('1.2.3.4:7709'),
    disconnect: vi.fn(),
  };
}

const cats = [
  { name: '公司概况', filename: 'g', start: 1, length: 10 },
  { name: '财务分析', filename: 'f', start: 11, length: 20 },
  { name: '股本结构', filename: 'c', start: 31, length: 5 },
];

const collected = {
  ticker: TICKER,
  name: '招商银行',
  bars: [
    { date: '2026-08-14', open: 30, close: 31, high: 32, low: 29, volume: 1000, amount: 31000 },
  ],
  snapshot: { price: 31.2, high: 32, low: 29, open: 30, volume: 1000, amount: 31000 },
  capital: null,
};

describe('collectForDevice', () => {
  let store: StoreLike;
  let client: ReturnType<typeof makeFakeClient>;

  beforeEach(() => {
    store = new InMemoryStore();
    setDeviceStore(store);
    client = makeFakeClient();
    // new TdxClient(...) → 返回假客户端(Vitest 4:new 调用须用 mockImplementation)
    mocks.TdxClient.mockImplementation(function () {
      return client;
    });
    mocks.f10MarketFor.mockReturnValue(0);
    mocks.getCompanyInfoCategory.mockResolvedValue(cats);
    mocks.getCompanyInfoContent.mockImplementation(
      async (_c: unknown, _m: number, _t: string, filename: string) => {
        if (filename === 'f') return '【主要财务指标】\n净资产收益率: 15.2';
        if (filename === 'c') return '股本结构文本';
        return '';
      },
    );
    mocks.collectAll.mockResolvedValue(collected);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('全路径:构造 TdxClient → connect → F10 + collectAll → 写 store,返回 WebCollectResult', async () => {
    const result = await collectForDevice(TICKER);

    // TdxClient 构造参数(显式 host,顺序尝试首个)+ 生命周期(单连接,结束 disconnect)
    expect(mocks.TdxClient).toHaveBeenCalledWith(
      // F56:host 是模块加载期 env 固化的 DEVICE_TDX_HOSTS[0](开发机设
      // TDX_HOST=hostname 时 IPv4 断言困惑性失败)——改为精确引用常量本身;
      // env 键位优先级已由 rn-env-keys.test.ts 覆盖。
      expect.objectContaining({ connectTimeout: 8000, requestTimeout: 12000, host: DEVICE_TDX_HOSTS[0] }),
    );
    expect(client.on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(client.disconnect).toHaveBeenCalledTimes(1);

    // F10:category → 财务分析节 + 股本结构节(组装序对齐 proxies.cjs doCollect)
    expect(mocks.getCompanyInfoCategory).toHaveBeenCalledWith(client, 0, TICKER);
    expect(mocks.getCompanyInfoContent).toHaveBeenCalledTimes(2);
    expect(mocks.getCompanyInfoContent.mock.calls.map((c) => c[3])).toEqual(['f', 'c']);

    // collectAll:meta 绑定 store(fetchStockName 缓存面)
    expect(mocks.collectAll).toHaveBeenCalledWith(client, TICKER, expect.any(Object), { skipDaily: false });
    const meta = mocks.collectAll.mock.calls[0][2] as {
      get: (k: string) => string | null;
      set: (k: string, v: string) => void;
    };
    meta.set(`name:${TICKER}`, '招商银行');
    expect(meta.get(`name:${TICKER}`)).toBe('招商银行');
    expect(store.getMeta(`name:${TICKER}`)).toBe('招商银行');

    // applyCollectedToStore 写 store:bars/名称/per-ticker f10/capital meta
    expect(store.getStock(TICKER)?.name).toBe('招商银行');
    expect(store.getDatas(TICKER)).toEqual(collected.bars);
    expect(store.getMeta(f10Key(TICKER))).toContain('主要财务指标');
    expect(store.getMeta(capitalKey(TICKER))).toBe('股本结构文本');

    // 返回 WebCollectResult(f10Text/snapshot/name;capital 由股本结构文本解析)
    expect(result).toEqual({
      f10Text: '【主要财务指标】\n净资产收益率: 15.2',
      snapshot: collected.snapshot,
      name: '招商银行',
      capital: null,
    });
  });

  it('opts 缺省:lastDataUpdate === 今天 → skipDaily 自动 true(collectAll 跳过日K)', async () => {
    store.putStock({
      ticker: TICKER,
      name: '招商银行',
      overview: null,
      overviewLastUpdate: null,
      lastDataUpdate: asiaToday(),
    });
    await collectForDevice(TICKER);

    expect(mocks.collectAll).toHaveBeenCalledWith(client, TICKER, expect.any(Object), { skipDaily: true });
    // 部分 fresh 不整体短路:日K 跳过,财务分析节仍拉
    expect(mocks.getCompanyInfoContent).toHaveBeenCalledTimes(2);
  });

  it('opts 缺省:最新业绩报告 == 本季季度末 → skipF10 自动 true(财务分析节不拉)', async () => {
    store.addPerformanceReports(TICKER, [{ report_date: latestPastQuarterEnd(asiaToday())!, fields: {} }]);
    await collectForDevice(TICKER);

    expect(mocks.getCompanyInfoContent).toHaveBeenCalledTimes(1);
    expect(mocks.getCompanyInfoContent.mock.calls[0][3]).toBe('c'); // 仅股本结构节
    expect(mocks.collectAll).toHaveBeenCalledWith(client, TICKER, expect.any(Object), { skipDaily: false });
  });

  it('显式 opts 覆盖自动判定:同日仍 skipDaily:false 拉日K;skipF10:true 强制跳财务分析', async () => {
    store.putStock({
      ticker: TICKER,
      name: '招商银行',
      overview: null,
      overviewLastUpdate: null,
      lastDataUpdate: asiaToday(),
    });
    await collectForDevice(TICKER, { skipDaily: false, skipF10: true });

    expect(mocks.collectAll).toHaveBeenCalledWith(client, TICKER, expect.any(Object), { skipDaily: false });
    expect(mocks.getCompanyInfoContent).toHaveBeenCalledTimes(1); // 仅股本结构节
  });

  it('skipF10 且存在缓存 f10 meta → 缓存文本顶替(不降级占位)', async () => {
    store.setMeta(f10Key(TICKER), '【主要财务指标】\n净资产收益率: 18.8');
    const result = await collectForDevice(TICKER, { skipF10: true });

    expect(result.f10Text).toBe('【主要财务指标】\n净资产收益率: 18.8');
    expect(mocks.getCompanyInfoContent).toHaveBeenCalledTimes(1); // 财务分析节未拉
    expect(store.getMeta(f10Key(TICKER))).toBe('【主要财务指标】\n净资产收益率: 18.8'); // 幂等重写
  });

  it('collectAll 失败 → 全部 host 尝试后 reject 可读中文错误,每个都 disconnect', async () => {
    mocks.collectAll.mockRejectedValue(new Error('socket hang up'));
    await expect(collectForDevice(TICKER)).rejects.toThrow('TDX 采集失败:socket hang up');
    expect(client.disconnect).toHaveBeenCalledTimes(DEVICE_TDX_HOSTS.length);
  });

  it('connect 失败 → 全部 host 尝试后 reject 可读中文错误,不吞', async () => {
    client.connect.mockRejectedValue(new Error('connect ECONNREFUSED 1.2.3.4:7709'));
    await expect(collectForDevice(TICKER)).rejects.toThrow('TDX 采集失败:connect ECONNREFUSED 1.2.3.4:7709');
    expect(client.disconnect).toHaveBeenCalledTimes(DEVICE_TDX_HOSTS.length);
  });

  it('TDX_HOST=hostname → host 原样传 TdxClient(模块加载期 env 固化 → resetModules+动态 import 重载)', async () => {
    // F56:DEVICE_TDX_HOSTS 是模块加载期顶层 const,静态 import 求值即固定;
    // 伪造 env 后须 resetModules + 动态 import 重求值(与 rn-env-keys.test.ts
    // 同款模式;vi.mock 工厂按文件生效,新实例仍走同一假客户端)。
    const saved = { ...process.env };
    try {
      process.env.TDX_HOST = 'tdx.example.com';
      delete process.env.EXPO_PUBLIC_TDX_HOST;
      vi.resetModules();
      const mod = await import('../src/tdx/deviceCollect.ts');
      mod.setDeviceStore(store);
      await mod.collectForDevice(TICKER);
      expect(mocks.TdxClient).toHaveBeenCalledWith(
        expect.objectContaining({ host: 'tdx.example.com' }),
      );
    } finally {
      if (saved.TDX_HOST === undefined) delete process.env.TDX_HOST;
      else process.env.TDX_HOST = saved.TDX_HOST;
      if (saved.EXPO_PUBLIC_TDX_HOST === undefined) delete process.env.EXPO_PUBLIC_TDX_HOST;
      else process.env.EXPO_PUBLIC_TDX_HOST = saved.EXPO_PUBLIC_TDX_HOST;
    }
  });
});
