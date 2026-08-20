// collector 共享面单测:resolveSkipGates(freshness 门共享实现)+ selectCollector
// (平台选择,app 层 app/lib/collectorSelection.ts——动态 import 目标须在 metro
// 项目根内,src 不反向依赖 app)。离线零网络:store 用 InMemoryStore;设备加载器
// 注入 fake 替代(默认加载器断言仅比函数身份,不触发 TCP)。F10 顶替(跳过时
// 缓存 f10:ticker meta 文本)语义在 device-collect.test.ts 覆盖,此处只测判定。
import { describe, expect, it, vi } from 'vitest';
import { resolveSkipGates } from '../src/collector.ts';
import type { MarketCollector } from '../src/collector.ts';
import type { Market } from '../src/market.ts';
import { selectCollector } from '../app/lib/collectorSelection.ts';
import { InMemoryStore } from '../src/store-memory.ts';
import type { StoreLike } from '../src/store.ts';
import { asiaToday, latestPastQuarterEnd } from '../src/gates.ts';

const TICKER = '600036';

function freshStore(): StoreLike {
  return new InMemoryStore();
}

describe('resolveSkipGates', () => {
  it('同 ticker 同日已采集 → skipDaily true(标签列出);跨日 → 不 skip', () => {
    const store = freshStore();
    store.putStock({
      ticker: TICKER,
      name: '招商银行',
      overview: null,
      overviewLastUpdate: null,
      lastDataUpdate: asiaToday(),
    });
    expect(resolveSkipGates(store, TICKER)).toEqual({
      skipDaily: true,
      skipF10: false,
      skipped: ['日K(同日已采集)'],
    });

    store.putStock({
      ticker: TICKER,
      name: '招商银行',
      overview: null,
      overviewLastUpdate: null,
      lastDataUpdate: '2020-01-01',
    });
    expect(resolveSkipGates(store, TICKER)).toEqual({ skipDaily: false, skipF10: false, skipped: [] });
  });

  it('最新业绩报告 == 最近已过季度末 → skipF10 true(同季 F10 顶替判定)', () => {
    const store = freshStore();
    store.addPerformanceReports(TICKER, [{ report_date: latestPastQuarterEnd(asiaToday())!, fields: {} }]);
    expect(resolveSkipGates(store, TICKER)).toEqual({
      skipDaily: false,
      skipF10: true,
      skipped: ['F10财务分析(同季已入库)'],
    });
  });

  it('部分 fresh 不整体短路:同日日K + 未披露当期业绩 → 仅 skipDaily', () => {
    const store = freshStore();
    store.putStock({
      ticker: TICKER,
      name: '招商银行',
      overview: null,
      overviewLastUpdate: null,
      lastDataUpdate: asiaToday(),
    });
    store.addPerformanceReports(TICKER, [{ report_date: '20260331', fields: {} }]); // 非本季 → F10 重拉
    expect(resolveSkipGates(store, TICKER)).toEqual({
      skipDaily: true,
      skipF10: false,
      skipped: ['日K(同日已采集)'],
    });
  });

  it('空库首采 → 全量(无任何跳过)', () => {
    expect(resolveSkipGates(freshStore(), TICKER)).toEqual({ skipDaily: false, skipF10: false, skipped: [] });
  });

  it('显式 opts 覆盖自动判定:同日仍 skipDaily:false;skipF10 强制 true(标签按最终值)', () => {
    const store = freshStore();
    store.putStock({
      ticker: TICKER,
      name: '招商银行',
      overview: null,
      overviewLastUpdate: null,
      lastDataUpdate: asiaToday(),
    });
    const gates = resolveSkipGates(store, TICKER, { skipDaily: false, skipF10: true });
    expect(gates.skipDaily).toBe(false);
    expect(gates.skipF10).toBe(true);
    expect(gates.skipped).toEqual(['F10财务分析(同季已入库)']);
  });
});

describe('selectCollector(平台+市场选择,注入 fake 实现)', () => {
  const emptyResult = { f10Text: null, snapshot: null, name: null, capital: null };
  // 三市场同实现占位(单实现注入场景;按市场分派见下一用例)
  const impls = (fn: MarketCollector): Record<Market, MarketCollector> => ({ cn: fn, hk: fn, us: fn });

  it('web → 直接返回静态 webImpls[market],不触发设备模块加载', async () => {
    const web: MarketCollector = vi.fn().mockResolvedValue(emptyResult);
    const loadDevice = vi.fn();
    const impl = await selectCollector('web', 'hk', impls(web), loadDevice);
    expect(impl).toBe(web);
    expect(loadDevice).not.toHaveBeenCalled();
  });

  it('web 按 market 分派:cn/hk/us 各自取对应实现', async () => {
    const webImpls: Record<Market, MarketCollector> = {
      cn: vi.fn().mockResolvedValue(emptyResult),
      hk: vi.fn().mockResolvedValue(emptyResult),
      us: vi.fn().mockResolvedValue(emptyResult),
    };
    expect(await selectCollector('web', 'cn', webImpls)).toBe(webImpls.cn);
    expect(await selectCollector('web', 'hk', webImpls)).toBe(webImpls.hk);
    expect(await selectCollector('web', 'us', webImpls)).toBe(webImpls.us);
  });

  it('rn → 经 loadDeviceImpls 动态加载设备实现(注入 fake)并按 market 取', async () => {
    const device: MarketCollector = vi.fn().mockResolvedValue(emptyResult);
    const loadDevice = vi.fn().mockResolvedValue(impls(device));
    const impl = await selectCollector('rn', 'us', impls(vi.fn()), loadDevice);
    expect(impl).toBe(device);
    expect(loadDevice).toHaveBeenCalledTimes(1);
  });

  it('web 实现按接口契约驱动:collect(ticker, opts) 透传并返回 WebCollectResult', async () => {
    const web: MarketCollector = vi.fn().mockResolvedValue(emptyResult);
    const impl = await selectCollector('web', 'cn', impls(web));
    const out = await impl(TICKER, { skipDaily: true });
    expect(web).toHaveBeenCalledWith(TICKER, { skipDaily: true });
    expect(out).toEqual(emptyResult);
  });

  it('缺省设备加载器 → 真实 deviceBridge 实现(cn → collectForDevice,与 MarketCollector 契约一致)', async () => {
    const impl = await selectCollector('rn', 'cn', impls(vi.fn()));
    const { collectForDevice } = await import('../src/tdx/deviceCollect.ts');
    expect(impl).toBe(collectForDevice);
  });
});
