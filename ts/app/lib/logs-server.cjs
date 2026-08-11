// 日志汇聚端点共享实现 —— metro dev 中间件(metro.config.js)与生产 server
// (server.mjs)双份入口复用同一份 校验/截断/落盘/轮转 逻辑,两处行为必须一致
// (对齐 /llm-proxy 双份先例,但收敛为单文件防漂移)。
// CJS 原因:metro.config.js 是 CJS(require),server.mjs 是 ESM(import)——
// CJS 模块两者都能加载;不用 .ts 是因为 metro 进程不带 --experimental-strip-types。
// 行格式与 ts/src/log.ts 的 RN 沙盒侧对齐(注释互指):
//   <ts> | <LEVEL> | [soa] <message> (platform:<platform>)
// <ts> 为本地时间 YYYY-MM-DD HH:mm:ss;message 截断 4KB;文件 ≥5MB 轮转 .1。
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const LEVELS = new Set(['info', 'warn', 'error', 'debug']);
const MAX_BODY_BYTES = 64 * 1024; // 请求体 ≤64KB,超限 413
const MAX_MESSAGE_BYTES = 4 * 1024; // message 截断 4KB
const MAX_LOG_BYTES = 5 * 1024 * 1024; // 文件 ≥5MB → rename .1

/** 日志文件路径:SOA_LOG_DIR 覆盖,默认 <repo>/logs/soa-ts.log(server cwd=ts/app)。 */
function logFilePath() {
  const dir = process.env.SOA_LOG_DIR || path.join(process.cwd(), '..', 'logs');
  return path.join(dir, 'soa-ts.log');
}

/** ts 字段缺/非法 → 当前时间;输出本地时间 YYYY-MM-DD HH:mm:ss。 */
function formatTs(ts) {
  const d = ts ? new Date(ts) : new Date();
  if (Number.isNaN(d.getTime())) return formatTs(undefined);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** append 前 stat:≥5MB → rename .1 再写新文件。 */
function appendLogLine(line) {
  const file = logFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const st = fs.existsSync(file) ? fs.statSync(file) : null;
  if (st && st.size >= MAX_LOG_BYTES) fs.renameSync(file, `${file}.1`);
  fs.appendFileSync(file, `${line}\n`);
}

/** POST /logs:校验 + 截断 + 落盘;非法输入 → 400 {error}。失败 → 5xx {error}
 * (对齐 llmProxy try/catch 风格,不崩 server)。 */
async function handleLogs(req, res) {
  try {
    let body = '';
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '日志请求体超过 64KB 限制' }));
        return;
      }
      body += chunk;
    }
    let data;
    try {
      data = body ? JSON.parse(body) : {};
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '日志请求体不是合法 JSON' }));
      return;
    }
    const { level, message, platform } = data ?? {};
    if (typeof level !== 'string' || !LEVELS.has(level)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `level 非法:${String(level)}(需 info|warn|error|debug)` }));
      return;
    }
    if (typeof message !== 'string') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'message 需为字符串' }));
      return;
    }
    if (typeof platform !== 'string' || platform.length === 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'platform 需为非空字符串' }));
      return;
    }
    const truncated = message.length > MAX_MESSAGE_BYTES ? message.slice(0, MAX_MESSAGE_BYTES) : message;
    appendLogLine(`${formatTs(data?.ts)} | ${level.toUpperCase()} | [soa] ${truncated} (platform:${platform})`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `日志写入失败:${String(err?.message ?? err)}` }));
  }
}

module.exports = { handleLogs, logFilePath, formatTs, appendLogLine, MAX_LOG_BYTES, MAX_MESSAGE_BYTES, MAX_BODY_BYTES };
