#!/usr/bin/env node
// 港股/美股真实数据端到端(web)—— 验证 hk/us 链在**真采集**下把指标填满并渲染出来。
// 市场由 SOA_E2E_TICKER 形状决定（数字 → 港股，字母 → 美股）。
//
// 与 tools/web-e2e.mjs 的分工:那个是默认市场(沪深)的 demo 冒烟;本脚本专门钉
// 港股链(请求 00700 → 落库 0700.HK),无 LLM 键时委员会走占位 LLM(demo),
// 但**采集/合成/画像/新闻全是真的**,所以能在不烧 token 的前提下验证:
//   ① 港股市场选择 + 代码规范化(00700 → 0700.HK)
//   ② 概览补齐:52周高低 / YTD / 量比 / 涨速(27 键全有值)
//   ③ 公司画像 · 分析师预期段(assetProfile/financialData/calendarEvents)
//   ④ Google News 情报段(/news-feed 同源代理,web 端 CORS 路径)
//   ⑤ 采集数据 ticker 表换手率列不再是整列 N/A(yahoo-capital: 元数据生效)
//
// 依赖:app/dist(先 `cd app && npx expo export --platform web`)、google-chrome。
// 用法:npm run e2e:web:hk(带 SOA_E2E_VERBOSE=1 看 server 日志),失败退出码 1。
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.SOA_E2E_PORT ?? 8092);
const CDP_PORT = Number(process.env.SOA_E2E_CDP_PORT ?? 9224);
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome';
const ROOT = new URL('..', import.meta.url).pathname;
const TICKER_INPUT = process.env.SOA_E2E_TICKER ?? '00700';
/** 市场由输入形状决定（纯数字 → 港股；字母开头 → 美股），与 src/market.ts
 *  detectMarket 同序。2026-11-19 补：脚本原先写死港股，美股链（usCandidates
 *  符号互探、复权、报表 eps 回退、us-en 新闻/搜索地区）无任何 E2E 覆盖。 */
const MARKET = /^\d/.test(TICKER_INPUT) ? 'hk' : 'us';
const MARKET_LABEL = MARKET === 'hk' ? '港股' : '美股';
const STORE_TICKER =
  process.env.SOA_E2E_STORE_TICKER ??
  (MARKET === 'hk'
    ? `${TICKER_INPUT.replace(/^0+/, '').padStart(4, '0')}.HK`
    : TICKER_INPUT.toUpperCase());
/** 真采集(Yahoo 全量日K 分页 + quoteSummary + 5 分钟K + 新闻)比 demo 慢:
 *  90s 只是「拿到结果」的量级下限,180s 给网络慢的机器留余量。 */
const ANALYZE_TIMEOUT_MS = Number(process.env.SOA_E2E_ANALYZE_MS ?? (process.env.LLM_API_KEY ? 600_000 : 180_000));
/** 真 LLM 三键(缺 → 委员会走占位 stub,分析秒级完成)。经 `node --env-file=.env`
 *  或 shell 环境注入;**不落命令行、不打印值**。 */
const LLM_KEYS = {
  llmApiKey: process.env.LLM_API_KEY ?? process.env.EXPO_PUBLIC_LLM_API_KEY ?? '',
  llmModel: process.env.LLM_MODEL ?? process.env.EXPO_PUBLIC_LLM_MODEL ?? '',
  llmBaseUrl: process.env.LLM_BASE_URL ?? process.env.EXPO_PUBLIC_LLM_BASE_URL ?? '',
};
const REAL_LLM = LLM_KEYS.llmApiKey !== '' && LLM_KEYS.llmModel !== '' && LLM_KEYS.llmBaseUrl !== '';

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

const profile = await mkdtemp(join(tmpdir(), 'soa-e2e-hk-'));
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
      return;
    }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
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
    const nodes = [...document.querySelectorAll('button,[role="button"],[role="option"],div,span')];
    const hit = nodes.reverse().find((e) => (e.textContent || '').trim() === ${JSON.stringify(label)} || e.getAttribute('aria-label') === ${JSON.stringify(label)});
    if (!hit) return 'NOT_FOUND';
    const t = hit.closest('button,[role="button"],[role="option"]') || hit;
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
  } catch {
    /* navigation in flight */
  }
}
await sleep(1500);

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

check('页面渲染', (await evalJs('document.body.innerText')).includes('开始分析'));

// 0) 真 LLM 三键 → 写 localStorage 的 soa:settings(与设置面板同键同形),
//    然后重载让 loadSettings 生效。值只经 process.env 传入,不落日志。
if (REAL_LLM) {
  const seeded = await evalJs(`(() => {
    localStorage.setItem('soa:settings', JSON.stringify({ keys: ${JSON.stringify(LLM_KEYS)} }));
    return localStorage.getItem('soa:settings') !== null;
  })()`);
  check('注入 LLM 三键到 localStorage', seeded === true, 'soa:settings');
  await send('Page.reload', { ignoreCache: true });
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    try {
      if ((await evalJs('document.readyState')) === 'complete') break;
    } catch { /* navigating */ }
  }
  await sleep(1200);
} else {
  console.log('· 未提供 LLM_API_KEY/LLM_MODEL/LLM_BASE_URL → 委员会走占位 stub(仅验证采集链)');
}

// ① 输入港股代码(RNW 受控输入:必须走原生 value setter + input 事件)
const typed = await evalJs(`(() => {
  const input = [...document.querySelectorAll('input')].find((i) =>
    i.getAttribute('aria-label') === '股票代码' || (i.placeholder || '').includes('00700'));
  if (!input) return 'NO_INPUT';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, ${JSON.stringify(TICKER_INPUT)});
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return 'TYPED:' + input.value;
})()`);
check(`输入${MARKET_LABEL}代码`, typed === `TYPED:${TICKER_INPUT}`, String(typed));
// ② 市场下拉 → 港股/美股
if ((await click('选择市场')) !== 'CLICKED') fail('找不到市场选择按钮');
await sleep(600);
if ((await click(MARKET_LABEL)) !== 'CLICKED') fail(`市场菜单里找不到「${MARKET_LABEL}」`);
await sleep(400);
check(`市场切换为${MARKET_LABEL}`, (await evalJs('document.body.innerText')).includes(MARKET_LABEL));

// ③ 开跑(真采集)
if ((await click('开始分析')) !== 'CLICKED') fail('点了「开始分析」但找不到按钮');
let done = false;
const startedAt = Date.now();
const deadline = startedAt + ANALYZE_TIMEOUT_MS;
let lastBeat = 0;
while (Date.now() < deadline) {
  await sleep(1500);
  const body = await evalJs('document.body.innerText');
  if (/分析完成/.test(body)) {
    done = true;
    break;
  }
  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  if (elapsed - lastBeat >= 20) {
    lastBeat = elapsed;
    const chipsDone = (body.match(/· 完成/g) ?? []).length;
    const errLine = body.split('\n').find((l) => l.startsWith('✗'));
    console.log(`  · t=${elapsed}s 角色完成=${chipsDone}/7${errLine ? ` | ${errLine.slice(0, 160)}` : ''}`);
  }
}
check(`${MARKET_LABEL}分析跑完`, done, done ? `${Math.round((Date.now() - (deadline - ANALYZE_TIMEOUT_MS)) / 1000)}s` : `${ANALYZE_TIMEOUT_MS / 1000}s 内未见「分析完成」`);
if (!done) {
  const body = await evalJs('document.body.innerText');
  console.error(`\n--- 页面正文(尾部) ---\n${body.slice(-1200)}`);
  console.error(`\n--- 异常/console.error (${problems.length}) ---`);
  for (const p of problems.slice(0, 10)) console.error(`  - ${p.slice(0, 300)}`);
  fail('分析未完成,后续断言无法进行');
}

// ③b 真 LLM 断言:委员会报告不得是占位 stub 文本
if (REAL_LLM) {
  const body = await evalJs('document.body.innerText');
  check('真实 LLM 生效', !body.includes('演示模式报告') && !body.includes('[演示·'), '无「演示模式报告」占位');
}

// ④ 采集数据 tab:概览补齐 / 画像 chips / 换手率列
await click('采集数据');
await sleep(1200);
const data = await evalJs('document.body.innerText');
check('概览 52周高低', data.includes('52周高低'));
check('概览 YTD 非 N/A', !/YTD\nN\/A/.test(data));
check('公司画像段', data.includes('公司画像 · 分析师预期'));
check('画像行业 chip', /行业\nCommunication Services/.test(data));
check('画像目标价/评级', data.includes('目标价') && (data.includes('强烈买入') || data.includes('买入') || data.includes('持有')));
// 换手率列:本月任何一行出现具体数值(而非整列 N/A)
const turnoverNumeric = /换手率[\s\S]{0,400}?\d+\.\d{2}%/.test(data);
check('日K 换手率列有值', turnoverNumeric);
// 2026-11-19 新增:盈利能力 chips 对港股改读 yahoo-profile TTM 比率(旧实现只认
// F10 → 港美整块不渲染);概览行新增股息率/每股收益(旧实现采了不显示)
check('盈利能力 TTM chips', data.includes('盈利能力指标(TTM)') && /净资产收益率\(ROE\)\n\d/.test(data));
check('盈利能力 含毛利率/净利率', data.includes('销售毛利率') && data.includes('净利率'));
check('概览含股息率/每股收益', data.includes('股息率') && data.includes('每股收益'));

// ⑤ 分析上下文:画像段 + 新闻段(块 1.5 / 块 4)
const ctx = await evalJs(`(() => {
  const el = [...document.querySelectorAll('*')].find((e) => (e.innerText || '').startsWith('【技术指标') || (e.innerText || '').includes('Stock: '));
  return el ? el.innerText : document.body.innerText;
})()`);
check('上下文含公司画像段', ctx.includes('【公司画像与分析师预期（Yahoo）】'));
check('上下文含新闻段', new RegExp(`【近期新闻（${MARKET_LABEL} .+? · Google News，\\d+ 条）】`).test(ctx));
// 块 3 回退:HK 报告行缺 ROE/EPS → 快照源补上,不得再是纯 N/A
check('块 3 ROE 非 N/A', /净资产收益率\(ROE\): \d/.test(ctx));
check('块 3 EPS 非 N/A', /每股收益\(EPS\): \d/.test(ctx));
// 新闻时效:不得混进 2 年前的条目(时效过滤 18 个月)
const years = [...ctx.matchAll(/- (20\d{2})-\d{2}-\d{2} /g)].map((m) => Number(m[1]));
check('新闻均为近期(>= 前一年)', years.length === 0 || Math.min(...years) >= new Date().getFullYear() - 1, years.join(','));
check('上下文含 52 周高低/量比等补齐指标', /Weekly|52/.test(ctx) || /volume/i.test(ctx));

console.log(`\n采集到的异常/console.error: ${problems.length}`);
for (const p of problems.slice(0, 5)) console.log(`  - ${p}`);

const failed = checks.filter((c) => !c.ok);
if (failed.length) fail(`${failed.length} 项检查未通过: ${failed.map((f) => f.name).join(', ')}`);
if (problems.some((p) => p.startsWith('exception'))) fail('页面出现未捕获异常(见上)');
console.log(`\n✓ ${MARKET_LABEL} web E2E 通过(${TICKER_INPUT} → ${STORE_TICKER})`);
cleanup();
process.exit(0);
