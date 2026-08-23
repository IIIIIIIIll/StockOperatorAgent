// updateOverview 四实现行为矩阵 + FileStore listStocks/listMetaKeys 单测
// (repo review 整改 E2/E3:此前 updateOverview 全族零测试 —— store.ts:174-178 /
// store-memory.ts:61-66 / store-file.ts:225-230 / store-idb.ts:345-351;
// listStocks/listMetaKeys(store-file.ts:251-259,桌面桥枚举面,不在 StoreLike)
// 仅被 desktop child/probe 消费而无单测。)
// 断言语义:① 命中 → 覆盖 overview + 更新 overviewLastUpdate(其余字段不动);
// ② 未命中 → 无操作(不创建记录);③ 新对象整体替换(旧字段不残留)。
// 构造照搬既有先例:Store :memory:(store-gates.test.ts:34-41)、FileStore
// node fs 适配器 + os.tmpdir 子目录 + flush 排空写队列(store-file.test.ts:16-45)、
// IdbStore fake-indexeddb 每用例独立 factory(store-idb.test.ts:16-25)。
// U26 约束:仅新建本文件,不改既有测试/源码。
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile as fsReadFile, readdir, rm, writeFile as fsWriteFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import 'fake-indexeddb/auto'; // 安装 globalThis.indexedDB/IDBKeyRange(fake-indexeddb 6.2.5)
import { IDBFactory } from 'fake-indexeddb';
import { Store, type StockRecord } from '../src/store.ts';
import { InMemoryStore } from '../src/store-memory.ts';
import { FileStore, type FileFsAdapter } from '../src/store-file.ts';
import { IdbStore, type IdbFactoryLike } from '../src/store-idb.ts';

/** StockRecord 工厂:updateOverview 用例只关心 name/overview/盖章位。 */
function stockRec(ticker: string, over: Partial<StockRecord> = {}): StockRecord {
  return { ticker, name: 'n', overview: null, overviewLastUpdate: null, lastDataUpdate: null, ...over };
}

describe('Store.updateOverview(SQLite :memory:,E2)', () => {
  it('已存在 ticker:覆盖 overview + 更新 overviewLastUpdate(name 不受影响)', () => {
    const s = new Store();
    s.putStock(stockRec('600036', { name: '招商银行' }));
    s.updateOverview('600036', { pe_ttm: 6.1 }, '2026-08-02');
    const got = s.getStock('600036');
    expect(got?.overview).toEqual({ pe_ttm: 6.1 });
    expect(got?.overviewLastUpdate).toBe('2026-08-02');
    expect(got?.name).toBe('招商银行');
    s.close();
  });

  it('不存在的 ticker:UPDATE 影响 0 行,无操作(不创建记录,getStock 仍 null)', () => {
    const s = new Store();
    s.updateOverview('000001', { pe_ttm: 5 }, '2026-08-02');
    expect(s.getStock('000001')).toBeNull();
    s.close();
  });

  it('整体替换语义:新对象整体覆盖,旧字段不残留', () => {
    const s = new Store();
    s.putStock(stockRec('T', { overview: { stale_field: 1, pe_ttm: 9 }, overviewLastUpdate: '2026-08-01' }));
    s.updateOverview('T', { pb: 0.8 }, '2026-08-02');
    const got = s.getStock('T');
    expect(got?.overview).toEqual({ pb: 0.8 }); // toEqual 精确匹配 → stale_field/pe_ttm 已清除
    expect(got?.overviewLastUpdate).toBe('2026-08-02');
    s.close();
  });
});

describe('InMemoryStore.updateOverview(E2)', () => {
  it('已存在 ticker:覆盖 overview + 更新 overviewLastUpdate(name 不受影响)', () => {
    const s = new InMemoryStore();
    s.putStock(stockRec('600036', { name: '招商银行' }));
    s.updateOverview('600036', { pe_ttm: 6.1 }, '2026-08-02');
    const got = s.getStock('600036');
    expect(got?.overview).toEqual({ pe_ttm: 6.1 });
    expect(got?.overviewLastUpdate).toBe('2026-08-02');
    expect(got?.name).toBe('招商银行');
  });

  it('不存在的 ticker:无操作(不创建记录,getStock 仍 null)', () => {
    const s = new InMemoryStore();
    s.updateOverview('000001', { pe_ttm: 5 }, '2026-08-02');
    expect(s.getStock('000001')).toBeNull();
  });

  it('整体替换语义:新对象整体覆盖,旧字段不残留', () => {
    const s = new InMemoryStore();
    s.putStock(stockRec('T', { overview: { stale_field: 1, pe_ttm: 9 }, overviewLastUpdate: '2026-08-01' }));
    s.updateOverview('T', { pb: 0.8 }, '2026-08-02');
    const got = s.getStock('T');
    expect(got?.overview).toEqual({ pb: 0.8 });
    expect(got?.overviewLastUpdate).toBe('2026-08-02');
  });
});

describe('FileStore(node fs 适配器注入 + tmp 目录,E2+E3)', () => {
  /** node fs 适配器(照搬 store-file.test.ts:16-32;readFile 缺文件返回 null)。 */
  function nodeAdapter(dir: string): FileFsAdapter {
    return {
      async readFile(path) {
        try {
          return await fsReadFile(path, 'utf8');
        } catch {
          return null;
        }
      },
      async writeFile(path, data) {
        await fsWriteFile(path, data, 'utf8');
      },
      async listDir() {
        return readdir(dir);
      },
    };
  }

  let baseDir: string;
  let store: FileStore;

  /** 同目录新实例:flush 后经 hydrate 验证落盘态(跨实例读回先例 store-node.test.ts:25-44)。 */
  async function respawn(): Promise<FileStore> {
    const s = new FileStore(baseDir, nodeAdapter(baseDir));
    await s.ready();
    return s;
  }

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'soa-store-test-'));
    store = new FileStore(baseDir, nodeAdapter(baseDir));
    await store.ready();
  });

  afterEach(async () => {
    await store.flush(); // 等写队列排空再清理目录(避免与异步落盘竞争,store-file.test.ts:43)
    await rm(baseDir, { recursive: true, force: true });
  });

  describe('updateOverview(E2)', () => {
    it('已存在 ticker:内存覆盖;flush 后跨实例 hydrate 读回新 overview/盖章', async () => {
      store.putStock(stockRec('600036', { name: '招商银行' }));
      store.updateOverview('600036', { pe_ttm: 6.1 }, '2026-08-02');
      expect(store.getStock('600036')?.overview).toEqual({ pe_ttm: 6.1 });
      await store.flush();
      const got = (await respawn()).getStock('600036');
      expect(got?.overview).toEqual({ pe_ttm: 6.1 });
      expect(got?.overviewLastUpdate).toBe('2026-08-02');
      expect(got?.name).toBe('招商银行');
    });

    it('不存在的 ticker:无操作且不入队落盘(flush 后仍无记录)', async () => {
      store.updateOverview('000001', { pe_ttm: 5 }, '2026-08-02');
      expect(store.getStock('000001')).toBeNull();
      await store.flush();
      const s2 = await respawn();
      expect(s2.getStock('000001')).toBeNull();
      expect(s2.listStocks()).toEqual([]); // 枚举面同样无此键
    });

    it('整体替换语义:旧字段不残留(内存与落盘读回一致)', async () => {
      store.putStock(stockRec('T', { overview: { stale_field: 1, pe_ttm: 9 }, overviewLastUpdate: '2026-08-01' }));
      store.updateOverview('T', { pb: 0.8 }, '2026-08-02');
      expect(store.getStock('T')?.overview).toEqual({ pb: 0.8 });
      await store.flush();
      expect((await respawn()).getStock('T')?.overview).toEqual({ pb: 0.8 });
    });
  });

  describe('listStocks/listMetaKeys(E3,具体类方法不在 StoreLike)', () => {
    it('空库:两方法均返回空数组', () => {
      expect(store.listStocks()).toEqual([]);
      expect(store.listMetaKeys()).toEqual([]);
    });

    it('putStock/setMeta 后返回全部键集(sort 归一 → 集合语义,不耦合顺序)', () => {
      store.putStock(stockRec('600036'));
      store.putStock(stockRec('0700.HK'));
      store.setMeta('f10:600036', '【主要财务指标】');
      store.setMeta('lastRun', '{"ticker":"600036","market":"CN"}');
      expect(store.listStocks().sort()).toEqual(['0700.HK', '600036']);
      expect(store.listMetaKeys().sort()).toEqual(['f10:600036', 'lastRun']);
    });

    it('updateOverview 未命中不产生新键(与 E2 无操作语义在枚举面上一致)', () => {
      store.updateOverview('ghost', { pe_ttm: 1 }, '2026-08-02');
      expect(store.listStocks()).toEqual([]);
    });
  });
});

describe('IdbStore.updateOverview(fake-indexeddb 每用例独立 factory,E2)', () => {
  const DB_NAME = 'soa-store-test';

  /** 每用例独立 factory(互不串库);同 factory 同库名 = 跨实例共享同一落盘。
   *  根 tsconfig 带 DOM lib 后 fake-indexeddb 的 IDBFactory 不再结构匹配
   *  手写 IdbFactoryLike(仅测试面差异,运行时不变),统一经此适配
   *  (store-idb.test.ts:19-21 同款)。 */
  function makeIdbFactory(): IdbFactoryLike {
    return new (IDBFactory as unknown as new () => IdbFactoryLike)();
  }

  async function spawn(factory: IdbFactoryLike): Promise<IdbStore> {
    const s = new IdbStore(factory, DB_NAME);
    await s.ready();
    return s;
  }

  it('已存在 ticker:内存覆盖;flush 后跨实例 hydrate 读回新 overview/盖章', async () => {
    const factory = makeIdbFactory();
    const s = await spawn(factory);
    s.putStock(stockRec('600036', { name: '招商银行' }));
    s.updateOverview('600036', { pe_ttm: 6.1 }, '2026-08-02');
    expect(s.getStock('600036')?.overview).toEqual({ pe_ttm: 6.1 });
    await s.flush();
    const got = (await spawn(factory)).getStock('600036');
    expect(got?.overview).toEqual({ pe_ttm: 6.1 });
    expect(got?.overviewLastUpdate).toBe('2026-08-02');
  });

  it('不存在的 ticker:无操作(不创建记录,flush 后仍 null)', async () => {
    const factory = makeIdbFactory();
    const s = await spawn(factory);
    s.updateOverview('000001', { pe_ttm: 5 }, '2026-08-02');
    expect(s.getStock('000001')).toBeNull();
    await s.flush();
    expect((await spawn(factory)).getStock('000001')).toBeNull();
  });

  it('整体替换语义:旧字段不残留(内存与落盘读回一致)', async () => {
    const factory = makeIdbFactory();
    const s = await spawn(factory);
    s.putStock(stockRec('T', { overview: { stale_field: 1, pe_ttm: 9 }, overviewLastUpdate: '2026-08-01' }));
    s.updateOverview('T', { pb: 0.8 }, '2026-08-02');
    expect(s.getStock('T')?.overview).toEqual({ pb: 0.8 });
    await s.flush();
    expect((await spawn(factory)).getStock('T')?.overview).toEqual({ pb: 0.8 });
  });
});
