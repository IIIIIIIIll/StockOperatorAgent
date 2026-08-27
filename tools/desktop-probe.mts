// 桌面 Node 后端接线探针:FileStore + node:fs 适配器 → runner.setStore;
// 设置存储经 node fs 适配器 save/load round-trip;桌面桥 store-op 分发语义
// ({op,args} 依次调用 == 直接调用)与快照 round-trip(枚举 + 逐字段读回)。
// 运行:node --experimental-transform-types tools/desktop-probe.mts
// 验证:① 5 mutator 写入 → listStocks/listMetaKeys 枚举 + 跨实例 hydrate 读回;
//       ② 快照 round-trip:listStocks+getStock/getDatas/getPerformanceReports、
//          listMetaKeys+getMeta 序列化 → 新实例 hydrate 逐字段一致;
//       ③ store-op 语义:5 mutator 以 {op,args} 依次调用 == 直接调用
//          (桌面桥 renderer → child IPC 的 store-op 分派执行语义);
//       ④ runner.setStore 注入 → ESM live binding(store 导出同步新值);
//       ⑤ settingsStore node 分支(注入 node fs 适配)save/load round-trip。
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DailyBar, PerformanceReport, StockRecord } from '../src/store.ts';
import { createNodeFileStore, nodeSettingsFileSystem } from '../src/store-node.ts';
import { setStore, store as runnerStore } from '../app/lib/runner.ts';
import { createSettingsStore } from '../app/lib/settingsStore.ts';

function check(name: string, cond: boolean): void {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`);
  if (!cond) throw new Error(`${name} 失败`);
}

// ─── 夹具:5 个 mutator 各至少一次(putStock/addDatas/addPerformanceReports/
//      replaceDatas/setMeta;顺序与 ③ 的 ops 序列一致;updateOverview 已随
//      H1 从 StoreLike+IPC 移除,零生产调用者)───────────────────────────────
const STOCK_600036: StockRecord = {
  ticker: '600036',
  name: '招商银行',
  overview: { latest_price: 38.8 },
  overviewLastUpdate: '2026-08-07',
  lastDataUpdate: '2026-08-14',
};
const STOCK_000001: StockRecord = {
  ticker: '000001',
  name: '平安银行',
  overview: null,
  overviewLastUpdate: null,
  lastDataUpdate: null,
};
const BARS_A: DailyBar[] = [
  { date: '2026-08-12', open: 38.2, close: 38.8, high: 39.0, low: 38.0, volume: 123456, amount: 472000000 },
  { date: '2026-08-13', open: 38.8, close: 39.2, high: 39.4, low: 38.6, volume: 234567, amount: 918000000 },
];
const BARS_B: DailyBar[] = [
  { date: '2026-08-14', open: 39.0, close: 39.5, high: 39.8, low: 38.9, volume: 345678, amount: 1365000000 },
  { date: '2026-08-15', open: 39.5, close: 39.6, high: 39.9, low: 39.2, volume: 456789, amount: 1808000000 },
];
const REPORTS: PerformanceReport[] = [
  { report_date: '20260331', fields: { revenue: 980000000, net_profit: 280000000 } },
  { report_date: '20260630', fields: { revenue: 1000000000, net_profit: 300000000 } },
];
const META = [
  ['soa:probe', 'desktop-ok'],
  ['capital:600036', '总股本: 1000000.0万股'],
] as const;

async function main(): Promise<void> {
  const baseDir = mkdtempSync(join(tmpdir(), 'soa-desktop-probe-'));
  try {
    // ── ① FileStore(node:fs 适配器):5 mutator 写入 + 枚举 + 跨实例读回 ──
    const dir = join(baseDir, 'store');
    const store = createNodeFileStore(dir);
    await store.ready();
    store.putStock(STOCK_600036);
    store.addDatas('600036', BARS_A);
    store.addPerformanceReports('600036', REPORTS);
    store.replaceDatas('600036', BARS_B); // 全量替换:清掉 BARS_A 旧根
    store.putStock(STOCK_000001);
    store.setMeta(META[0][0], META[0][1]);
    store.setMeta(META[1][0], META[1][1]);
    await store.flush();
    check('FileStore putStock/getStock(内存镜像)', store.getStock('600036')?.name === '招商银行');
    check('FileStore setMeta/getMeta(内存镜像)', store.getMeta('soa:probe') === 'desktop-ok');
    check('FileStore replaceDatas 全量替换(旧根清除)', store.getDatas('600036').map((b) => b.date).join(',') === '2026-08-14,2026-08-15');
    check('FileStore addDatas 增量去重(重复日 0 根)', store.addDatas('600036', [BARS_B[0]]) === 0);
    check('FileStore addPerformanceReports 去重(重复期 0 份)', store.addPerformanceReports('600036', [REPORTS[1]]) === 0);
    check('FileStore lastDataUpdate 随 replaceDatas 更新', store.getStock('600036')?.lastDataUpdate === '2026-08-15');
    // ① 枚举:listStocks/listMetaKeys 覆盖全部已写键(顺序无关,排序比对)
    check('FileStore listStocks 枚举', [...store.listStocks()].sort().join(',') === '000001,600036');
    check('FileStore listMetaKeys 枚举', [...store.listMetaKeys()].sort().join(',') === 'capital:600036,soa:probe');

    // ── ② 快照 round-trip:枚举 + getter 序列化 → 新实例 hydrate 逐字段一致 ──
    const snap = {
      stocks: Object.fromEntries(store.listStocks().map((t) => [t, store.getStock(t)])),
      datas: Object.fromEntries(store.listStocks().map((t) => [t, store.getDatas(t)])),
      reports: Object.fromEntries(store.listStocks().map((t) => [t, store.getPerformanceReports(t)])),
      meta: Object.fromEntries(store.listMetaKeys().map((k) => [k, store.getMeta(k)])),
    };
    const s2 = createNodeFileStore(dir);
    await s2.ready();
    check('快照 round-trip:listStocks 枚举(hydrate 后)', [...s2.listStocks()].sort().join(',') === '000001,600036');
    check('快照 round-trip:listMetaKeys 枚举(hydrate 后)', [...s2.listMetaKeys()].sort().join(',') === 'capital:600036,soa:probe');
    for (const t of store.listStocks()) {
      check(`快照 round-trip:getStock(${t}) 逐字段一致`, JSON.stringify(s2.getStock(t)) === JSON.stringify(snap.stocks[t]));
      const gotBars = s2.getDatas(t);
      const wantBars = snap.datas[t];
      check(
        `快照 round-trip:getDatas(${t}) 逐字段一致`,
        gotBars.length === wantBars.length && gotBars.every((b, i) => JSON.stringify(b) === JSON.stringify(wantBars[i])),
      );
      const gotReports = s2.getPerformanceReports(t);
      const wantReports = snap.reports[t];
      check(
        `快照 round-trip:getPerformanceReports(${t}) 逐字段一致`,
        gotReports.length === wantReports.length && gotReports.every((r, i) => JSON.stringify(r) === JSON.stringify(wantReports[i])),
      );
    }
    for (const [k, v] of META) {
      check(`快照 round-trip:getMeta(${k}) 一致`, s2.getMeta(k) === v && s2.getMeta(k) === snap.meta[k]);
    }
    s2.close();

    // ── ③ store-op 语义:5 mutator 以 {op,args} 依次调用 == 直接调用 ──
    const ops: Array<{ op: string; args: unknown[] }> = [
      { op: 'putStock', args: [STOCK_600036] },
      { op: 'putStock', args: [STOCK_000001] },
      { op: 'addDatas', args: ['600036', BARS_A] },
      { op: 'addPerformanceReports', args: ['600036', REPORTS] },
      { op: 'replaceDatas', args: ['600036', BARS_B] },
      { op: 'addDatas', args: ['600036', [BARS_B[0]]] }, // 重复日 → 0
      { op: 'addPerformanceReports', args: ['600036', [REPORTS[1]]] }, // 重复期 → 0
      { op: 'setMeta', args: [META[0][0], META[0][1]] },
      { op: 'setMeta', args: [META[1][0], META[1][1]] },
    ];
    const direct = createNodeFileStore(join(baseDir, 'store-op-direct'));
    const viaOp = createNodeFileStore(join(baseDir, 'store-op-via'));
    await Promise.all([direct.ready(), viaOp.ready()]);
    const directResults: unknown[] = [];
    directResults.push(direct.putStock(STOCK_600036));
    directResults.push(direct.putStock(STOCK_000001));
    directResults.push(direct.addDatas('600036', BARS_A));
    directResults.push(direct.addPerformanceReports('600036', REPORTS));
    directResults.push(direct.replaceDatas('600036', BARS_B));
    directResults.push(direct.addDatas('600036', [BARS_B[0]]));
    directResults.push(direct.addPerformanceReports('600036', [REPORTS[1]]));
    directResults.push(direct.setMeta(META[0][0], META[0][1]));
    directResults.push(direct.setMeta(META[1][0], META[1][1]));
    // 分发路径:与 child 进程 IPC 处理一致 —— store[op](...args)
    const opStore = viaOp as unknown as Record<string, (...a: unknown[]) => unknown>;
    const viaResults = ops.map(({ op, args }) => opStore[op](...args));
    await Promise.all([direct.flush(), viaOp.flush()]);
    check('store-op 语义:各 op 返回值一致', JSON.stringify(viaResults) === JSON.stringify(directResults));
    check(
      'store-op 语义:getStock 状态一致',
      JSON.stringify(direct.getStock('600036')) === JSON.stringify(viaOp.getStock('600036'))
        && JSON.stringify(direct.getStock('000001')) === JSON.stringify(viaOp.getStock('000001')),
    );
    check('store-op 语义:getDatas 状态一致', JSON.stringify(direct.getDatas('600036')) === JSON.stringify(viaOp.getDatas('600036')));
    check(
      'store-op 语义:getPerformanceReports 状态一致',
      JSON.stringify(direct.getPerformanceReports('600036')) === JSON.stringify(viaOp.getPerformanceReports('600036')),
    );
    check(
      'store-op 语义:getMeta 状态一致',
      direct.getMeta('soa:probe') === viaOp.getMeta('soa:probe') && direct.getMeta('capital:600036') === viaOp.getMeta('capital:600036'),
    );
    direct.close();
    viaOp.close();

    // ── ④ runner.setStore 注入 → ESM live binding(store 导出同步新值)──
    setStore(store);
    check('runner.setStore live binding(store 导出 = 注入实例)', runnerStore === store);
    check('注入 store 读改写', runnerStore.getStock('600036')?.name === '招商银行' && runnerStore.getMeta('soa:probe') === 'desktop-ok');

    // ── ⑤ settingsStore node 分支:注入 node fs 适配 → save/load round-trip ──
    const sdir = join(baseDir, 'settings');
    const settingsStore = createSettingsStore(null, nodeSettingsFileSystem(sdir));
    check('settingsStore node load(无文件 → null)', settingsStore.load() === null);
    settingsStore.save('{"switches":{"webSearch":true},"caps":{"searchMax":3}}');
    check(
      'settingsStore node save/load round-trip',
      settingsStore.load() === '{"switches":{"webSearch":true},"caps":{"searchMax":3}}',
    );

    console.log('\n桌面 Node 后端接线探针全部通过');
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('探针失败:', err instanceof Error ? err.message : err);
  process.exit(1);
});
