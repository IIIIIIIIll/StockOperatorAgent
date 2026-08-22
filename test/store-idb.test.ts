// IdbStore 单测:fake-indexeddb 注入 factory(设计 §5/§7 决策 C)。
// 语义断言对齐 store-gates.test.ts 既有约定(addDatas 去重 / replaceDatas 空
// 早退 / 新数组 / 业绩去重 / meta);跨实例持久化覆盖 hydrate。
import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto'; // 安装 globalThis.indexedDB/IDBKeyRange(fake-indexeddb 6.2.5)
import { IDBFactory } from 'fake-indexeddb';
import { IdbStore, type IdbDatabaseLike, type IdbFactoryLike, type IdbObjectStoreLike, type IdbOpenRequestLike, type IdbRequestLike, type IdbTransactionLike } from '../src/store-idb.ts';
import type { DailyBar } from '../src/store.ts';

function bars(dates: string[]): DailyBar[] {
  return dates.map((date) => ({ date, open: 1, close: 2, high: 3, low: 0.5, volume: 100 }));
}

const dbName = 'soa-store-test';

/** 每用例独立 factory(互不串库);同 factory 同库名 = 跨实例共享同一落盘。
 *  根 tsconfig 带 DOM lib 后 fake-indexeddb 的 IDBFactory 不再结构匹配
 *  手写 IdbFactoryLike(仅测试面差异,运行时不变),统一经此适配。 */
function makeIdbFactory(): IdbFactoryLike {
  return new (IDBFactory as unknown as new () => IdbFactoryLike)();
}

function newStore(factory: IdbFactoryLike = makeIdbFactory()): IdbStore {
  return new IdbStore(factory, dbName);
}

describe('IdbStore 内存镜像语义(对齐 InMemoryStore/Store)', () => {
  it('addDatas:增量去重(date<=last 拒绝) + lastDataUpdate 更新', async () => {
    const s = newStore();
    await s.ready();
    s.putStock({ ticker: 'T', name: 'n', overview: null, overviewLastUpdate: null, lastDataUpdate: null });
    expect(s.addDatas('T', bars(['2026-01-01', '2026-01-02']))).toBe(2);
    expect(s.getDatas('T')).toHaveLength(2);
    expect(s.addDatas('T', bars(['2026-01-01', '2026-01-02']))).toBe(0); // 全部重复 → 0 不写
    expect(s.getDatas('T')).toHaveLength(2);
    expect(s.addDatas('T', bars(['2026-01-02', '2026-01-03']))).toBe(1); // 部分新增
    expect(s.getDatas('T')).toHaveLength(3);
    expect(s.getStock('T')?.lastDataUpdate).toBe('2026-01-03');
  });

  it('replaceDatas:空输入早退不清库;非空全量替换(旧行不残留)', async () => {
    const s = newStore();
    await s.ready();
    s.putStock({ ticker: 'T', name: 'n', overview: null, overviewLastUpdate: null, lastDataUpdate: null });
    s.addDatas('T', bars(['2026-01-01']));
    expect(s.replaceDatas('T', [])).toBe(0);
    expect(s.getDatas('T')).toHaveLength(1); // 空输入不清库
    expect(s.replaceDatas('T', bars(['2026-02-01', '2026-02-02']))).toBe(2);
    const got = s.getDatas('T');
    expect(got).toHaveLength(2);
    expect(got[0].date).toBe('2026-02-01'); // 旧 01-01 不残留
    expect(s.getStock('T')?.lastDataUpdate).toBe('2026-02-02');
  });

  it('getDatas 返回新数组:外部改不影响镜像', async () => {
    const s = newStore();
    await s.ready();
    s.addDatas('T', bars(['2026-01-01', '2026-01-02']));
    const got = s.getDatas('T');
    got[0].close = 999;
    expect(s.getDatas('T')).not.toBe(got);
    expect(s.getDatas('T')[0].close).toBe(2);
  });

  it('addPerformanceReports:按 report_date 去重', async () => {
    const s = newStore();
    await s.ready();
    s.addPerformanceReports('T', [
      { report_date: '20260331', fields: { net_profit: 1 } },
      { report_date: '20260630', fields: { net_profit: 2 } },
    ]);
    expect(
      s.addPerformanceReports('T', [
        { report_date: '20260331', fields: { net_profit: 99 } }, // 重复
        { report_date: '20260930', fields: { net_profit: 3 } },
      ]),
    ).toBe(1);
    const reports = s.getPerformanceReports('T');
    expect(reports.map((r) => r.report_date)).toEqual(['20260331', '20260630', '20260930']);
    expect(reports[0].fields).toEqual({ net_profit: 1 });
  });

  it('meta get/set', async () => {
    const s = newStore();
    await s.ready();
    expect(s.getMeta('x')).toBeNull();
    s.setMeta('x', 'v');
    expect(s.getMeta('x')).toBe('v');
  });
});

describe('IdbStore 跨实例持久化(hydrate)', () => {
  it('flush 后新实例(同 factory/库名)hydrate 同数据', async () => {
    const factory = makeIdbFactory();
    const a = newStore(factory);
    await a.ready();
    a.putStock({
      ticker: '600036',
      name: '招商银行',
      overview: { latest_price: 38.8 },
      overviewLastUpdate: '2026-08-07',
      lastDataUpdate: '2026-08-14',
    });
    a.addDatas('600036', bars(['2026-08-13', '2026-08-14']));
    a.addPerformanceReports('600036', [{ report_date: '20260630', fields: { net_profit: 1 } }]);
    a.setMeta('f10:600036', '【主要财务指标】\n净资产收益率: 15.2');
    await a.flush();

    const b = newStore(factory);
    await b.ready();
    expect(b.getStock('600036')?.name).toBe('招商银行');
    expect(b.getStock('600036')?.overview).toEqual({ latest_price: 38.8 });
    expect(b.getStock('600036')?.lastDataUpdate).toBe('2026-08-14');
    expect(b.getDatas('600036').map((x) => x.date)).toEqual(['2026-08-13', '2026-08-14']);
    expect(b.getPerformanceReports('600036').map((r) => r.report_date)).toEqual(['20260630']);
    expect(b.getMeta('f10:600036')).toContain('净资产收益率');
  });

  it('replaceDatas 持久化:旧行落盘清除,新实例只看到替换后数据', async () => {
    const factory = makeIdbFactory();
    const a = newStore(factory);
    await a.ready();
    a.addDatas('T', bars(['2026-01-01']));
    a.replaceDatas('T', bars(['2026-02-01', '2026-02-02']));
    await a.flush();

    const b = newStore(factory);
    await b.ready();
    expect(b.getDatas('T').map((x) => x.date)).toEqual(['2026-02-01', '2026-02-02']);
  });
});

describe('IdbStore 写穿透队列(决策 C:失败仅记录不阻断后续写)', () => {
  it('单 op 落盘失败(事务 abort)→ 后续 op 继续执行,内存镜像不受影响', async () => {
    // 手工 stub factory:readonly(hydrate)恒成功;首个 readwrite 事务 abort,之后成功。
    // put 调用数即「op 确实执行」证据——op1 失败若阻断队列,op2 的 put 不会发生。
    let failNextTx = true;
    const puts: unknown[] = [];
    const stubRequest = <T,>(result: T): IdbRequestLike<T> => {
      const req: IdbRequestLike<T> = { onsuccess: null, onerror: null, result, error: null };
      queueMicrotask(() => req.onsuccess?.(null as unknown as Event));
      return req;
    };
    const stubStore = (): IdbObjectStoreLike => ({
      put(value) {
        puts.push(value);
        return stubRequest(null);
      },
      delete() {
        return stubRequest(null);
      },
      getAll() {
        return stubRequest<unknown[]>([]);
      },
    });
    const stubTx = (mode?: string): IdbTransactionLike => {
      const tx: IdbTransactionLike = {
        objectStore: () => stubStore(),
        oncomplete: null,
        onerror: null,
        onabort: null,
        error: null,
      };
      // macrotask:须在 txDone 同步赋值 oncomplete/onerror 之后再触发
      setTimeout(() => {
        if (mode === 'readwrite' && failNextTx) {
          failNextTx = false;
          tx.onerror?.(null as unknown as Event);
        } else {
          tx.oncomplete?.(null as unknown as Event);
        }
      }, 0);
      return tx;
    };
    const stubDb: IdbDatabaseLike = {
      objectStoreNames: { contains: () => false },
      createObjectStore: () => stubStore(),
      transaction: (_names: string | string[], mode?: string) => stubTx(mode),
      close() {},
    };
    const factory: IdbFactoryLike = {
      open() {
        const req: IdbOpenRequestLike = {
          onsuccess: null,
          onerror: null,
          onupgradeneeded: null,
          result: stubDb,
          error: null,
        };
        queueMicrotask(() => req.onsuccess?.(null as unknown as Event));
        return req;
      },
    };

    const s = new IdbStore(factory, 'soa-queue-fail-test');
    await s.ready(); // hydrate 走 readonly 事务,恒成功
    s.addDatas('T', bars(['2026-01-01', '2026-01-02'])); // op1 → readwrite 事务 abort → 落盘失败
    s.addDatas('T', bars(['2026-01-03', '2026-01-04'])); // op2 → 事务成功
    await s.flush();
    // 内存镜像不受落盘失败影响(同步语义,与 InMemoryStore 一致)
    expect(s.getDatas('T').map((x) => x.date)).toEqual(['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04']);
    // op1 失败后 op2 仍执行了写入(2+2 次 put)——队列未被阻断
    expect(puts).toHaveLength(4);
  });
});

describe('IdbStore close() 排空写穿队列(close 不丢 pending 写)', () => {
  it('enqueue 后立即 close(不显式 flush)→ 未落盘写全部已提交,新实例 hydrate 可见', async () => {
    const factory = makeIdbFactory();
    const a = newStore(factory);
    await a.ready();
    a.putStock({
      ticker: '600036',
      name: '招商银行',
      overview: { latest_price: 38.8 },
      overviewLastUpdate: '2026-08-07',
      lastDataUpdate: '2026-08-14',
    });
    a.addDatas('600036', bars(['2026-08-13', '2026-08-14']));
    a.setMeta('k', 'v');
    // replaceDatas 的落盘 op 在执行时读 bars 内存镜像:close 若先清内存则写 0 行丢数据
    a.replaceDatas('T2', bars(['2026-09-01', '2026-09-02']));
    a.close(); // 无显式 flush;close 实现:清理挂队列尾(先排空 pending 写再清理/关连接)
    await a.flush(); // 队列尾 = close 清理任务;resolve 即 pending 写已提交 + 连接已关
    expect(a.getDatas('T2')).toHaveLength(0); // 清理已随队列执行:内存镜像已清

    const b = newStore(factory);
    await b.ready();
    expect(b.getStock('600036')?.name).toBe('招商银行');
    expect(b.getDatas('600036').map((x) => x.date)).toEqual(['2026-08-13', '2026-08-14']);
    expect(b.getMeta('k')).toBe('v');
    expect(b.getDatas('T2').map((x) => x.date)).toEqual(['2026-09-01', '2026-09-02']);
  });

  it('close 后 enqueue 被阻止:close 之后的改动不再落盘', async () => {
    const factory = makeIdbFactory();
    const a = newStore(factory);
    await a.ready();
    a.close();
    await a.flush();
    a.putStock({
      ticker: 'B',
      name: '复活',
      overview: { latest_price: 1 },
      overviewLastUpdate: '2026-08-07',
      lastDataUpdate: '2026-08-14',
    }); // close 后:enqueue no-op(写穿禁用)
    a.addDatas('B', bars(['2026-08-13']));
    const b = newStore(factory);
    await b.ready();
    expect(b.getStock('B')).toBeNull();
    expect(b.getDatas('B')).toHaveLength(0);
  });
});
