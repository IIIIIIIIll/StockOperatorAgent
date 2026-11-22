// store-node(Node 桌面后端)单测:createNodeFileStore round-trip(node:fs 落盘)、
// runner.setStore ESM live binding、settingsStore node 分支(注入 node fs 适配)。
// 语义断言同 store-file.test.ts(node fs 适配器注入先例)与 settings-store.test.ts
// (_fs 注入先例);测试后清理目录。
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createNodeFileStore,
  decryptSettingsText,
  encryptedSettingsFileSystem,
  encryptSettingsText,
  nodeFsAdapter,
  nodeSettingsFileSystem,
} from '../src/store-node.ts';
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

  it('断电级原子写:写 tmp → fsync(tmp) → rename → fsync(父目录)', async () => {
    // 评审 2026-11-19:旧实现只有 tmp+rename —— 对「进程崩溃」原子,对「断电」
    // 不原子(内容页 / 目录项都可能在缓存里)。这里钉住调用顺序:fsync 必须
    // 发生在 rename **之前**(内容先落盘),rename 之后还要再 fsync 一次父目录。
    const dir = join(baseDir, 'store-fsync');
    await mkdir(dir, { recursive: true });
    const events: string[] = [];
    const atomicFs = {
      async open(path: string) {
        const isTmp = path.includes('.tmp.');
        events.push(`open:${isTmp ? 'tmp' : 'dir'}`);
        return {
          async writeFile() { events.push('write'); },
          async sync() { events.push(`sync:${isTmp ? 'tmp' : 'dir'}`); },
          async close() { events.push('close'); },
        };
      },
      async rename() { events.push('rename'); },
      async unlink() { events.push('unlink'); },
    };
    const adapter = nodeFsAdapter(dir, atomicFs);
    await adapter.writeFile(join(dir, '600036.json'), '{}');

    expect(events).toEqual([
      'open:tmp', 'write', 'sync:tmp', 'close',
      'rename',
      'open:dir', 'sync:dir', 'close',
    ]);
    // 顺序守卫:fsync(tmp) 的下标必须小于 rename 的下标
    expect(events.indexOf('sync:tmp')).toBeLessThan(events.indexOf('rename'));
  });

  it('写入失败 → tmp 被清理,错误上抛(不留残留)', async () => {
    const dir = join(baseDir, 'store-fsync-err');
    await mkdir(dir, { recursive: true });
    const events: string[] = [];
    const adapter = nodeFsAdapter(dir, {
      async open() {
        return {
          async writeFile() { throw new Error('ENOSPC'); },
          async sync() { events.push('sync'); },
          async close() { events.push('close'); },
        };
      },
      async rename() { events.push('rename'); },
      async unlink(p: string) { events.push(`unlink:${p.includes('.tmp.') ? 'tmp' : 'other'}`); },
    });
    await expect(adapter.writeFile(join(dir, 'x.json'), '{}')).rejects.toThrow('ENOSPC');
    expect(events).toEqual(['close', 'unlink:tmp']); // 失败路径不 rename
  });
});

describe('encryptedSettingsFileSystem（设置加密落盘）', () => {
  const KEY = Buffer.alloc(32, 7);
  const SECRET = '{"keys":{"llm":"sk-super-secret"},"switches":{"webSearch":true}}';

  it('明文进 → 磁盘上不存在明文 → 读出逐字节相等', async () => {
    const dir = join(baseDir, 'enc-settings');
    const fs = encryptedSettingsFileSystem(dir, KEY);
    const file = new fs.File(fs.Paths.document, 'soa-settings.json');
    if (!file.exists) file.create();
    file.write(SECRET);

    const onDisk = await readFile(join(dir, 'soa-settings.json'), 'utf8');
    expect(onDisk).not.toContain('sk-super-secret');
    expect(JSON.parse(onDisk).soa_enc).toBe('aes-256-gcm');
    expect(file.textSync()).toBe(SECRET);
  });

  it('旧明文文件 → 原样读出（不炸）→ 下次写自动升级为信封', async () => {
    const dir = join(baseDir, 'enc-settings-legacy');
    const plain = nodeSettingsFileSystem(dir);
    const legacy = new plain.File(plain.Paths.document, 'soa-settings.json');
    if (!legacy.exists) legacy.create();
    legacy.write(SECRET);

    const fs = encryptedSettingsFileSystem(dir, KEY);
    const file = new fs.File(fs.Paths.document, 'soa-settings.json');
    expect(file.textSync()).toBe(SECRET);
    file.write(SECRET);
    expect(await readFile(join(dir, 'soa-settings.json'), 'utf8')).not.toContain('sk-super-secret');
  });

  it('错 key / 被篡改 → 抛（GCM tag 不匹配，不返回半截设置）', async () => {
    const dir = join(baseDir, 'enc-settings-tamper');
    const fs = encryptedSettingsFileSystem(dir, KEY);
    const file = new fs.File(fs.Paths.document, 'soa-settings.json');
    if (!file.exists) file.create();
    file.write(SECRET);
    const path = join(dir, 'soa-settings.json');

    const other = new (encryptedSettingsFileSystem(dir, Buffer.alloc(32, 9)).File)(dir, 'soa-settings.json');
    expect(() => other.textSync()).toThrow();

    const envelope = JSON.parse(await readFile(path, 'utf8'));
    envelope.data = Buffer.from('{"keys":{}}', 'utf8').toString('base64');
    await writeFile(path, JSON.stringify(envelope), 'utf8');
    expect(() => file.textSync()).toThrow();
  });

  it('key 长度不是 32 字节 → 立即报错（不静默降级成明文）', () => {
    expect(() => encryptedSettingsFileSystem(join(baseDir, 'bad'), Buffer.alloc(16))).toThrow('32 字节');
  });

  it('信封往返 + 每次 iv 不同', () => {
    const a = encryptSettingsText(SECRET, KEY);
    const b = encryptSettingsText(SECRET, KEY);
    expect(a).not.toBe(b); // 随机 iv
    expect(decryptSettingsText(a, KEY)).toBe(SECRET);
    expect(decryptSettingsText(SECRET, KEY)).toBe(SECRET); // 明文透传
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
    try {
      // live binding:同一绑定(已 import 方)同步读到新值,且按新 store 行为工作
      expect(store).toBe(fake);
      expect(store.getMeta('anything')).toBe('fake-meta');
    } finally {
      setStore(original); // 还原,不污染同文件其他用例
    }
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
