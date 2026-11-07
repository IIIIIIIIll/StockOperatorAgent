// 分析历史归档后端单测 —— IndexedDB(web/桌面, fake-indexeddb)+ 文件(RN 形状,
// 注入 node fs 适配器)+ 内存。覆盖 PRD R4/R8:摘要列表轻量、正文按需、删除/清空、
// 索引损坏重建、跨实例持久化。
import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { mkdtemp, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createFileRunArchive,
  createIdbRunArchive,
  type RunFsAdapter,
} from '../app/lib/runArchive.ts';
import { createMemoryRunArchive } from './fixtures/memoryRunArchive.ts';
import type { AnalysisRun } from '../src/runHistory.ts';

function run(over: Partial<AnalysisRun> = {}): AnalysisRun {
  return {
    id: 'r1',
    at: '2026-11-04T01:30:00.000Z',
    mode: 'real',
    ticker: '600036',
    market: 'cn',
    stock_information: '【采集数据】招商银行',
    final_decision: '买入并持有',
    opinions: [{ key: 'fundamental_analysis', tabTitle: '基本面分析', content: '稳健' }],
    ...over,
  };
}

function freshDbName(): string {
  return `soa-runs-test-${Math.random().toString(36).slice(2, 10)}`;
}

describe('RunArchive · 内存后端', () => {
  it('put/list 时间倒序 + load 副本 + remove/clear 计数', async () => {
    const archive = createMemoryRunArchive();
    await archive.put(run({ id: 'old', at: '2026-11-01T00:00:00.000Z' }));
    await archive.put(run({ id: 'new', at: '2026-11-04T00:00:00.000Z' }));

    expect((await archive.list()).map((s) => s.id)).toEqual(['new', 'old']);
    const loaded = await archive.load('new');
    expect(loaded?.ticker).toBe('600036');
    // 副本:改返回值不影响存储
    if (loaded) loaded.opinions[0].content = 'changed';
    expect((await archive.load('new'))?.opinions[0].content).toBe('稳健');

    expect(await archive.remove(['new', 'missing'])).toBe(1);
    expect((await archive.list()).map((s) => s.id)).toEqual(['old']);
    await archive.clear();
    expect(await archive.list()).toEqual([]);
    expect(await archive.load('old')).toBeNull();
  });
});

describe('RunArchive · IndexedDB 后端', () => {
  it('put/list/load/remove/clear + 跨实例持久化(同一 dbName)', async () => {
    const factory = new IDBFactory();
    const dbName = freshDbName();
    const archive = createIdbRunArchive({ factory, dbName });

    await archive.put(run({ id: 'a', at: '2026-11-01T00:00:00.000Z', final_decision: '# 观望\n等回踩' }));
    await archive.put(run({ id: 'b', at: '2026-11-04T00:00:00.000Z', ticker: '00700.HK', market: 'hk' }));

    const list = await archive.list();
    expect(list.map((s) => s.id)).toEqual(['b', 'a']);
    expect(list[1].decisionPreview).toBe('观望');
    expect(list[0].market).toBe('hk');

    const loaded = await archive.load('a');
    expect(loaded?.opinions).toHaveLength(1);
    expect(await archive.load('missing')).toBeNull();

    // 新实例(同 DB)读到同一批数据 = 真的落库而非进程内 memo
    const archive2 = createIdbRunArchive({ factory, dbName });
    expect((await archive2.list()).map((s) => s.id)).toEqual(['b', 'a']);
    expect((await archive2.load('b'))?.ticker).toBe('00700.HK');

    expect(await archive.remove(['a'])).toBe(1);
    expect((await archive.list()).map((s) => s.id)).toEqual(['b']);
    // R-06:返回值是实际删除数(delete() 对不存在的 key 不报错)
    expect(await archive.remove(['missing'])).toBe(0);
    expect(await archive.remove(['b', 'missing'])).toBe(1);
    expect(await archive.list()).toEqual([]);
    await archive.clear();
    expect(await archive.list()).toEqual([]);
    expect(await archive.load('b')).toBeNull();
  });

  it('非法 id(含路径分隔符)拒绝,不污染索引', async () => {
    const archive = createIdbRunArchive({ factory: new IDBFactory(), dbName: freshDbName() });
    await expect(archive.put(run({ id: '../evil' }))).rejects.toThrow('非法历史 id');
    expect(await archive.list()).toEqual([]);
  });

  it('无 indexedDB 全局且未注入 factory → 明确拒绝(不静默成功)', async () => {
    // fake-indexeddb 未注册到全局时(idbFactoryOf 读 globalThis.indexedDB)
    const archive = createIdbRunArchive({ dbName: freshDbName() });
    await expect(archive.list()).rejects.toThrow(/IndexedDB 不可用/);
  });
});

// ─── 文件后端(node fs 适配器 = RN expo 适配器同形状)─────────────────────────
function nodeRunFs(dir: string): RunFsAdapter {
  return {
    async read(name) {
      try {
        return await readFile(path.join(dir, name), 'utf8');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw err;
      }
    },
    async write(name, data) {
      const tmp = path.join(dir, `${name}.tmp.${Math.random().toString(36).slice(2, 8)}`);
      await writeFile(tmp, data, 'utf8');
      await rename(tmp, path.join(dir, name));
    },
    async remove(name) {
      try {
        await unlink(path.join(dir, name));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    },
    async list() {
      return readdir(dir);
    },
  };
}

async function makeArchive(): Promise<{ dir: string; archive: ReturnType<typeof createFileRunArchive> }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'soa-runs-'));
  return { dir, archive: createFileRunArchive(async () => nodeRunFs(dir)) };
}

describe('RunArchive · 文件后端(RN 形状)', () => {
  it('put 写正文 + index;list 只读 index;load 按需读正文', async () => {
    const { dir, archive } = await makeArchive();
    await archive.put(run({ id: '2026-11-04T01-30-00-000Z-abcd', final_decision: '## 买入' }));

    const files = await readdir(dir);
    expect(files.sort()).toEqual(['2026-11-04T01-30-00-000Z-abcd.json', 'index.json']);
    const index = JSON.parse(await readFile(path.join(dir, 'index.json'), 'utf8'));
    expect(index).toHaveLength(1);
    expect(index[0].decisionPreview).toBe('买入');

    const list = await archive.list();
    expect(list.map((s) => s.id)).toEqual(['2026-11-04T01-30-00-000Z-abcd']);
    expect(await archive.load('2026-11-04T01-30-00-000Z-abcd')).not.toBeNull();
    expect(await archive.load('missing')).toBeNull();
  });

  it('索引损坏/缺失 → 从正文重建(正文是真值来源)', async () => {
    const { dir, archive } = await makeArchive();
    await archive.put(run({ id: 'r1' }));
    await archive.put(run({ id: 'r2', at: '2026-11-05T00:00:00.000Z' }));

    // 损坏索引 → 新实例(无内存缓存)重建
    await writeFile(path.join(dir, 'index.json'), '{oops', 'utf8');
    const rebuilt = createFileRunArchive(async () => nodeRunFs(dir));
    expect((await rebuilt.list()).map((s) => s.id)).toEqual(['r2', 'r1']);
    // 重建结果回写索引
    const index = JSON.parse(await readFile(path.join(dir, 'index.json'), 'utf8'));
    expect(index).toHaveLength(2);
  });

  it('remove 删正文与索引条目;clear 清空目录内 json', async () => {
    const { dir, archive } = await makeArchive();
    await archive.put(run({ id: 'r1' }));
    await archive.put(run({ id: 'r2', at: '2026-11-05T00:00:00.000Z' }));

    expect(await archive.remove(['r1', 'nope'])).toBe(1);
    expect(await readdir(dir)).not.toContain('r1.json');
    expect((await archive.list()).map((s) => s.id)).toEqual(['r2']);

    await archive.clear();
    expect(await archive.list()).toEqual([]);
    expect((await readdir(dir)).filter((n) => n.endsWith('.json'))).toEqual(['index.json']);
  });

  it('跨实例持久化:新实例从 index 恢复(不依赖内存缓存)', async () => {
    const { dir, archive } = await makeArchive();
    await archive.put(run({ id: 'r1' }));
    const reopened = createFileRunArchive(async () => nodeRunFs(dir));
    expect((await reopened.list()).map((s) => s.id)).toEqual(['r1']);
    expect((await reopened.load('r1'))?.final_decision).toBe('买入并持有');
  });

  it('损坏正文条目在重建时跳过,不拖垮整表', async () => {
    const { dir, archive } = await makeArchive();
    await archive.put(run({ id: 'good' }));
    await writeFile(path.join(dir, 'broken.json'), '{nope', 'utf8');
    await unlink(path.join(dir, 'index.json'));

    const rebuilt = createFileRunArchive(async () => nodeRunFs(dir));
    expect((await rebuilt.list()).map((s) => s.id)).toEqual(['good']);
  });
  // R-10:能解析但为空的索引('{}' / '[]')原本直接返回 [] → 磁盘上的记录
  // 永久消失(只有正文文件是真值来源)。
  it('索引为空对象/空数组 → 仍从正文重建,记录不消失', async () => {
    const { dir, archive } = await makeArchive();
    await archive.put(run({ id: 'r1' }));
    for (const garbage of ['{}', '[]', 'null']) {
      await writeFile(path.join(dir, 'index.json'), garbage, 'utf8');
      const rebuilt = createFileRunArchive(async () => nodeRunFs(dir));
      expect((await rebuilt.list()).map((s) => s.id)).toEqual(['r1']);
    }
  });

  // R-09:索引是读改写 —— 并发 put 不得互相覆盖,同 id 去重。
  it('并发写入不丢索引条目(同 id 去重)', async () => {
    const { dir } = await makeArchive();
    const archive = createFileRunArchive(async () => nodeRunFs(dir));
    await Promise.all([
      archive.put(run({ id: 'a', at: '2026-11-01T00:00:00.000Z' })),
      archive.put(run({ id: 'b', at: '2026-11-02T00:00:00.000Z' })),
      archive.put(run({ id: 'b', at: '2026-11-02T00:00:00.000Z', final_decision: '减持' })),
      archive.list(),
    ]);
    expect((await archive.list()).map((s) => s.id)).toEqual(['b', 'a']);
    // 落盘结果一致(新实例从 index 读回两条)
    const reopened = createFileRunArchive(async () => nodeRunFs(dir));
    expect((await reopened.list()).map((s) => s.id)).toEqual(['b', 'a']);
    expect((await reopened.load('b'))?.final_decision).toBe('减持');
  });

  // R-24:正文写成功但 writeIndex 失败 → 该正文不在索引里,原来既删不掉
  // 也会在下次重建时复活。
  it('remove 能删掉不在索引里的孤儿正文', async () => {
    const { dir, archive } = await makeArchive();
    await archive.put(run({ id: 'r1' }));
    await writeFile(path.join(dir, 'r9.json'), JSON.stringify(run({ id: 'r9' })), 'utf8');

    expect(await archive.remove(['r9'])).toBe(0); // 计数只算索引内(调用方面向列表)
    expect(await readdir(dir)).not.toContain('r9.json'); // 但孤儿文件真的删了
    expect((await archive.list()).map((s) => s.id)).toEqual(['r1']);
  });

  // R-24:write/move 抛错留下的 <name>.tmp.* 不得越积越多。
  it('写失败后清理本次的 tmp 残留', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'soa-run-tmp-'));
    const base = nodeRunFs(dir);
    const failing: RunFsAdapter = {
      ...base,
      async write(name, data) {
        if (name === 'r1.json') {
          await writeFile(path.join(dir, `${name}.tmp.123`), 'partial', 'utf8');
          throw new Error('disk full');
        }
        return base.write(name, data);
      },
    };
    const archive = createFileRunArchive(async () => failing);
    await expect(archive.put(run({ id: 'r1' }))).rejects.toThrow('disk full');
    expect(await readdir(dir)).not.toContain('r1.json.tmp.123');
    // 队列未被污染:失败后仍可正常写入
    await archive.put(run({ id: 'r2' }));
    expect((await archive.list()).map((s) => s.id)).toEqual(['r2']);
  });

  // CR-29:put 写正文成功但 writeIndex 失败/崩溃 → 索引可解析且非空,旧实现
  // 永不重建 → 孤儿正文重启后从列表消失。以目录正文数为基准对账。
  it('索引可解析但少于正文文件 → 按正文重建(孤儿记录可见)', async () => {
    const { dir, archive } = await makeArchive();
    await archive.put(run({ id: 'r1', at: '2026-11-03T02:00:00.000Z' }));
    // 模拟写完正文、更新索引前崩溃:直接落 r2.json,不改 index.json
    await writeFile(
      path.join(dir, 'r2.json'),
      JSON.stringify(run({ id: 'r2', at: '2026-11-04T02:00:00.000Z' })),
      'utf8',
    );
    const reopened = createFileRunArchive(async () => nodeRunFs(dir));
    expect((await reopened.list()).map((s) => s.id)).toEqual(['r2', 'r1']);
  });
});
