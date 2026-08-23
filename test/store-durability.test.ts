// 存储耐久性回归(08-23 评审 F1/F2 存储组):
// - F1① FileStore.hydrate 逐文件容错:截断/畸形 JSON 仅跳过该文件(logError),
//   其余 ticker 文件与 meta 照常可用;崩溃残留 tmp(<x>.json.tmp.*)按命名契约
//   不被 hydrate 扫描。
// - F1② nodeFsAdapter 原子写(tmp + fsRename):落盘读回一致、成功后目录无
//   tmp 残留、重复写覆盖旧内容;FileStore × nodeFsAdapter 端到端集成。
// - F2(desktop requestSingleInstanceLock)是 Electron 主进程行为,desktop 无
//   vitest —— 验收为手动双开步骤记录,见任务 notes,不在本套件断言。
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, readFile as fsReadFile, rm, writeFile as fsWriteFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStore } from '../src/store-file.ts';
import { nodeFsAdapter } from '../src/store-node.ts';
import type { DailyBar } from '../src/store.ts';

/** 合法 TickerFile JSON(store-file.ts hydrate 期望的 {stock,bars,reports} 形状)。 */
function tickerFile(ticker: string, dates: string[]): string {
  return JSON.stringify({
    stock: {
      ticker,
      name: `股票${ticker}`,
      overview: { latest_price: 1 },
      overviewLastUpdate: '2026-08-07',
      lastDataUpdate: dates[dates.length - 1] ?? '',
    },
    bars: dates.map((date): DailyBar => ({ date, open: 1, close: 2, high: 3, low: 0.5, volume: 100 })),
    reports: [],
  });
}

/** 仅捕获 console.error(logError 的 Node 出口;NODE_ENV=test 下无日志落盘)。 */
function captureErrors(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => {
    lines.push(a.map(String).join(' '));
  };
  return {
    lines,
    restore: () => {
      console.error = orig;
    },
  };
}

let baseDir: string;

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'soa-durability-test-'));
});

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

describe('F1① hydrate 逐文件容错(坏文件跳过不中断)', () => {
  it('截断/畸形 <ticker>.json 各记一条 error 并跳过,好文件与 meta 照常可用', async () => {
    await fsWriteFile(join(baseDir, 'meta.json'), JSON.stringify({ 'f10:600036': '净资产收益率 15.2' }), 'utf8');
    await fsWriteFile(join(baseDir, '600036.json'), tickerFile('600036', ['2026-08-13', '2026-08-14']), 'utf8');
    // 两类坏文件:截断 JSON(SyntaxError)与非对象字面量(null 解引用 TypeError);
    // 两个都报错 ⇒ 循环在首个失败后仍继续(readdir 顺序无关)。
    await fsWriteFile(join(baseDir, 'broken.json'), '{"stock":{"ticker":"BROKEN"', 'utf8');
    await fsWriteFile(join(baseDir, 'weird.json'), 'null', 'utf8');

    const store = new FileStore(baseDir, nodeFsAdapter(baseDir));
    const cap = captureErrors();
    try {
      await store.ready(); // 关键契约:不抛
    } finally {
      cap.restore();
    }

    expect(store.getStock('600036')?.name).toBe('股票600036');
    expect(store.getDatas('600036').map((b) => b.date)).toEqual(['2026-08-13', '2026-08-14']);
    expect(store.getMeta('f10:600036')).toContain('净资产收益率');
    expect(store.getStock('broken')).toBeNull();
    expect(store.getStock('weird')).toBeNull();
    const all = cap.lines.join('\n');
    expect(all).toContain('broken.json'); // logError 带文件名定位
    expect(all).toContain('weird.json');
  });

  it('截断的 meta.json 跳过且记 error,ticker 文件照常可用', async () => {
    await fsWriteFile(join(baseDir, 'meta.json'), '{"soa:last-run"', 'utf8');
    await fsWriteFile(join(baseDir, '000001.json'), tickerFile('000001', ['2026-01-02']), 'utf8');

    const store = new FileStore(baseDir, nodeFsAdapter(baseDir));
    const cap = captureErrors();
    try {
      await store.ready();
    } finally {
      cap.restore();
    }

    expect(store.getDatas('000001').map((b) => b.date)).toEqual(['2026-01-02']);
    expect(store.getMeta('soa:last-run')).toBeNull();
    expect(cap.lines.join('\n')).toContain('meta.json');
  });

  it('崩溃残留 tmp(<x>.json.tmp.*)按命名契约不被 hydrate 扫描', async () => {
    await fsWriteFile(join(baseDir, '600036.json'), tickerFile('600036', ['2026-08-14']), 'utf8');
    // 模拟进程在原子写中途被杀:半截内容躺在 tmp 里。tmp 后缀不以 .json 结尾,
    // hydrate 的 META_FILE 精确匹配与 .endsWith('.json') 分支都必须跳过它。
    await fsWriteFile(join(baseDir, '600036.json.tmp.4242-0'), '{"stock":{"tick', 'utf8');
    await fsWriteFile(join(baseDir, 'meta.json.tmp.999-9'), '{"f10:', 'utf8');

    const store = new FileStore(baseDir, nodeFsAdapter(baseDir));
    const cap = captureErrors();
    try {
      await store.ready();
    } finally {
      cap.restore();
    }

    expect(store.getStock('600036')).not.toBeNull();
    expect(cap.lines.join('\n')).not.toContain('.tmp.'); // 静默跳过,非错误路径
  });
});

describe('F1② nodeFsAdapter 原子写(tmp + rename)', () => {
  it('写入落盘读回一致,成功后目录无 tmp 残留', async () => {
    const adapter = nodeFsAdapter(baseDir);
    const payload = tickerFile('AAPL', ['2026-08-13', '2026-08-14']);
    await adapter.writeFile(join(baseDir, 'AAPL.json'), payload);

    expect(await fsReadFile(join(baseDir, 'AAPL.json'), 'utf8')).toBe(payload);
    expect(await readdir(baseDir)).toEqual(['AAPL.json']); // 无 .tmp.* 中间产物
  });

  it('重复写原子覆盖旧内容(短内容覆长内容无残迹)', async () => {
    const adapter = nodeFsAdapter(baseDir);
    await adapter.writeFile(join(baseDir, 'T.json'), 'x'.repeat(500));
    const v2 = '{"small":true}';
    await adapter.writeFile(join(baseDir, 'T.json'), v2);

    expect(await fsReadFile(join(baseDir, 'T.json'), 'utf8')).toBe(v2);
    expect(await readdir(baseDir)).toEqual(['T.json']);
  });

  it('FileStore × nodeFsAdapter 端到端:putStock→flush→新实例读回一致且无 tmp', async () => {
    const store = new FileStore(baseDir, nodeFsAdapter(baseDir));
    await store.ready();
    store.putStock({
      ticker: '600036',
      name: '招商银行',
      overview: { latest_price: 38.8 },
      overviewLastUpdate: '2026-08-07',
      lastDataUpdate: '2026-08-14',
    });
    store.addDatas('600036', [
      { date: '2026-08-13', open: 1, close: 2, high: 3, low: 0.5, volume: 100 },
      { date: '2026-08-14', open: 1.5, close: 2.5, high: 3.5, low: 1, volume: 200 },
    ]);
    store.setMeta('capital:600036', '总股本: 100000.0万股');
    await store.flush();

    const again = new FileStore(baseDir, nodeFsAdapter(baseDir));
    await again.ready();
    expect(again.getStock('600036')?.overview).toEqual({ latest_price: 38.8 });
    expect(again.getDatas('600036').map((b) => b.date)).toEqual(['2026-08-13', '2026-08-14']);
    expect(again.getMeta('capital:600036')).toContain('总股本');
    // 目录里只应有 .json 数据文件 —— 写路径不留任何中间产物
    expect((await readdir(baseDir)).every((name) => name.endsWith('.json'))).toBe(true);
  });
});
