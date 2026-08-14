// FileStore 单测:node fs 适配器 + os.tmpdir 子目录(设计 §5;RN 无模拟器,
// 以单测 + 类型检查覆盖,真机待验证)。语义断言同 store-gates/store-idb 约定;
// 覆盖落盘/读回、去重、新数组、replaceDatas、meta;测试后清理目录。
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile as fsReadFile, readdir, rm, writeFile as fsWriteFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStore, type FileFsAdapter } from '../src/store-file.ts';
import type { DailyBar } from '../src/store.ts';

function bars(dates: string[]): DailyBar[] {
  return dates.map((date) => ({ date, open: 1, close: 2, high: 3, low: 0.5, volume: 100 }));
}

/** node fs 适配器:readFile 缺文件返回 null(listDir 之前文件不存在时用)。 */
function nodeAdapter(baseDir: string): FileFsAdapter {
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
      return readdir(baseDir);
    },
  };
}

let baseDir: string;
let store: FileStore;

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'soa-store-test-'));
  store = new FileStore(baseDir, nodeAdapter(baseDir));
});

afterEach(async () => {
  await store.flush(); // 等写队列排空再清理目录(避免与异步落盘竞争)
  await rm(baseDir, { recursive: true, force: true });
});

describe('FileStore 内存镜像语义(对齐 InMemoryStore/Store)', () => {
  it('addDatas:增量去重(date<=last 拒绝) + lastDataUpdate 更新', async () => {
    await store.ready();
    expect(store.addDatas('T', bars(['2026-01-01', '2026-01-02']))).toBe(2);
    expect(store.addDatas('T', bars(['2026-01-01', '2026-01-02']))).toBe(0); // 全部重复 → 0 不写
    expect(store.getDatas('T')).toHaveLength(2);
    expect(store.addDatas('T', bars(['2026-01-02', '2026-01-03']))).toBe(1); // 部分新增
    expect(store.getDatas('T')).toHaveLength(3);
    store.putStock({ ticker: 'T', name: 'n', overview: null, overviewLastUpdate: null, lastDataUpdate: '2026-01-01' });
    store.addDatas('T', bars(['2026-01-03', '2026-01-04']));
    expect(store.getStock('T')?.lastDataUpdate).toBe('2026-01-04');
  });

  it('replaceDatas:空输入早退不清库;非空全量替换(旧行不残留)', async () => {
    await store.ready();
    store.putStock({ ticker: 'T', name: 'n', overview: null, overviewLastUpdate: null, lastDataUpdate: null });
    store.addDatas('T', bars(['2026-01-01']));
    expect(store.replaceDatas('T', [])).toBe(0);
    expect(store.getDatas('T')).toHaveLength(1); // 空输入不清库
    expect(store.replaceDatas('T', bars(['2026-02-01', '2026-02-02']))).toBe(2);
    const got = store.getDatas('T');
    expect(got).toHaveLength(2);
    expect(got[0].date).toBe('2026-02-01'); // 旧 01-01 不残留
    expect(store.getStock('T')?.lastDataUpdate).toBe('2026-02-02');
  });

  it('getDatas 返回新数组:外部改不影响镜像', async () => {
    await store.ready();
    store.addDatas('T', bars(['2026-01-01', '2026-01-02']));
    const got = store.getDatas('T');
    got[0].close = 999;
    expect(store.getDatas('T')).not.toBe(got);
    expect(store.getDatas('T')[0].close).toBe(2);
  });

  it('addPerformanceReports:按 report_date 去重', async () => {
    await store.ready();
    store.addPerformanceReports('T', [
      { report_date: '20260331', fields: { net_profit: 1 } },
      { report_date: '20260630', fields: { net_profit: 2 } },
    ]);
    expect(
      store.addPerformanceReports('T', [
        { report_date: '20260331', fields: { net_profit: 99 } }, // 重复
        { report_date: '20260930', fields: { net_profit: 3 } },
      ]),
    ).toBe(1);
    const reports = store.getPerformanceReports('T');
    expect(reports.map((r) => r.report_date)).toEqual(['20260331', '20260630', '20260930']);
    expect(reports[0].fields).toEqual({ net_profit: 1 });
  });
});

describe('FileStore 落盘/读回(跨实例 hydrate)', () => {
  it('mutator → flush → 文件真实存在,新实例读回同数据', async () => {
    await store.ready();
    store.putStock({
      ticker: '600036',
      name: '招商银行',
      overview: { latest_price: 38.8 },
      overviewLastUpdate: '2026-08-07',
      lastDataUpdate: '2026-08-14',
    });
    store.addDatas('600036', bars(['2026-08-13', '2026-08-14']));
    store.addPerformanceReports('600036', [{ report_date: '20260630', fields: { net_profit: 1 } }]);
    await store.flush();

    // 文件真实落盘(<ticker>.json 含 {stock,bars,reports})
    const raw = JSON.parse(await fsReadFile(join(baseDir, '600036.json'), 'utf8')) as {
      stock: { name: string };
      bars: DailyBar[];
      reports: Array<{ report_date: string }>;
    };
    expect(raw.stock.name).toBe('招商银行');
    expect(raw.bars).toHaveLength(2);
    expect(raw.reports).toHaveLength(1);

    const s2 = new FileStore(baseDir, nodeAdapter(baseDir));
    await s2.ready();
    expect(s2.getStock('600036')?.overview).toEqual({ latest_price: 38.8 });
    expect(s2.getStock('600036')?.lastDataUpdate).toBe('2026-08-14');
    expect(s2.getDatas('600036').map((x) => x.date)).toEqual(['2026-08-13', '2026-08-14']);
    expect(s2.getPerformanceReports('600036').map((r) => r.report_date)).toEqual(['20260630']);
  });

  it('replaceDatas 落盘:新实例只看到替换后数据', async () => {
    await store.ready();
    store.addDatas('T', bars(['2026-01-01']));
    store.replaceDatas('T', bars(['2026-02-01', '2026-02-02']));
    await store.flush();

    const s2 = new FileStore(baseDir, nodeAdapter(baseDir));
    await s2.ready();
    expect(s2.getDatas('T').map((x) => x.date)).toEqual(['2026-02-01', '2026-02-02']);
  });

  it('meta 落盘/读回(meta.json 为 Record<string,string>)', async () => {
    await store.ready();
    store.setMeta('f10:600036', '【主要财务指标】\n净资产收益率: 15.2');
    store.setMeta('capital:600036', '总股本: 100000.0万股\n流通股本: 90000.0万股');
    await store.flush();

    const raw = JSON.parse(await fsReadFile(join(baseDir, 'meta.json'), 'utf8')) as Record<string, string>;
    expect(raw['f10:600036']).toContain('净资产收益率');
    expect(raw['capital:600036']).toContain('流通股本');

    const s2 = new FileStore(baseDir, nodeAdapter(baseDir));
    await s2.ready();
    expect(s2.getMeta('capital:600036')).toContain('流通股本');
    expect(s2.getMeta('missing')).toBeNull();
  });
});
