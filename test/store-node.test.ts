// store-node(Node 桌面后端)单测:createNodeFileStore round-trip(node:fs 落盘)、
// runner.setStore ESM live binding、settingsStore node 分支(注入 node fs 适配)。
// 语义断言同 store-file.test.ts(node fs 适配器注入先例)与 settings-store.test.ts
// (_fs 注入先例);测试后清理目录。
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileStore, nodeFsAdapter, nodeSettingsFileSystem } from '../src/store-node.ts';
import type { StoreLike } from '../src/store.ts';
import { setStore, store } from '../app/lib/runner.ts';
import { createSettingsStore } from '../app/lib/settingsStore.ts';

let baseDir: string;

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'soa-store-node-test-'));
});

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

describe('createNodeFileStore round-trip(node:fs 落盘)', () => {
  it('putStock/getStock + setMeta/getMeta → flush → 跨实例 hydrate 读回', async () => {
    const dir = join(baseDir, 'store');
    const s1 = createNodeFileStore(dir);
    await s1.ready();
    s1.putStock({
      ticker: '600036',
      name: '招商银行',
      overview: { latest_price: 38.8 },
      overviewLastUpdate: '2026-08-07',
      lastDataUpdate: '2026-08-14',
    });
    s1.setMeta('f10:600036', '【主要财务指标】\n净资产收益率: 15.2');
    await s1.flush();

    const s2 = createNodeFileStore(dir);
    await s2.ready();
    expect(s2.getStock('600036')?.name).toBe('招商银行');
    expect(s2.getStock('600036')?.overview).toEqual({ latest_price: 38.8 });
    expect(s2.getMeta('f10:600036')).toContain('净资产收益率');
    expect(s2.getMeta('missing')).toBeNull();
  });

  it('addDatas → 跨实例 hydrate 读回(日K 落盘)', async () => {
    const dir = join(baseDir, 'store2');
    const s1 = createNodeFileStore(dir);
    await s1.ready();
    s1.putStock({ ticker: 'T', name: 'n', overview: null, overviewLastUpdate: null, lastDataUpdate: null });
    s1.addDatas('T', [
      { date: '2026-01-01', open: 1, close: 2, high: 3, low: 0.5, volume: 100 },
      { date: '2026-01-02', open: 2, close: 3, high: 4, low: 1, volume: 200 },
    ]);
    await s1.flush();

    const s2 = createNodeFileStore(dir);
    await s2.ready();
    expect(s2.getDatas('T').map((x) => x.date)).toEqual(['2026-01-01', '2026-01-02']);
  });

  it('F12:readFile 仅 ENOENT → null;目录(EISDIR)等错误上抛不吞', async () => {
    const dir = join(baseDir, 'store-f12');
    await mkdir(dir, { recursive: true });
    await mkdir(join(dir, 'is-a-dir.json'), { recursive: true }); // 目录伪装 ticker 文件
    const adapter = nodeFsAdapter(dir);
    await expect(adapter.readFile(join(dir, 'missing.json'))).resolves.toBeNull();
    await expect(adapter.readFile(join(dir, 'is-a-dir.json'))).rejects.toThrow(); // EISDIR 上抛
  });
});

describe('runner.setStore ESM live binding', () => {
  it('注入 fake store 后 runner 的 store 导出读取到新值', () => {
    const original = store; // 模块级初始实例(FileStore)
    const fake: StoreLike = {
      close() {},
      getStock: () => null,
      putStock() {},
      addDatas: () => 0,
      addPerformanceReports: () => 0,
      getDatas: () => [],
      replaceDatas: () => 0,
      getPerformanceReports: () => [],
      getMeta: () => 'fake-meta',
      setMeta() {},
    };
    setStore(fake);
    // live binding:同一绑定(已 import 方)同步读到新值,且按新 store 行为工作
    expect(store).toBe(fake);
    expect(store.getMeta('anything')).toBe('fake-meta');
    setStore(original); // 还原,不污染同文件其他用例
    expect(store).toBe(original);
  });
});

describe('settingsStore node 分支(注入 node fs 适配器)', () => {
  it('缺失文件 → null;save → load round-trip(落盘 soa-settings.json)', () => {
    const dir = join(baseDir, 'settings');
    const settingsStore = createSettingsStore(null, nodeSettingsFileSystem(dir));
    expect(settingsStore.load()).toBeNull(); // 文件不存在(exists=false → 不调 textSync)
    settingsStore.save('{"switches":{"webSearch":false}}');
    expect(settingsStore.load()).toBe('{"switches":{"webSearch":false}}');
  });

  it('存储内容为损坏 JSON 字符串 → load 原样返回(存储层透明,不解析不抛出)', () => {
    const dir = join(baseDir, 'settings2');
    const settingsStore = createSettingsStore(null, nodeSettingsFileSystem(dir));
    settingsStore.save('{not-json'); // 写坏串
    expect(settingsStore.load()).toBe('{not-json'); // JSON 解析/兜底在 settings.ts 层
  });
});
