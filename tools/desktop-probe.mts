// 桌面 Node 后端接线探针:FileStore + node:fs 适配器 → runner.setStore;
// 设置存储经 node fs 适配器 save/load round-trip。
// 运行:node --experimental-transform-types tools/desktop-probe.mts
// 验证:① createNodeFileStore 读改写(putStock/getStock + setMeta/getMeta)
//       跨实例 hydrate 落盘读回;② runner.setStore 注入 → ESM live binding
//       (runner 的 store 导出同步读新值);③ settingsStore node 分支
//       (注入 node fs 适配)save/load round-trip。
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileStore, nodeSettingsFileSystem } from '../src/store-node.ts';
import { setStore, store as runnerStore } from '../app/lib/runner.ts';
import { createSettingsStore } from '../app/lib/settingsStore.ts';

function check(name: string, cond: boolean): void {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`);
  if (!cond) throw new Error(`${name} 失败`);
}

async function main(): Promise<void> {
  const baseDir = mkdtempSync(join(tmpdir(), 'soa-desktop-probe-'));
  try {
    // ── ① FileStore(node:fs 适配器)round-trip:写 → flush → 跨实例读回 ──
    const dir = join(baseDir, 'store');
    const store = createNodeFileStore(dir);
    await store.ready();
    store.putStock({
      ticker: '600036',
      name: '招商银行',
      overview: { latest_price: 38.8 },
      overviewLastUpdate: '2026-08-07',
      lastDataUpdate: '2026-08-14',
    });
    store.setMeta('soa:probe', 'desktop-ok');
    store.setMeta('capital:600036', '总股本: 100000.0万股');
    await store.flush();
    check('FileStore putStock/getStock(内存镜像)', store.getStock('600036')?.name === '招商银行');
    check('FileStore setMeta/getMeta(内存镜像)', store.getMeta('soa:probe') === 'desktop-ok');

    // 跨实例 hydrate:新实例读回同数据 → 真实落盘
    const s2 = createNodeFileStore(dir);
    await s2.ready();
    check('FileStore 落盘读回(putStock/getStock)', s2.getStock('600036')?.overview?.latest_price === 38.8);
    check('FileStore 落盘读回(setMeta/getMeta)', s2.getMeta('capital:600036')?.includes('总股本') === true);
    s2.close();

    // ── ② runner.setStore 注入 → ESM live binding(store 导出同步新值)──
    setStore(store);
    check('runner.setStore live binding(store 导出 = 注入实例)', runnerStore === store);
    check('注入 store 读改写', runnerStore.getStock('600036')?.name === '招商银行' && runnerStore.getMeta('soa:probe') === 'desktop-ok');

    // ── ③ settingsStore node 分支:注入 node fs 适配 → save/load round-trip ──
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
