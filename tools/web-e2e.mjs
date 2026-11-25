#!/usr/bin/env node
// Web 端到端冒烟(D2:把 2026-11-08 手工跑过的链路固化成可重跑的工具)。
//
// 做什么:起 app/server.mjs(静态 dist + 代理)→ 起 headless Chrome(CDP)→
//   ① 页面加载、无未捕获异常
//   ② 跑一次分析,等完成,断言 7 个角色 chip 完成
//      - 无 LLM 键(全新 Chrome profile + 构建时没烘焙 EXPO_PUBLIC_LLM_*)→ 秒级占位报告
//      - 有键(web 构建时烘了 EXPO_PUBLIC_LLM_*=…)→ 真实分析,浏览器实测十几分钟
//   ③ 抽屉:设置 / 历史二级页可打开
//   ④ 「决策价位」Tab(2026-11-25 补,与安卓 e2e 同一组断言)
// 依赖:google-chrome(或 CHROME 环境变量)、app/dist(先跑 expo export)。
// 用法:npm run e2e:web [-- --shot <path>]
//   SOA_E2E_ANALYSIS_TIMEOUT_MS  分析上限(默认 30 分钟;演示模式可调小以便快速失败)
// 失败时退出码非 0,并打印收集到的 exception/console.error。
//
// 为什么不引 puppeteer:Node 22 自带 WebSocket,CDP 只要几十行;少一个 100MB 依赖。
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.SOA_E2E_PORT ?? 8091);
const CDP_PORT = Number(process.env.SOA_E2E_CDP_PORT ?? 9223);
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome';
const ROOT = new URL('..', import.meta.url).pathname;

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

if (!existsSync(join(ROOT, 'app', 'dist', 'index.html'))) {
  fail('app/dist 不存在:E2E 跑的是打包产物,先 `cd app && npx expo export --platform web`');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(url, ms = 30000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  return false;
}

const server = spawn(process.execPath, ['--experimental-strip-types', 'server.mjs'], {
  cwd: join(ROOT, 'app'),
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (d) => process.env.SOA_E2E_VERBOSE && process.stdout.write(`[server] ${d}`));
server.stderr.on('data', (d) => process.stderr.write(`[server:err] ${d}`));

const profile = await mkdtemp(join(tmpdir(), 'soa-e2e-chrome-'));
const chrome = spawn(
  CHROME,
  ['--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, 'about:blank'],
  { stdio: 'ignore' },
);

let ws;
const cleanup = () => {
  try { ws?.close(); } catch { /* ignore */ }
  chrome.kill('SIGKILL');
  server.kill('SIGKILL');
};
process.on('exit', cleanup);

if (!(await waitFor(`http://127.0.0.1:${PORT}/`))) fail('app/server.mjs 没起来');
if (!(await waitFor(`http://127.0.0.1:${CDP_PORT}/json/version`))) fail('headless Chrome 没起来');

const target = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' })).json();
ws = new WebSocket(target.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();
const problems = [];

await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
  ws.onmessage = (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.data);
    } catch {
      return; // 非 JSON 帧(CDP 偶发心跳/二进制)忽略,不能让冒烟脚本自己崩
    }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      problems.push(`exception: ${d.exception?.description ?? d.text}`);
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      problems.push(`console.error: ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
    }
  };
});

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};

const click = async (label) =>
  evalJs(`(() => {
    const nodes = [...document.querySelectorAll('button,[role="button"],div,span')];
    const hit = nodes.reverse().find((e) => (e.textContent || '').trim() === ${JSON.stringify(label)} || e.getAttribute('aria-label') === ${JSON.stringify(label)});
    if (!hit) return 'NOT_FOUND';
    const t = hit.closest('button,[role="button"]') || hit;
    t.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    t.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    t.click();
    return 'CLICKED';
  })()`);

await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
for (let i = 0; i < 120; i++) {
  await sleep(250);
  try {
    if ((await evalJs('document.readyState')) === 'complete') break;
  } catch { /* navigation in flight */ }
}
await sleep(1500);

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const body0 = await evalJs('document.body.innerText');
check('页面渲染', body0.includes('开始分析'), `${body0.length} 字符正文`);

// demo 链路:浏览器 profile 是全新的 → 无 LLM 键 → 占位 LLM,秒级。
// 若 web 构建时烘了 EXPO_PUBLIC_LLM_*(loadSettings 的环境兜底),这里就是**真实**
// 分析 —— 上限必须可调,否则 21 分钟的真实跑会被 90s 的旧循环当作失败。
const rawTimeout = process.env.SOA_E2E_ANALYSIS_TIMEOUT_MS;
const analysisTimeoutMs = Number(rawTimeout ?? 1_800_000);
if (!Number.isFinite(analysisTimeoutMs) || analysisTimeoutMs <= 0) {
  fail(`SOA_E2E_ANALYSIS_TIMEOUT_MS=${rawTimeout} —— 需为正数毫秒`);
}
if ((await click('开始分析')) !== 'CLICKED') fail('点了「开始分析」但找不到按钮');
const analysisStart = Date.now();
let done = false;
let uiError = null;
for (let i = 0; i < Math.ceil(analysisTimeoutMs / 1000); i++) {
  await sleep(1000);
  const t = await evalJs('document.body.innerText');
  if (/分析完成/.test(t)) {
    done = true;
    break;
  }
  // 启动守卫的即时错误是「屏幕上已写着原因」,没必要等满上限
  uiError = /^\s*✗.*$/m.exec(t)?.[0]?.trim() ?? null;
  if (uiError) break;
}
if (uiError) fail(`分析被 UI 拒绝: ${uiError}`);
const elapsedS = Math.round((Date.now() - analysisStart) / 1000);
check('分析跑完', done, `${elapsedS}s · ${elapsedS < 15 ? '演示模式' : '真实 LLM'}`);
const body1 = await evalJs('document.body.innerText');
const chips = (body1.match(/· 完成/g) ?? []).length;
check('角色 chip 全部完成', chips >= 7, `${chips} 个 ·完成`);

await click('打开菜单');
await sleep(600);
const drawer = await evalJs('document.body.innerText');
check('抽屉菜单', /设置/.test(drawer) && /历史/.test(drawer));
await click('设置');
await sleep(700);
check('设置页', /LLM/.test(await evalJs('document.body.innerText')));

// 「决策价位」Tab:与安卓 e2e 的 ⑤.5 同一组断言。它是合成 Tab(不属任何角色),
// 只消费《最终结论》文本 + store 日K —— 所以这一步同时验两件事:Tab 真的在拼
// 且点了不白屏;抽取结果(或空态声明)真的画出来了。
await click('决策价位');
await sleep(1200);
const levels = await evalJs('document.body.innerText');
if (!/决策价位 · \S/.test(levels)) {
  check('决策价位 Tab', false, '标题「决策价位 · <ticker>」缺失');
} else if (!/价位分布/.test(levels)) {
  check('决策价位 Tab', false, '价位分布卡片缺失');
} else if (!/(报告方向|信心度)/.test(levels)) {
  check('决策价位 Tab', false, '方向/信心度格子缺失');
} else {
  // 两种合法形态:抽到价位(明细里的 ±% 行) 或 空态提示(演示占位报告)
  const empty = /未提取到价位/.test(levels);
  const rows = (levels.match(/^[+-]?\d+\.\d{1,2}%$/gm) ?? []).length;
  check(
    '决策价位 Tab',
    empty || rows > 0,
    empty ? '空态提示正常' : `列出 ${rows} 个价位百分比`,
  );
}

// 可选截图(真实跑一次十几分钟,失败时没有截图很难定位)
const shotAt = process.argv.indexOf('--shot');
if (shotAt > -1 && process.argv[shotAt + 1]) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(process.argv[shotAt + 1], Buffer.from(r.data, 'base64'));
  console.log(`  截图 → ${process.argv[shotAt + 1]}`);
}

console.log(`\n采集到的异常/console.error: ${problems.length}`);
for (const p of problems.slice(0, 5)) console.log(`  - ${p}`);

const failed = checks.filter((c) => !c.ok);
if (failed.length) fail(`${failed.length} 项检查未通过: ${failed.map((f) => f.name).join(', ')}`);
if (problems.some((p) => p.startsWith('exception'))) fail('页面出现未捕获异常(见上)');
console.log('\n✓ web E2E 冒烟通过');
cleanup();
process.exit(0);
