// server /logs 端点(共享实现 app/lib/logs-server.cjs,metro dev + 生产
// server.mjs 双入口)——注入 tmp SOA_LOG_DIR 验证 校验/截断/落盘/轮转。
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import logsServer from '../app/lib/logs-server.cjs';

const { handleLogs, formatTs, MAX_BODY_BYTES, MAX_LOG_BYTES, MAX_MESSAGE_BYTES } = logsServer;

function fakeReq(body: string): AsyncIterable<Uint8Array> {
  const chunks = body ? [Buffer.from(body)] : [];
  return (async function* () {
    for (const c of chunks) yield c;
  })();
}
interface FakeRes {
  calls: Array<{ status: number; body: string }>;
  writeHead(status: number, headers?: Record<string, string>): void;
  end(body?: unknown): void;
}
function fakeRes(): FakeRes {
  const calls: Array<{ status: number; body: string }> = [];
  return {
    calls,
    writeHead(status: number) {
      calls.push({ status, body: '' });
    },
    end(body?: unknown) {
      if (calls.length === 0) calls.push({ status: 200, body: '' });
      calls[calls.length - 1].body = body === undefined ? '' : String(body);
    },
  };
}

describe('server /logs 端点(logs-server.cjs,注入 tmp SOA_LOG_DIR)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'soa-logs-'));
    process.env.SOA_LOG_DIR = dir;
  });
  afterEach(() => {
    delete process.env.SOA_LOG_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it('合法 payload → 200,行格式 <ts> | <LEVEL> | [soa] <msg> (platform:<p>)', async () => {
    const res = fakeRes();
    await handleLogs(
      fakeReq(JSON.stringify({ ts: '2026-08-11 12:00:00', level: 'error', message: 'smoke', platform: 'test' })),
      res,
    );
    expect(res.calls).toEqual([{ status: 200, body: JSON.stringify({ ok: true }) }]);
    const content = readFileSync(path.join(dir, 'soa-ts.log'), 'utf8');
    expect(content).toBe('2026-08-11 12:00:00 | ERROR | [soa] smoke (platform:test)\n');
  });

  it('F02 两段式请求体:CJK 消息跨块边界 → 落盘内容完整(逐块拼接会乱码)', async () => {
    const message = '采集失败:连接超时,重试中(中文日志)';
    const body = JSON.stringify({ level: 'warn', message, platform: 'rn' });
    const cutAt = Buffer.byteLength(body.slice(0, body.indexOf('重'))) + 1; // 从「重」第二字节切开
    const buf = Buffer.from(body, 'utf8');
    const chunks = [buf.subarray(0, cutAt), buf.subarray(cutAt)];
    const req = (async function* () {
      for (const c of chunks) yield c;
    })();
    const res = fakeRes();
    await handleLogs(req, res);
    expect(res.calls).toEqual([{ status: 200, body: JSON.stringify({ ok: true }) }]);
    const content = readFileSync(path.join(dir, 'soa-ts.log'), 'utf8');
    expect(content).toContain(message); // 中文消息完整落盘
  });

  it('F34:消息上限按字节计(CJK 消息 UTF-16 单元 ≈ 3× 字节,0.5M 字符 = 1.5MB 字节须截断)', async () => {
    const res = fakeRes();
    // 0.5M 个 CJK 字符 = 1.5MB UTF-8 字节 > 1MB 上限;旧实现按单元数 0.5M < 1M
    // 不截断 → 落盘 1.5MB 行(上限名不符实)
    const msg = '汉'.repeat(Math.floor(MAX_MESSAGE_BYTES / 2));
    await handleLogs(fakeReq(JSON.stringify({ level: 'info', message: msg, platform: 'web' })), res);
    expect(res.calls[0].status).toBe(200);
    const content = readFileSync(path.join(dir, 'soa-ts.log'), 'utf8');
    const line = content.split('\n').find((l) => l.includes('汉'));
    expect(line).toBeTruthy();
    const msgPart = line!.split('[soa] ')[1]!.split(' (platform:web)')[0];
    const bytes = Buffer.byteLength(msgPart, 'utf8');
    expect(bytes).toBeLessThanOrEqual(MAX_MESSAGE_BYTES); // 字节上限恒守
    expect(bytes).toBeGreaterThan(MAX_MESSAGE_BYTES - 3); // 最多截掉一个多字节字符
  });

  it('ts 缺省 → 用当前时间;多次 append 追加不覆盖', async () => {
    for (let i = 0; i < 2; i++) {
      const res = fakeRes();
      await handleLogs(fakeReq(JSON.stringify({ level: 'info', message: `line-${i}`, platform: 'web' })), res);
      expect(res.calls[0].status).toBe(200);
    }
    const lines = readFileSync(path.join(dir, 'soa-ts.log'), 'utf8').trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \| INFO \| \[soa\] line-0 \(platform:web\)$/);
    expect(lines[1]).toContain('[soa] line-1 (platform:web)');
  });

  it('message 超 4KB → 截断;其余照写', async () => {
    const res = fakeRes();
    await handleLogs(
      fakeReq(JSON.stringify({ level: 'warn', message: 'x'.repeat(MAX_MESSAGE_BYTES + 100), platform: 'web' })),
      res,
    );
    expect(res.calls[0].status).toBe(200);
    const content = readFileSync(path.join(dir, 'soa-ts.log'), 'utf8');
    expect(content).toContain('x'.repeat(MAX_MESSAGE_BYTES));
    expect(content).not.toContain('x'.repeat(MAX_MESSAGE_BYTES + 1));
  });

  it('W3:message/platform 含 \\r\\n → 落盘单行净化(防伪造行)', async () => {
    const res = fakeRes();
    await handleLogs(
      fakeReq(JSON.stringify({ level: 'info', message: 'line1\nline2\r\nline3', platform: 'web\nx' })),
      res,
    );
    expect(res.calls[0].status).toBe(200);
    const lines = readFileSync(path.join(dir, 'soa-ts.log'), 'utf8').trimEnd().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \| INFO \| \[soa\] line1 line2 line3 \(platform:web x\)$/);
  });

  it('非法输入 → 400 {error}(level / message / platform / 非 JSON)', async () => {
    const cases: string[] = [
      JSON.stringify({ level: 'fatal', message: 'x', platform: 'web' }),
      JSON.stringify({ level: 'info', message: 42, platform: 'web' }),
      JSON.stringify({ level: 'info', message: 'x', platform: '' }),
      'not-json{{{',
      '',
    ];
    for (const body of cases) {
      const res = fakeRes();
      await handleLogs(fakeReq(body), res);
      expect(res.calls[0].status).toBe(400);
      expect(JSON.parse(res.calls[0].body)).toHaveProperty('error');
    }
    expect(existsSync(path.join(dir, 'soa-ts.log'))).toBe(false); // 非法输入不落盘
  });

  it('body > 64KB → 413', async () => {
    const res = fakeRes();
    await handleLogs(fakeReq('x'.repeat(MAX_BODY_BYTES + 1)), res);
    expect(res.calls[0].status).toBe(413);
    expect(JSON.parse(res.calls[0].body)).toHaveProperty('error');
  });

  it('文件 ≥5MB → 轮转 soa-ts.log.1 再写新文件', async () => {
    const file = path.join(dir, 'soa-ts.log');
    writeFileSync(file, 'x'.repeat(MAX_LOG_BYTES));
    const res = fakeRes();
    await handleLogs(fakeReq(JSON.stringify({ level: 'info', message: 'after', platform: 'web' })), res);
    expect(res.calls[0].status).toBe(200);
    expect(readFileSync(`${file}.1`, 'utf8')).toBe('x'.repeat(MAX_LOG_BYTES));
    expect(readFileSync(file, 'utf8')).toContain('| INFO | [soa] after (platform:web)');
  });

  it('落盘失败 → 500 {error},不崩(对齐 llmProxy try/catch 风格)', async () => {
    const blocker = path.join(dir, 'blocker');
    writeFileSync(blocker, 'x');
    process.env.SOA_LOG_DIR = path.join(dir, 'blocker', 'sub'); // dirname 是文件 → mkdir ENOTDIR
    const res = fakeRes();
    await handleLogs(fakeReq(JSON.stringify({ level: 'info', message: 'x', platform: 'web' })), res);
    expect(res.calls[0].status).toBe(500);
    expect(JSON.parse(res.calls[0].body).error).toContain('日志写入失败');
  });

  it('formatTs:缺省/非法 ts → 当前时间,合法 ts 保留本地时分', () => {
    expect(formatTs('2026-08-11 12:00:00')).toBe('2026-08-11 12:00:00');
    expect(formatTs(undefined)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(formatTs('not-a-date')).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});
