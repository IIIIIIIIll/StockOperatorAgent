// DesktopStore(renderer 镜像 + 写穿队列)与 bridgeStorage(settingsStore 桥接)
// 单元测试。用假 bridge 对象模拟 preload contextBridge 暴露面
// (window.__soaDesktop)——断言:ready 后镜像读回与快照一致、6 个 mutator
// 本地生效 + 队列按序发 op(args 逐字段)、队列串行(第二个 op 在前一个
// storeOp resolve 后才发出)、getItem/setItem 映射、无 __soaDesktop 时
// isDesktopBridge() === false(清理 globalThis 后)。
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bridgeStorage,
  DesktopStore,
  getBridge,
  isDesktopBridge,
  type SoaDesktopBridge,
  type StoreSnapshot,
} from '../app/lib/desktopBridge.ts';
import type { DailyBar, PerformanceReport, StockRecord } from '../src/store.ts';

// ─── 假 bridge(模拟 preload 暴露面)────────────────────────────────────────

/** storeOp 立即 resolve(autoResolve)或挂起等 settleNext(队列时序断言)。 */
class FakeBridge implements SoaDesktopBridge {
  readonly isDesktop: true = true;
  snapshot: StoreSnapshot = { stocks: {}, datas: {}, reports: {}, meta: {} };
  ops: Array<{ op: string; args: unknown[] }> = [];
  storeInitCalls = 0;
  settingsValue: string | null = null;
  private settlers: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];

  constructor(private readonly autoResolve = true, private storeInitFailures = 0) {}

  storeInit(): Promise<StoreSnapshot> {
    this.storeInitCalls += 1;
    if (this.storeInitFailures > 0) {
      this.storeInitFailures -= 1;
      return Promise.reject(new Error('fake storeInit failure'));
    }
    return Promise.resolve(this.snapshot);
  }

  storeOp(op: string, args: unknown[]): Promise<void> {
    this.ops.push({ op, args });
    if (this.autoResolve) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      this.settlers.push({ resolve, reject });
    });
  }

  settingsLoad(): string | null {
    return this.settingsValue;
  }

  settingsSaveAsync(json: string): Promise<void> {
    this.settingsValue = json;
    return Promise.resolve();
  }

  /** 结算最早挂起的 storeOp(resolve 或 reject)。 */
  settleNext(mode: 'resolve' | 'reject' = 'resolve'): void {
    const s = this.settlers.shift();
    if (!s) throw new Error('FakeBridge.settleNext: 无挂起 op');
    if (mode === 'reject') s.reject(new Error('fake store-op failure'));
    else s.resolve();
  }

  get pending(): number {
    return this.settlers.length;
  }
}

function bar(date: string, close = 2): DailyBar {
  return { date, open: 1, close, high: 3, low: 0.5, volume: 100, amount: 1000 };
}

function report(report_date: string): PerformanceReport {
  return { report_date, fields: { rev: 1 } };
}

function rec(ticker: string): StockRecord {
  return { ticker, name: 'n', overview: null, overviewLastUpdate: null, lastDataUpdate: null };
}

/** 轮询等待条件(队列异步推进用;不引入定时器竞态)。 */
async function until(cond: () => boolean, what: string, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`until timeout: ${what}`);
    await new Promise((r) => setTimeout(r, 1));
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── ready 快照 hydrate ─────────────────────────────────────────────────────

describe('DesktopStore 镜像(ready 快照 hydrate)', () => {
  it('F04 ready 失败清 memo:storeInit 首调 reject → 重试成功,镜像/队列照常', async () => {
    const bridge = new FakeBridge(true, 1);
    const store = new DesktopStore(bridge);
    await expect(store.ready()).rejects.toThrow('fake storeInit failure');
    await store.ready(); // 重试:拒绝未被永久缓存,hydrate 成功
    store.putStock(rec('T'));
    await until(() => bridge.ops.length === 1, 'storeOp enqueued');
    expect(store.getStock('T')?.ticker).toBe('T');
  });

  it('ready() 后读方法返回与快照一致;缺失 ticker 返回空/缺省', async () => {
    const bridge = new FakeBridge();
    bridge.snapshot = {
      stocks: { '600036': rec('600036') },
      datas: { '600036': [bar('2026-08-13'), bar('2026-08-14')] },
      reports: { '600036': [report('20260815')] },
      meta: { k1: 'v1' },
    };
    const store = new DesktopStore(bridge);
    await store.ready();

    expect(store.getStock('600036')).toEqual(rec('600036'));
    expect(store.getDatas('600036')).toEqual([bar('2026-08-13'), bar('2026-08-14')]);
    expect(store.getPerformanceReports('600036')).toEqual([report('20260815')]);
    expect(store.getMeta('k1')).toBe('v1');
    expect(store.getStock('000001')).toBeNull();
    expect(store.getDatas('000001')).toEqual([]);
    expect(store.getPerformanceReports('000001')).toEqual([]);
    expect(store.getMeta('missing')).toBeNull();
    // ready 缓存:二次 ready 不再发 storeInit
    await store.ready();
    expect(bridge.storeInitCalls).toBe(1);
  });

  it('读方法返回副本(改返回值不影响镜像)', async () => {
    const bridge = new FakeBridge();
    bridge.snapshot = {
      stocks: {},
      datas: { '600036': [bar('2026-08-13')] },
      reports: { '600036': [report('20260815')] },
      meta: {},
    };
    const store = new DesktopStore(bridge);
    await store.ready();

    const datas = store.getDatas('600036');
    datas[0].close = 99;
    datas.push(bar('2026-08-14'));
    expect(store.getDatas('600036')).toEqual([bar('2026-08-13')]);

    const reports = store.getPerformanceReports('600036');
    reports[0].fields.rev = 99;
    expect(store.getPerformanceReports('600036')).toEqual([report('20260815')]);
  });
});

// ─── 6 个 mutator:本地生效 + 队列按序 ───────────────────────────────────────

describe('DesktopStore mutator:本地镜像 + 写穿队列', () => {
  it('6 个 mutator 按调用序发 op(args 逐字段断言)且本地同步生效', async () => {
    const bridge = new FakeBridge();
    const store = new DesktopStore(bridge);
    await store.ready();

    const stock = rec('000001');
    store.putStock(stock);
    const bars = [bar('2026-08-10'), bar('2026-08-11')];
    store.addDatas('000001', bars);
    const reports = [report('20260810')];
    store.addPerformanceReports('000001', reports);
    store.updateOverview('000001', { pe: 6 }, '2026-08-16');
    const bars2 = [bar('2026-08-20')];
    store.replaceDatas('000001', bars2);
    store.setMeta('k1', 'v1');

    await until(() => bridge.ops.length === 6, '6 个 op 全部发出');

    expect(bridge.ops.map((o) => o.op)).toEqual([
      'putStock',
      'addDatas',
      'addPerformanceReports',
      'updateOverview',
      'replaceDatas',
      'setMeta',
    ]);
    // args 为方法实参数组,顺序与调用序一致(逐字段断言)
    expect(bridge.ops[0].args).toEqual([stock]);
    expect(bridge.ops[1].args).toEqual(['000001', bars]);
    expect(bridge.ops[2].args).toEqual(['000001', reports]);
    expect(bridge.ops[3].args).toEqual(['000001', { pe: 6 }, '2026-08-16']);
    expect(bridge.ops[4].args).toEqual(['000001', bars2]);
    expect(bridge.ops[5].args).toEqual(['k1', 'v1']);

    // 本地镜像同步生效(putStock 后 updateOverview 合并进 overview;
    // replaceDatas 同步 lastDataUpdate,同 FileStore)
    expect(store.getStock('000001')).toEqual({
      ...stock,
      overview: { pe: 6 },
      overviewLastUpdate: '2026-08-16',
      lastDataUpdate: '2026-08-20',
    });
    expect(store.getDatas('000001')).toEqual(bars2);
    expect(store.getPerformanceReports('000001')).toEqual(reports);
    expect(store.getMeta('k1')).toBe('v1');
  });

  it('队列串行:第二个 op 在前一个 storeOp resolve 后才发出', async () => {
    const bridge = new FakeBridge(false);
    const store = new DesktopStore(bridge);
    store.putStock(rec('000001'));
    store.setMeta('k1', 'v1');

    await until(() => bridge.ops.length === 1, '第一个 op 发出');
    expect(bridge.ops[0].op).toBe('putStock');
    expect(bridge.pending).toBe(1);
    // 第一个尚未 resolve → 第二个不得发出
    await new Promise((r) => setTimeout(r, 10));
    expect(bridge.ops).toHaveLength(1);

    bridge.settleNext();
    await until(() => bridge.ops.length === 2, '第二个 op 发出');
    expect(bridge.ops[1].op).toBe('setMeta');
    expect(bridge.ops[1].args).toEqual(['k1', 'v1']);
    bridge.settleNext();
    await until(() => bridge.pending === 0, '队列排空');
  });

  it('store-op 失败仅 console.error,不抛、不阻断后续 op(写穿队列语义)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const bridge = new FakeBridge(false);
      const store = new DesktopStore(bridge);
      store.putStock(rec('600036'));
      store.setMeta('k1', 'v1');
      // 第一个 op 已发出并挂起(第二个排队等第一个 resolve)
      await until(() => bridge.ops.length === 1, '第一个 op 发出并挂起');
      expect(bridge.ops[0].op).toBe('putStock');
      expect(bridge.pending).toBe(1);
      bridge.settleNext('reject'); // 第一个失败 → 仅 console.error
      await until(() => bridge.ops.length === 2, '第二个 op 仍发出');
      bridge.settleNext();
      await until(() => bridge.pending === 0 && errSpy.mock.calls.length === 1, '失败已记录且队列排空');
      expect(store.getMeta('k1')).toBe('v1'); // 本地镜像不受失败影响
    } finally {
      errSpy.mockRestore();
    }
  });
});

// ─── 镜像语义核对(与 FileStore 逐项一致)────────────────────────────────────

describe('DesktopStore 镜像语义(与 FileStore 逐项核对)', () => {
  it('addDatas:date <= 末根拒绝、部分新增计数、lastDataUpdate 同步、同日期 keep last', async () => {
    const bridge = new FakeBridge();
    bridge.snapshot = {
      stocks: { '600036': { ...rec('600036'), lastDataUpdate: '2026-08-14' } },
      datas: { '600036': [bar('2026-08-13'), bar('2026-08-14')] },
      reports: {},
      meta: {},
    };
    const store = new DesktopStore(bridge);
    await store.ready();

    // 全部重复(含旧日期)→ 0,不排队
    expect(store.addDatas('600036', [bar('2026-08-13'), bar('2026-08-14')])).toBe(0);
    expect(bridge.ops).toHaveLength(0);
    // 部分新增(旧日期被滤,仅 08-15 计入)→ 1
    expect(store.addDatas('600036', [bar('2026-08-14'), bar('2026-08-15', 5)])).toBe(1);
    expect(store.getDatas('600036').map((b) => b.date)).toEqual(['2026-08-13', '2026-08-14', '2026-08-15']);
    expect(store.getStock('600036')?.lastDataUpdate).toBe('2026-08-15');
    // 同日期输入去重 keep last(返回 fresh 过滤数,同 FileStore)
    expect(store.addDatas('600036', [bar('2026-08-16', 1), bar('2026-08-16', 2)])).toBe(2);
    expect(store.getDatas('600036').filter((b) => b.date === '2026-08-16')).toEqual([bar('2026-08-16', 2)]);
    await until(() => bridge.ops.length === 2, '仅 2 次 addDatas 排队');
  });

  it('addPerformanceReports:report_date 去重、排序、返回新增数', async () => {
    const bridge = new FakeBridge();
    bridge.snapshot = {
      stocks: {},
      datas: {},
      reports: { '600036': [report('20260815')] },
      meta: {},
    };
    const store = new DesktopStore(bridge);
    await store.ready();

    expect(store.addPerformanceReports('600036', [report('20260815')])).toBe(0); // 全重复不排队
    expect(bridge.ops).toHaveLength(0);
    expect(store.addPerformanceReports('600036', [report('20260810'), report('20260820')])).toBe(2);
    expect(store.getPerformanceReports('600036').map((r) => r.report_date)).toEqual([
      '20260810',
      '20260815',
      '20260820',
    ]);
    await until(() => bridge.ops.length === 1, '1 次排队');
    expect(bridge.ops[0].op).toBe('addPerformanceReports');
  });

  it('putStock 整记录替换;updateOverview 仅对既有 stock 生效', async () => {
    const bridge = new FakeBridge();
    const store = new DesktopStore(bridge);
    await store.ready();

    // 无 stock → updateOverview 空操作不排队(同 FileStore)
    store.updateOverview('600036', { pe: 1 }, '2026-08-16');
    expect(bridge.ops).toHaveLength(0);

    store.putStock({ ...rec('600036'), overview: { pe: 0 }, overviewLastUpdate: '2026-08-10' });
    store.putStock(rec('600036')); // 整记录替换
    expect(store.getStock('600036')).toEqual(rec('600036'));
    store.updateOverview('600036', { pe: 2 }, '2026-08-16');
    expect(store.getStock('600036')).toEqual({ ...rec('600036'), overview: { pe: 2 }, overviewLastUpdate: '2026-08-16' });
    await until(() => bridge.ops.length === 3, '3 次排队');
    expect(bridge.ops.map((o) => o.op)).toEqual(['putStock', 'putStock', 'updateOverview']);
  });

  it('replaceDatas:空输入早退不清库;非空全量替换并更新 lastDataUpdate', async () => {
    const bridge = new FakeBridge();
    bridge.snapshot = {
      stocks: { '600036': { ...rec('600036'), lastDataUpdate: '2026-08-14' } },
      datas: { '600036': [bar('2026-08-13'), bar('2026-08-14')] },
      reports: {},
      meta: {},
    };
    const store = new DesktopStore(bridge);
    await store.ready();

    expect(store.replaceDatas('600036', [])).toBe(0);
    expect(store.getDatas('600036')).toHaveLength(2); // 未清库
    expect(bridge.ops).toHaveLength(0);

    expect(store.replaceDatas('600036', [bar('2026-08-20'), bar('2026-08-21')])).toBe(2);
    expect(store.getDatas('600036').map((b) => b.date)).toEqual(['2026-08-20', '2026-08-21']); // 旧行不残留
    expect(store.getStock('600036')?.lastDataUpdate).toBe('2026-08-21');
    await until(() => bridge.ops.length === 1, '1 次排队');
    expect(bridge.ops[0]).toEqual({
      op: 'replaceDatas',
      args: ['600036', [bar('2026-08-20'), bar('2026-08-21')]],
    });
  });

  it('setMeta 覆盖写入并排队', async () => {
    const bridge = new FakeBridge();
    const store = new DesktopStore(bridge);
    store.setMeta('k1', 'v1');
    store.setMeta('k1', 'v2');
    expect(store.getMeta('k1')).toBe('v2');
    await until(() => bridge.ops.length === 2, '2 次排队');
    expect(bridge.ops.map((o) => o.op)).toEqual(['setMeta', 'setMeta']);
    expect(bridge.ops[0].args).toEqual(['k1', 'v1']);
    expect(bridge.ops[1].args).toEqual(['k1', 'v2']);
  });
});

// ─── bridgeStorage:settingsStore 桥接 ──────────────────────────────────────

describe('bridgeStorage:settingsStore 桥接', () => {
  it('getItem 先读本地镜像(写后立即可见);setItem 经 settingsSaveAsync 异步落盘(忽略键名)', async () => {
    const bridge = new FakeBridge();
    bridge.settingsValue = '{"a":1}';
    vi.stubGlobal('window', { __soaDesktop: bridge });
    const storage = bridgeStorage();
    // 未写 → 读桥 settingsLoad
    expect(storage.getItem('soa:settings')).toBe('{"a":1}');
    expect(storage.getItem('any-key')).toBe('{"a":1}');
    // 写 → 本地镜像立即生效 + 异步落盘
    storage.setItem('soa:settings', '{"b":2}');
    expect(storage.getItem('x')).toBe('{"b":2}'); // 镜像优先于桥
    await vi.waitFor(() => expect(bridge.settingsValue).toBe('{"b":2}'));
    // 落盘失败 → 不抛,镜像仍可用
    const failing = new FakeBridge();
    failing.settingsSaveAsync = () => Promise.reject(new Error('ipc down'));
    vi.stubGlobal('window', { __soaDesktop: failing });
    const s2 = bridgeStorage();
    s2.setItem('k', 'v');
    expect(s2.getItem('k')).toBe('v');
    await vi.waitFor(() => expect(s2.getItem('k')).toBe('v'));
  });

  it('无 __soaDesktop 时 bridgeStorage 抛错(接线错误防护)', () => {
    vi.stubGlobal('window', {});
    expect(() => bridgeStorage()).toThrow(/__soaDesktop/);
  });
});

// ─── isDesktopBridge 探针 ───────────────────────────────────────────────────

describe('isDesktopBridge 探针', () => {
  it('无 window → false;window 无 __soaDesktop → false;isDesktop 非 true → false', () => {
    expect(isDesktopBridge()).toBe(false); // node/vitest 无 window
    expect(getBridge()).toBeNull();
    vi.stubGlobal('window', {});
    expect(isDesktopBridge()).toBe(false);
    expect(getBridge()).toBeNull();
    vi.stubGlobal('window', { __soaDesktop: { isDesktop: false } });
    expect(isDesktopBridge()).toBe(false);
    expect(getBridge()).toBeNull();
  });

  it('__soaDesktop.isDesktop === true → true 且 getBridge 返回实例', () => {
    const bridge = new FakeBridge();
    vi.stubGlobal('window', { __soaDesktop: bridge });
    expect(isDesktopBridge()).toBe(true);
    expect(getBridge()).toBe(bridge);
  });

  it('清理 globalThis 后恢复 false', () => {
    const bridge = new FakeBridge();
    vi.stubGlobal('window', { __soaDesktop: bridge });
    expect(isDesktopBridge()).toBe(true);
    vi.unstubAllGlobals();
    expect(isDesktopBridge()).toBe(false);
    expect(getBridge()).toBeNull();
  });
});
