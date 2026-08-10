// web 采集接线单测:applyCollectedToStore(纯函数)+ collectViaProxy(mock fetch)
// + f10MarketFor(市场码 0=深 1=沪)。离线,无网络依赖。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryStore } from '../src/store-memory.ts';
import { applyCollectedToStore, collectViaProxy } from '../src/webCollect.ts';
import { f10MarketFor } from '../src/tdx/f10Client.ts';

const payload = {
  ticker: '002027',
  name: '分众传媒',
  bars: [
    { date: '2026-08-07', open: 6.1, close: 6.2, high: 6.3, low: 6.0, volume: 100000 },
    { date: '2026-08-10', open: 6.2, close: 6.4, high: 6.5, low: 6.1, volume: 120000 },
  ],
  snapshot: { price: 6.4, high: 6.5, low: 6.1, open: 6.2, volume: 120000, amount: 768000000 },
  capitalText: '',
  f10Text: '【主要财务指标】\n净资产收益率: 15.2',
};

describe('applyCollectedToStore', () => {
  it('写入 bars/名称/per-ticker f10 meta,返回 run opts 结果', () => {
    const store = new InMemoryStore();
    const r = applyCollectedToStore(store, payload);

    expect(store.getStock('002027')?.name).toBe('分众传媒');
    expect(store.getDatas('002027')).toHaveLength(2);
    expect(store.getMeta('f10:002027')).toContain('主要财务指标');
    expect(r.f10Text).toBe(payload.f10Text);
    expect(r.snapshot?.price).toBe(6.4);
    expect(r.name).toBe('分众传媒');
    // 不串 ticker:600036 不受影响
    expect(store.getDatas('600036')).toHaveLength(0);
    expect(store.getMeta('f10:600036')).toBeNull();
  });

  it('name 缺省回退 ticker;f10 空不写 meta', () => {
    const store = new InMemoryStore();
    const r = applyCollectedToStore(store, { ...payload, name: null, f10Text: '' });

    expect(store.getStock('002027')?.name).toBe('002027');
    expect(store.getMeta('f10:002027')).toBeNull();
    expect(r.f10Text).toBeNull();
    expect(r.name).toBeNull();
  });

  it('addDatas 去重语义:重复日期不重复入库', () => {
    const store = new InMemoryStore();
    applyCollectedToStore(store, payload);
    applyCollectedToStore(store, payload); // 二次写入,全部重复

    expect(store.getDatas('002027')).toHaveLength(2);
  });

  it('replaceDatas 全量替换:预载 demo 数据不混入(web 600036 回归)', () => {
    const store = new InMemoryStore();
    // 模拟 demo 预载:600036 短历史
    store.addDatas('600036', [{ date: '2026-08-07', open: 1, close: 1, high: 1, low: 1, volume: 1 }]);
    // web 采集:IPO 全量
    applyCollectedToStore(store, {
      ticker: '600036',
      name: '招商银行',
      bars: [
        { date: '2024-01-02', open: 30, close: 30, high: 30, low: 30, volume: 1 },
        { date: '2026-08-10', open: 38, close: 39, high: 39, low: 38, volume: 2 },
      ],
      snapshot: null,
      capitalText: '',
      f10Text: '',
    });
    const bars = store.getDatas('600036');
    expect(bars).toHaveLength(2); // demo 的 08-07 被替换掉,不混入
    expect(bars[0].date).toBe('2024-01-02');
    expect(bars[1].date).toBe('2026-08-10');
  });
});

describe('collectViaProxy', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('ok 200 → 解析载荷,请求 URL 正确', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })),
    );
    const got = await collectViaProxy('002027', 'http://localhost:8090');

    expect(fetch).toHaveBeenCalledWith('http://localhost:8090/tdx-collect?ticker=002027');
    expect(got.bars).toHaveLength(2);
    expect(got.f10Text).toContain('主要财务指标');
  });

  it('5xx → 抛错并带服务端原因', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'TDX 采集失败:boom' }), { status: 502 })),
    );
    await expect(collectViaProxy('002027', 'http://x')).rejects.toThrow(/boom/);
  });

  it('400 无效 ticker → 抛错', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: '无效 ticker:abc' }), { status: 400 })),
    );
    await expect(collectViaProxy('abc', 'http://x')).rejects.toThrow(/无效 ticker/);
  });

  it('网络不可达 → 抛错提示需 server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    await expect(collectViaProxy('002027', 'http://localhost:9')).rejects.toThrow(/不可达/);
  });
});

describe('f10MarketFor', () => {
  it('深市 0、沪市 1(inferExchange 对齐 pytdx 契约)', () => {
    expect(f10MarketFor('002027')).toBe(0); // 深主板
    expect(f10MarketFor('300750')).toBe(0); // 创业板
    expect(f10MarketFor('600036')).toBe(1); // 沪主板
    expect(f10MarketFor('688111')).toBe(1); // 科创板
  });
});
