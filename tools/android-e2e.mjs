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
//   ⑤.5 「决策价位」Tab(2026-11-22):点击后必验标题/价位分布卡片/方向/信心度,
//        并区分"抽到价位"与"空态提示"两种合法形态(演示占位报告就是空态)
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
/** 本脚本跑的市场(MARKET_CHOICES 的 label,src/market.ts)。设置是持久化的 ——
 *  上一轮 `e2e:android:us` 会把市场留在美股,不归位就会被启动守卫拒绝。 */
const MARKET_LABEL = '沪深A股';

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
  // maxBuffer:默认 1MB —— `logcat -d` 一次全量转储在模拟器上很容易超过(系统
  // 服务刷屏),超限后 Node 截断输出,目标行落在截断区就永远匹配不到(实测:
  // 分析已在 593.6s 完成,工具仍polll 满 1800s 报「分析未完成」)。
  const r = spawnSync(ADB, argv, { encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForLog(pattern, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // 只取 JS 日志(本工具所有等待目标都由 src/log.ts 经 ReactNativeJS 打出)。
    // 全量 `-d` 会被系统服务刷屏淹没,既慢又容易撞上缓冲截断。
    const { out } = adb('logcat', '-d', 'ReactNativeJS:*', '*:S');
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

/** 市场归位(MARKET_CHOICES 的 label)。设置持久化 —— 直接绠 ticker 而不归位,
 *  残留的另一个市场会被启动守卫拒绕(UI 上立即显示「请输入有效的…代码」)。
 *  返回 false = 按钮/菜单项缺失(调用方报错)。 */
async function selectMarket(label) {
  const btn = dumpNodes().find((n) => n.desc === '选择市场' || n.desc === 'market');
  if (!btn?.bounds) return false;
  adb('shell', 'input', 'tap', ...center(btn).map(String));
  await sleep(800);
  const option = dumpNodes().find((n) => (n.text ?? '').trim() === label);
  if (!option?.bounds) return false;
  adb('shell', 'input', 'tap', ...center(option).map(String));
  await sleep(800);
  return true;
}

/** 运行期权限预授予(Android 13+ POST_NOTIFICATIONS)。
 *
 * 为什么必须在 `am start` **之前**:首次冷启动会弹权限对话框盖住整个 UI,
 *  `dumpNodes()` 只能看到 Allow/Don't allow —— 于是 chip 断言恒 0/7、「☰」也找不到,
 *  而 logcat 里分析其实已经跑完了(实测 2026-11-19:分析 3.8s 跑完、7 项断言全挂)。
 * 脚本原来只在启动后做**一次性**快照检测,弹窗晚到 1~2s 就漏。
 * 旧版 Android / 已授予 → grant 报错,忽略即可(下面的 re-entrant 点掉仍保留)。 */
function grantRuntimePermissions() {
  const r = adb('shell', 'pm', 'grant', PKG, 'android.permission.POST_NOTIFICATIONS');
  return !/Exception|Error|Unknown/i.test(r.out);
}

/** 点掉系统对话框 —— **可重入**。与「一次性检查」的区别就是可以随意多调几次:
 *  弹窗可能在启动后任何时刻出现(分析期间也会),每次断言 UI 前清一遍即可。
 *  无弹窗 → 零成本返回 false。 */
async function dismissSystemDialogs() {
  const allow = dumpNodes().find(
    (n) => (n.text ?? '').trim() === 'Allow' || (n.desc ?? '').trim() === 'Allow',
  );
  if (!allow?.bounds) return false;
  adb('shell', 'input', 'tap', ...center(allow).map(String));
  await sleep(1500);
  return true;
}

/** 等开跑的**早期结果**:拿到以下三者之一就返回,不再盲目等满整个分析上限。
 *  - done:    logcat 出现「分析结束」(跳转成功/快速完成)
 *  - error:   UI 上出现「✗ ...」—— 启动守卫拒绝(市场/代码不匹配)
 *  - timeout: 窗口内两样都没等到(真慢分析)→ 交给后续长轮询
 * 旧实现不论哪种都等满 30 分钟,把「屏幕上早已写着原因」的失败伪装成「超时」。 */
async function waitForStartOutcome(windowMs = 20_000) {
  const deadline = Date.now() + windowMs;
  while (Date.now() < deadline) {
    const { out } = adb('logcat', '-d', 'ReactNativeJS:*', '*:S');
    if (out.includes('分析结束')) return { done: true };
    const err = dumpNodes()
      .map((n) => (n.text ?? '').trim())
      .find((t) => t.startsWith('✗'));
    if (err) return { error: err };
    await sleep(1000);
  }
  return { timeout: true };
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

  // ①.5 运行期权限预授予(先于冷启动,否则首次启动的对话框会盖住整个 UI)
  if (grantRuntimePermissions()) ok('预授予通知权限');

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

  // 通知权限弹窗会挡住点击(Android 13+)—— 有就允许。预授予已从根上去掉弹窗,
  // 这里保底处理旧系统/手动清权后的情况;dismissSystemDialogs 可重入。
  if (await dismissSystemDialogs()) ok('通过通知权限弹窗');

  // ③ 市场归位
  if (!(await selectMarket(MARKET_LABEL))) {
    fail(`市场归位失败(${MARKET_LABEL})`, '找不到「选择市场」按钮或菜单项');
    return;
  }
  ok(`市场归位为${MARKET_LABEL}`);

  // ④ 找「开始分析」并点击(同时断言 a11y 标签在位)
  const start = dumpNodes().find((n) => n.clickable && n.desc === '开始分析');
  if (!start) {
    fail('找不到「开始分析」', 'content-desc="开始分析" 缺失(无障碍标签回归?)');
    return;
  }
  adb('logcat', '-c');
  adb('shell', 'input', 'tap', ...center(start).map(String));
  ok('点击「开始分析」(content-desc 命中)');

  // ⑥ 先看早期结果:启动守卫拒绝是**即时 UI 错误**,不是慢分析
  const early = await waitForStartOutcome();
  if (early.error) {
    fail('启动被 UI 守卫拒绝', `${early.error} —— 市场/代码与脚本预期不符(残留设置?)`);
    return;
  }

  // ④⑤ 等分析完成。
  // 上限两种模式差很大:演示模式(无 LLM 键)约 5s;真实 LLM 一次完整多智能体
  // 分析(8 份报告 + 多次联网搜索)在模拟器上实测 ~730s。旧实现硬钉 180s ——
  // 设备上残留真实按键时会稳定误报。默认给 30 分钟,可用
  // SOA_E2E_ANALYSIS_TIMEOUT_MS 覆盖(演示模式调小可以更快失败)。
  const rawTimeout = process.env.SOA_E2E_ANALYSIS_TIMEOUT_MS;
  const parsedTimeout = Number(rawTimeout ?? 1_800_000);
  if (!Number.isFinite(parsedTimeout) || parsedTimeout <= 0) {
    // 写错的值(如 "30m"/"")会让 Number() 出 NaN,之后每次
    // Date.now() < NaN 都是 false → 首次轮询就报「分析未完成」,
    // 与真失败无从区分(正是本文件刚修掉的两类假失败同型)。
    fail('分析超时配置非法', `SOA_E2E_ANALYSIS_TIMEOUT_MS=${rawTimeout} —— 需为正数毫秒`);
    return;
  }
  const analysisTimeoutMs = parsedTimeout;
  const done = await waitForLog('分析结束', analysisTimeoutMs);
  if (!done) {
    fail('分析未完成', `${Math.round(analysisTimeoutMs / 1000)}s 内未见「分析结束」`);
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

  // 断言 chips:7 个角色全部「完成」(先清掉分析期间可能冒出来的系统弹窗)
  await dismissSystemDialogs();
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

  // ⑤.5 「决策价位」Tab(2026-11-22 新增):合成 Tab,与角色开关无关。
  // 它只消费《最终结论》文本 + store 日K —— 所以这一步同时验证两件事:
  //   a) Tab 条里真的多了这一项、点了不白屏(2026-11-21 P2 同款回落坑);
  //   b) 演示占位报告(无 LLM 三键)时走"空态提示"而不是崩/空白。
  const levelsTab = dumpNodes().find((n) => (n.text ?? '').trim() === '决策价位');
  if (!levelsTab?.bounds) {
    fail('找不到「决策价位」Tab', 'Tab 条里没有该 Tab(渲染回归?)');
  } else {
    adb('shell', 'input', 'tap', ...center(levelsTab).map(String));
    await sleep(1500);
    const levelsTexts = dumpNodes().map((n) => n.text ?? '').join('\n');
    if (!/决策价位 · /.test(levelsTexts)) {
      fail('决策价位 Tab 未渲染', '标题「决策价位 · <ticker>」缺失');
    } else if (!/价位分布/.test(levelsTexts)) {
      fail('价位图卡片缺失', '未看到「价位分布(近 N 根收盘)」');
    } else if (!/(报告方向|信心度)/.test(levelsTexts)) {
      fail('摘要区缺失', '未看到方向/信心度格子');
    } else {
      // 两种合法形态:抽到价位(列出数字) 或 空态提示(演示占位报告)
      const hasEmptyState = /未提取到价位|没有可识别的价位/.test(levelsTexts);
      const levelRows = (levelsTexts.match(/^[+-]?\d+\.\d{1,2}%$/gm) ?? []).length;
      if (!hasEmptyState && levelRows === 0) {
        fail('价位区既没数字也没空态提示', '可能渲染成空白');
      } else {
        ok(`决策价位 Tab 渲染(${hasEmptyState ? '空态提示正常' : `列出 ${levelRows} 个价位百分比`})`);
      }
    }
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
