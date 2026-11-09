#!/usr/bin/env node
// Android 端到端冒烟 —— 把 2026-11-09 手工跑过的那条真机链路固化成可重跑的工具。
//
// 做什么(全部经 adb,零额外依赖 —— 和 tools/web-e2e.mjs 同款"不引 puppeteer"思路):
//   ① 安装 release APK(版本号回退时先卸载;release 包内嵌 JS bundle,不依赖 Metro)
//   ② 冷启动,等 "[soa info] 演示数据载入" 出现(证明 JS 引擎起来且 store 可读)
//   ③ 从 uiautomator dump 里按 content-desc="开始分析" 找按钮真实坐标并点击
//      (顺带断言无障碍标签存在 —— 那是 a11y 修复的回归点)
//   ④ 轮询 logcat,等 "[soa info] 分析结束" 出现
//   ⑤ 断言:0 条 FATAL/AndroidRuntime 崩溃、7 个角色 chip 全部"完成"、最终结论非空
//   ⑥ 抽屉 → 历史 → 打开该条 → "正在查看历史" → 返回最新(验证 openRun/closeRun)
//
// 用法:
//   node tools/android-e2e.mjs [--apk <path>] [--serial <adb serial>] [--skip-build-note]
// 前置:
//   - 一台已连上的设备/模拟器(`adb devices` 里 status=device)
//   - release APK:cd app/android && ./gradlew :app:assembleRelease
//     (本机 Gradle 出网受限时见 tools/gradle-mirrors.gradle)
// 退出码:0 通过;1 失败(打印失败步骤与最后若干行 logcat)。
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const APK = arg('apk', 'app/android/app/build/outputs/apk/release/app-release.apk');
const SERIAL = arg('serial', process.env.ANDROID_SERIAL ?? null);
const PKG = 'com.stockoperatoragent.app';
const ACTIVITY = `${PKG}/.MainActivity`;

const failures = [];
function fail(step, detail) {
  console.error(`\n✗ ${step}${detail ? `: ${detail}` : ''}`);
  failures.push(step);
}
function ok(msg) {
  console.log(`✓ ${msg}`);
}

/** adb 可执行路径:PATH 优先,其次 ANDROID_HOME/platform-tools(CI/本机常见)。 */
const ADB = (() => {
  const onPath = spawnSync('adb', ['version'], { encoding: 'utf8' });
  if (onPath.status === 0) return 'adb';
  const home = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (home) {
    const candidate = `${home}/platform-tools/adb`;
    const probe = spawnSync(candidate, ['version'], { encoding: 'utf8' });
    if (probe.status === 0) return candidate;
  }
  return 'adb'; // 让失败信息指向 adb 本身(而不是伪造一个路径)
})();

function adb(...rest) {
  const argv = SERIAL ? ['-s', SERIAL, ...rest] : rest;
  const r = spawnSync(ADB, argv, { encoding: 'utf8', timeout: 120_000 });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForLog(pattern, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { out } = adb('logcat', '-d');
    if (regexTest(pattern, out)) return out;
    await sleep(1000);
  }
  return null;
}
function regexTest(pattern, text) {
  return typeof pattern === 'string' ? text.includes(pattern) : pattern.test(text);
}

/** uiautomator dump → 解析出 {text, desc, bounds} 列表(零依赖,正则够用)。 */
function dumpNodes() {
  adb('shell', 'uiautomator', 'dump', '/sdcard/soa-e2e.xml');
  const { out } = adb('shell', 'cat', '/sdcard/soa-e2e.xml');
  const nodes = [];
  for (const m of out.matchAll(/<node\b[^>]*>/g)) {
    const tag = m[0];
    const attr = (n) => (new RegExp(`${n}="([^"]*)"`).exec(tag) ?? [])[1];
    const b = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(tag);
    nodes.push({
      text: attr('text'),
      desc: attr('content-desc'),
      cls: attr('class'),
      clickable: attr('clickable') === 'true',
      bounds: b ? [Number(b[1]), Number(b[2]), Number(b[3]), Number(b[4])] : null,
    });
  }
  return nodes;
}
function center(node) {
  const [x1, y1, x2, y2] = node.bounds;
  return [Math.round((x1 + x2) / 2), Math.round((y1 + y2) / 2)];
}

async function main() {
  if (!existsSync(APK)) {
    fail('APK 不存在', `${APK} —— 先 cd app/android && ./gradlew :app:assembleRelease`);
    return;
  }
  const dev = adb('devices');
  if (!/device\b/.test(dev.out.replace(/List of devices attached/, ''))) {
    fail('没有可用设备', dev.out || '(adb devices 为空)');
    return;
  }

  // ① 安装(版本号回退 → 先卸载)
  let inst = adb('install', '-r', APK);
  if (/INSTALL_FAILED_VERSION_DOWNGRADE/.test(inst.out)) {
    adb('uninstall', PKG);
    inst = adb('install', '-r', APK);
  }
  if (!/Success/.test(inst.out)) {
    fail('安装失败', inst.out.slice(-400));
    return;
  }
  ok(`安装 ${APK}`);

  // ② 冷启动
  adb('logcat', '-c');
  adb('shell', 'am', 'force-stop', PKG);
  adb('shell', 'am', 'start', '-n', ACTIVITY);
  // 用「应用启动」而不是「演示数据载入」:后者只在首次冷启动(无 lastRun)时打,
  // 已有上次结果时会走恢复路径 —— 拿它当启动判据会在第二次跑工具时误报。
  const booted = await waitForLog('应用启动', 60_000);
  if (!booted) {
    fail('启动', '60s 内未见「应用启动」(JS 未起?看 logcat)');
    return;
  }
  ok('启动(JS 引擎就绪)');

  // 通知权限弹窗会挡住点击(Android 13+)—— 有就允许
  const perms = dumpNodes();
  if (perms.some((n) => n.text?.startsWith('Allow') || n.desc?.startsWith('Allow'))) {
    const allow = perms.find((n) => n.text === 'Allow' || n.desc === 'Allow');
    if (allow?.bounds) adb('shell', 'input', 'tap', ...center(allow).map(String));
    await sleep(1500);
    ok('通过通知权限弹窗');
  }

  // ③ 找「开始分析」并点击(同时断言 a11y 标签在位)
  const start = dumpNodes().find((n) => n.clickable && n.desc === '开始分析');
  if (!start) {
    fail('找不到「开始分析」', 'content-desc="开始分析" 缺失(无障碍标签回归?)');
    return;
  }
  adb('logcat', '-c');
  adb('shell', 'input', 'tap', ...center(start).map(String));
  ok('点击「开始分析」(content-desc 命中)');

  // ④⑤ 等分析完成
  const done = await waitForLog('分析结束', 180_000);
  if (!done) {
    fail('分析未完成', '180s 内未见「分析结束」');
    return;
  }
  const elapsed = /分析结束:耗时 ([\d.]+)s/.exec(done)?.[1] ?? '?';
  ok(`分析跑完(${elapsed}s)`);

  const fresh = adb('logcat', '-d').out;
  const fatal = fresh.split('\n').filter((l) => /FATAL EXCEPTION|AndroidRuntime: FATAL/.test(l));
  if (fatal.length) {
    fail('运行期崩溃', fatal.slice(0, 3).join('\n'));
    return;
  }
  ok('0 条 FATAL');

  // 断言 chips:7 个角色全部「完成」
  const nodes = dumpNodes();
  const texts = nodes.map((n) => n.text ?? '').join('\n');
  const completed = (texts.match(/· 完成/g) ?? []).length;
  if (completed < 7) {
    fail('角色 chip 未全部完成', `只看到 ${completed}/7 —— UI 里可能是「无结论」或残留「分析中」`);
  } else {
    ok(`角色 chip 全部完成(${completed} 个)`);
  }
  if (!/分析完成\(\d+ 步\)/.test(texts)) {
    fail('完成态缺失', '未看到「✓ 分析完成(N 步)」');
  }

  // ⑥ 历史:抽屉 → 历史 → 打开该条 → 返回最新(openRun/closeRun)
  // ☰ 的文案在子 Text 上,clickable 落在父 View —— 不要求 clickable,点文字中心即可
  // 命中父级 Pressable(与手工点击一致)。
  const menu = nodes.find((n) => n.text === '☰' || n.desc === '菜单');
  if (!menu) {
    fail('找不到抽屉按钮', '');
    return;
  }
  adb('shell', 'input', 'tap', ...center(menu).map(String));
  await sleep(1200);
  const historyEntry = dumpNodes().find((n) => n.text === '历史' && n.bounds);
  if (!historyEntry) {
    fail('抽屉里找不到「历史」', '');
    return;
  }
  adb('shell', 'input', 'tap', ...center(historyEntry).map(String));
  await sleep(1500);
  const chevron = dumpNodes().find((n) => n.text === '›' && n.bounds);
  if (!chevron) {
    fail('历史列表为空', '本次运行未落档(recordRun 回归?)');
    return;
  }
  adb('logcat', '-c');
  adb('shell', 'input', 'tap', ...center(chevron).map(String));
  const opened = await waitForLog('查看历史分析', 30_000);
  if (!opened) {
    fail('openRun 未生效', '未见「查看历史分析」日志');
    return;
  }
  ok('openRun 复现历史正文');

  const back = dumpNodes().find((n) => n.text === '返回最新');
  if (!back) {
    fail('找不到「返回最新」', 'viewingRun 未置位?');
    return;
  }
  adb('shell', 'input', 'tap', ...center(back).map(String));
  await sleep(1200);
  const backTexts = dumpNodes().map((n) => n.text ?? '').join('\n');
  if (/正在查看历史/.test(backTexts)) {
    fail('closeRun 未恢复实时态', '仍显示「正在查看历史」');
  } else {
    ok('closeRun 恢复实时态');
  }
}

main()
  .then(() => {
    if (failures.length) {
      console.error(`\n✗ Android E2E 失败(${failures.length} 项):${failures.join(' / ')}`);
      console.error('\n最后 20 行 logcat:');
      console.error(adb('logcat', '-d', '-t', '200').out.split('\n').slice(-20).join('\n'));
      process.exit(1);
    }
    console.log('\n✓ Android E2E 冒烟通过');
  })
  .catch((err) => {
    console.error(`\n✗ Android E2E 异常:${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
