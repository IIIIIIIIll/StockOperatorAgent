#!/usr/bin/env node
// Android 港股真实数据端到端 —— 钉死 hk 链在真机(release APK + 真网络)上的表现。
//
// 与 tools/android-e2e.mjs 的分工:那个跑默认市场(沪深 600036)的整链冒烟;本
// 脚本改跑港股 00700,并断言**这次改动新增的可见面**:
//   ① 代码规范化(00700 → 0700.HK 落库,logcat「采集完成」)
//   ② 概览 52 周高低 / YTD(27 键补齐)
//   ③ 「公司画像 · 分析师预期」段(assetProfile/financialData 等模块)
//   ④ 日K 表换手率列有具体数值(yahoo-capital: 元数据 → capital → turnoverPct)
//   ⑤ 分析上下文含【近期新闻(港股 … Google News)】(news-feed / 直连 RSS)
//
// 前提:APK 已安装(先跑 tools/android-e2e.mjs 或 adb install -r)、设备已连。
// 用法:node tools/android-e2e-hk.mjs [--serial <adb serial>] [--ticker 00700]
//   LLM 三键已存在设备设置里 → 真 LLM(单次数分钟);没有 → 演示 stub(秒级)。
//   SOA_E2E_ANALYSIS_TIMEOUT_MS 覆盖分析等待上限(默认 30 分钟)。
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const SERIAL = arg('serial', process.env.ANDROID_SERIAL ?? null);
const TICKER = arg('ticker', '00700');
/** 市场由代码形状决定（数字 → 港股；字母 → 美股）。2026-11-19 补：旧脚本只
 *  支持港股 → 美股链在真机上无任何 E2E 覆盖。 */
const MARKET = /^\d/.test(TICKER) ? 'hk' : 'us';
const MARKET_LABEL = MARKET === 'hk' ? '港股' : '美股';
const STORE_TICKER =
  arg('store-ticker', null) ??
  (MARKET === 'hk' ? `${TICKER.replace(/^0+/, '').padStart(4, '0')}.HK` : TICKER.toUpperCase());
const PKG = 'com.stockoperatoragent.app';
const ACTIVITY = `${PKG}/.MainActivity`;

const ADB = (() => {
  const onPath = spawnSync('adb', ['version'], { encoding: 'utf8' });
  if (onPath.status === 0) return 'adb';
  const home = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (home) {
    const candidate = `${home}/platform-tools/adb`;
    const probe = spawnSync(candidate, ['version'], { encoding: 'utf8' });
    if (probe.status === 0) return candidate;
  }
  return 'adb';
})();

function adb(...rest) {
  const argv = SERIAL ? ['-s', SERIAL, ...rest] : rest;
  const r = spawnSync(ADB, argv, { encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function dumpNodes() {
  adb('shell', 'uiautomator', 'dump', '/sdcard/soa-e2e-hk.xml');
  const { out } = adb('shell', 'cat', '/sdcard/soa-e2e-hk.xml');
  const nodes = [];
  for (const m of out.matchAll(/<node\b[^>]*>/g)) {
    const tag = m[0];
    const attr = (n) => (new RegExp(`${n}="([^"]*)"`).exec(tag) ?? [])[1];
    const b = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(tag);
    nodes.push({
      text: attr('text'),
      desc: attr('content-desc'),
      cls: attr('class'),
      editable: attr('class')?.includes('EditText') ?? false,
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
function tap(node) {
  return adb('shell', 'input', 'tap', ...center(node).map(String));
}

async function waitForLog(pattern, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { out } = adb('logcat', '-d', 'ReactNativeJS:*', '*:S');
    const hit = typeof pattern === 'string' ? out.includes(pattern) : pattern.test(out);
    if (hit) return out;
    await sleep(1500);
  }
  return null;
}

/** 采集数据页是 ScrollView:visible-only dump 看不到下半屏。向下扫若干屏把
 *  文本合并成一份(断言只看文本,不看位置)。 */
async function scrollAndCollect(screens = 8) {
  let all = '';
  for (let i = 0; i < screens; i++) {
    all += dumpNodes().map((n) => n.text ?? '').join('\n') + '\n';
    adb('shell', 'input', 'swipe', '540', '1600', '540', '700', '300');
    await sleep(700);
  }
  return all;
}

const failures = [];
function fail(step, detail) {
  console.error(`\n✗ ${step}${detail ? `: ${detail}` : ''}`);
  failures.push(step);
}
function ok(msg) {
  console.log(`✓ ${msg}`);
}

async function main() {
  const dev = adb('devices');
  if (!/device\b/.test(dev.out.replace(/List of devices attached/, ''))) {
    fail('没有可用设备', dev.out);
    return;
  }
  const installed = adb('shell', 'pm', 'list', 'packages', PKG);
  if (!installed.out.includes(PKG)) {
    fail('未安装', `${PKG} —— 先跑 tools/android-e2e.mjs 或 adb install -r <apk>`);
    return;
  }

  adb('logcat', '-c');
  adb('shell', 'am', 'force-stop', PKG);
  adb('shell', 'am', 'start', '-n', ACTIVITY);
  const booted = await waitForLog('应用启动', 60_000);
  if (!booted) fail('启动', '60s 内未见「应用启动」');
  else ok('启动(JS 引擎就绪)');
  await sleep(2500);

  // 通知权限弹窗(首次安装会出现)
  const perms = dumpNodes();
  const allow = perms.find((n) => n.text === 'Allow' || n.desc === 'Allow');
  if (allow?.bounds) {
    tap(allow);
    await sleep(1500);
    ok('通过通知权限弹窗');
  }

  // ① 输入代码:点编辑框 → input text(受控输入在 RN 上等同于键入)
  const input = dumpNodes().find((n) => n.editable);
  if (!input) {
    fail('找不到代码输入框', 'class 含 EditText 的节点缺失');
    return;
  }
  tap(input);
  await sleep(600);
  adb('shell', 'input', 'keyevent', 'KEYCODE_MOVE_END');
  for (let i = 0; i < 12; i++) adb('shell', 'input', 'keyevent', 'KEYCODE_DEL');
  adb('shell', 'input', 'text', TICKER);
  await sleep(800);
  // 收键盘(否则可能挡住市场下拉)
  adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await sleep(800);
  ok(`输入代码 ${TICKER}`);

  // ② 市场 → 港股/美股
  const marketBtn = dumpNodes().find((n) => n.desc === '选择市场' || n.desc === 'market');
  if (!marketBtn) {
    fail('找不到市场选择按钮', 'content-desc="选择市场" 缺失');
    return;
  }
  tap(marketBtn);
  await sleep(800);
  const hkOption = dumpNodes().find((n) => (n.text ?? '').trim() === MARKET_LABEL);
  if (!hkOption) {
    fail(`市场菜单里找不到「${MARKET_LABEL}」`);
    return;
  }
  tap(hkOption);
  await sleep(800);
  ok(`市场切换为${MARKET_LABEL}`);

  // ③ 开跑
  adb('logcat', '-c');
  const start = dumpNodes().find((n) => n.clickable && (n.desc === '开始分析' || n.text === '开始分析'));
  if (!start) {
    fail('找不到「开始分析」');
    return;
  }
  tap(start);
  ok('点击「开始分析」');

  const rawTimeout = process.env.SOA_E2E_ANALYSIS_TIMEOUT_MS;
  const parsed = Number(rawTimeout ?? 1_800_000);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    fail('分析超时配置非法', `SOA_E2E_ANALYSIS_TIMEOUT_MS=${rawTimeout}`);
    return;
  }
  const done = await waitForLog('分析结束', parsed);
  if (!done) {
    fail('分析未完成', `${Math.round(parsed / 1000)}s 内未见「分析结束」`);
    return;
  }
  const elapsed = /分析结束:耗时 ([\d.]+)s/.exec(done)?.[1] ?? '?';
  ok(`分析跑完(${elapsed}s)`);

  // ④ 采集链自证:hk 采集 + 代码解析落库
  const collected = /采集完成:(\d+) 根日K/.exec(done);
  if (!collected) fail('采集日志缺失', '未见「采集完成:N 根日K」');
  else ok(`采集完成(${collected[1]} 根日K)`);
  if (!done.includes(STORE_TICKER)) {
    fail(`代码未规范化为 ${STORE_TICKER}`, `logcat 未出现 ${STORE_TICKER}`);
  } else {
    ok(`代码规范化(${TICKER} → ${STORE_TICKER})`);
  }
  const fatal = done.split('\n').filter((l) => /FATAL EXCEPTION|AndroidRuntime: FATAL/.test(l));
  if (fatal.length) fail('运行期崩溃', fatal.slice(0, 3).join('\n'));
  else ok('0 条 FATAL');

  // ⑤ 采集数据页断言(扫屏合并文本)
  await sleep(1500);
  const texts = await scrollAndCollect(9);

  const checks = [
    ['概览 52周高低', texts.includes('52周高低')],
    ['公司画像段', texts.includes('公司画像 · 分析师预期')],
    ['画像 行业 chip', /行业\n.+/.test(texts)],
    ['画像 目标价/评级', texts.includes('目标价')],
    ['日K 换手率列有值', /换手率[\s\S]{0,600}?\d+\.\d{2}%/.test(texts)],
    ['上下文含公司画像段', texts.includes('【公司画像与分析师预期（Yahoo）】')],
    ['上下文含新闻段', new RegExp(`【近期新闻（${MARKET_LABEL} .+? · Google News，\\d+ 条）】`).test(texts)],
    // 块 3 回退:HK 报告行缺 ROE/EPS → 快照源补上（真机曾因 quoteSummary 降级
    // 而恒 N/A —— cookie jar 修复后必须转绿，这是该修复的回归点）
    ['块 3 ROE 非 N/A', /净资产收益率\(ROE\): \d/.test(texts)],
    ['块 3 EPS 非 N/A', /每股收益\(EPS\): \d/.test(texts)],
  ];
  for (const [name, pass] of checks) {
    if (pass) ok(name);
    else fail(name, '未在采集数据页找到');
  }

  if (failures.length) {
    console.error(`\n✗ Android ${MARKET_LABEL} E2E 未通过:${failures.join(', ')}`);
    process.exit(1);
  }
  console.log(`\n✓ Android ${MARKET_LABEL} E2E 通过(${TICKER} → ${STORE_TICKER})`);
}

await main();
