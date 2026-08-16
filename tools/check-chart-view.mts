// tools/check-chart-view.mts —— chart:check 实现
// 重跑生成器后与现有产物逐字节比对,一致退出 0,不一致退出 1。
//
// 策略(生成器输出路径固定为 app/assets + app/lib,须防污染工作区):
//   1. 把现有产物备份到临时目录(原本缺失则记录缺失);
//   2. 子进程重跑 tools/build-chart-view.mts(写固定路径);
//   3. 逐字节比对临时备份与生成结果 ——
//      - app/lib/chartHtml.ts(组件运行时 import 的提交产物):**严格基准**,
//        缺失/不一致均判失败;
//      - app/assets/chart-view.html(运行时零引用的构建产物,已 .gitignore):
//        **宽松校验**——原本存在且重生成后不一致才报失败;原本缺失不算错
//        (该文件由 chart:build 按需产出,供浏览器手动调试,不入库);
//   4. finally 无条件还原:备份拷回(原本缺失的删掉生成物)、清理临时目录
//      —— 无论生成成功/失败、一致/不一致,工作区字节级复原,仅用退出码
//      表达结果(幂等,可反复执行)。
// 生成失败或比对不一致 → stderr 说明 + 退出 1(先跑 chart:build 后提交产物)。
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** [产物路径, 是否严格基准]:chartHtml.ts 严格;chart-view.html 宽松(构建产物)。 */
const OUTPUTS: Array<[string, boolean]> = [
  [resolve(ROOT, 'app/lib/chartHtml.ts'), true],
  [resolve(ROOT, 'app/assets/chart-view.html'), false],
];

function main(): void {
  const tmp = mkdtempSync(join(tmpdir(), 'soa-chart-check-'));
  // 1. 备份现有产物(不存在则备份路径留空,还原时按缺失处理)
  const backups = OUTPUTS.map(([p], i) => {
    const b = join(tmp, `out-${i}`);
    if (existsSync(p)) copyFileSync(p, b);
    return b;
  });
  let exitCode = 0;
  try {
    // 2. 重跑生成器(与 chart:build 同命令)
    const gen = spawnSync(
      process.execPath,
      ['--experimental-transform-types', 'tools/build-chart-view.mts'],
      { cwd: ROOT, stdio: 'inherit' },
    );
    if (gen.status !== 0) {
      console.error('chart:check:生成器执行失败(见上方输出);产物已还原,未改动工作区。');
      exitCode = 1;
      return;
    }
    // 3. 逐字节比对
    const stale: string[] = [];
    OUTPUTS.forEach(([p, strict], i) => {
      const backedUp = existsSync(backups[i]);
      const nowExists = existsSync(p);
      if (backedUp && nowExists && readFileSync(backups[i]).equals(readFileSync(p))) return; // 一致
      if (strict) {
        // 严格基准:缺失(原本/生成后任一)或内容不一致 → 失败
        stale.push(`${p}${nowExists ? '' : '(缺失)'}`);
        return;
      }
      // 宽松基准:原本不存在(构建产物按需产出)→ 通过;原本存在但内容变了 → 报陈旧
      if (backedUp && nowExists) stale.push(p);
    });
    if (stale.length) {
      console.error('chart:check:生成物与源模板不一致(先跑 chart:build 重新生成并提交):');
      for (const p of stale) console.error('  ' + p);
      exitCode = 1;
    } else {
      console.log('chart:check:OK —— 生成物与源模板一致。');
    }
  } finally {
    // 4. 无条件还原 + 清理(幂等:工作区与执行前字节级一致)
    OUTPUTS.forEach(([p], i) => {
      if (existsSync(backups[i])) copyFileSync(backups[i], p);
      else if (existsSync(p)) rmSync(p);
    });
    rmSync(tmp, { recursive: true, force: true });
  }
  process.exitCode = exitCode;
}

main();
