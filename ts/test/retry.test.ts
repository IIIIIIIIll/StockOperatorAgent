import { describe, expect, it } from 'vitest';
import { AIMessageChunk } from '@langchain/core/messages';
import { invokeWithRetry, streamWithRetry } from '../src/retry.ts';

function failingLlm(failures: Array<{ status?: number; message?: string }>, okContent = 'ok') {
  let calls = 0;
  const fn = async () => {
    calls++;
    const failure = failures.shift();
    if (failure) {
      const err = new Error(failure.message ?? 'err') as Error & { status?: number };
      if (failure.status) err.status = failure.status;
      throw err;
    }
    return { content: okContent };
  };
  (fn as unknown as { invoke: unknown }).invoke = fn;
  return { llm: fn, calls: () => calls };
}

// 无 mock 框架:临时替换 console.warn 捕获输出,finally 还原。
function captureWarn(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const orig = console.warn;
  console.warn = ((...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  }) as typeof console.warn;
  return { lines, restore: () => { console.warn = orig; } };
}

describe('retry (AC4)', () => {
  it('429 retries 3 times with backoff then succeeds', async () => {
    const { llm, calls } = failingLlm([
      { status: 429, message: 'rate limited' },
      { status: 429, message: 'rate limited' },
    ]);
    const out = await invokeWithRetry(llm, {}, {}, { baseDelay: 0.001 });
    expect(out).toEqual({ content: 'ok' });
    expect(calls()).toBe(3); // 1 首 + 2 重试
  });

  it('5xx status retried', async () => {
    const { llm, calls } = failingLlm([{ status: 503, message: 'unavailable' }]);
    await invokeWithRetry(llm, {}, {}, { baseDelay: 0.001 });
    expect(calls()).toBe(2);
  });

  it('business error (400) throws immediately, zero retries', async () => {
    const { llm, calls } = failingLlm([{ status: 400, message: 'bad request' }]);
    const cap = captureWarn();
    try {
      await expect(invokeWithRetry(llm, {}, {}, { baseDelay: 0.001 })).rejects.toThrow('bad request');
    } finally {
      cap.restore();
    }
    expect(calls()).toBe(1);
    expect(cap.lines).toHaveLength(0); // 业务错误直抛,不退避不 warn
  });

  it('退避前 warn 发出 attempt/异常类型/下次间隔(AC4,对齐 Python before_sleep)', async () => {
    const { llm, calls } = failingLlm([
      { status: 429, message: 'rate limited' },
      { status: 503, message: 'unavailable' },
    ]);
    const cap = captureWarn();
    try {
      await invokeWithRetry(llm, {}, {}, { baseDelay: 0.001 });
    } finally {
      cap.restore();
    }
    expect(calls()).toBe(3); // 1 首 + 2 重试
    expect(cap.lines).toHaveLength(2); // 每次退避前一条
    expect(cap.lines[0]).toContain('LLM invoke attempt 1 failed with Error; retrying in 0.001s');
    expect(cap.lines[1]).toContain('LLM invoke attempt 2 failed with Error; retrying in 0.002s');
  });

  it('exhausted retries reraise original error', async () => {
    const { llm, calls } = failingLlm([
      { status: 429 },
      { status: 429 },
      { status: 429 },
    ]);
    await expect(invokeWithRetry(llm, {}, {}, { attempts: 3, baseDelay: 0.001 })).rejects.toThrow('err');
    expect(calls()).toBe(3);
  });
});

// ─── streamWithRetry(R2 agent 级流式) ─────────────────────────────────────

/** 流式假 LLM:按调用序返回每轮脚本——chunks 先输出、error 后抛(模拟流中途断)。 */
function streamingLlm(attempts: Array<{ chunks?: string[]; error?: { status?: number; message?: string } }>) {
  let calls = 0;
  const stream = async function* () {
    calls++;
    const attempt = attempts[Math.min(calls - 1, attempts.length - 1)] ?? { chunks: [] };
    for (const c of attempt.chunks ?? []) yield { content: c };
    if (attempt.error) {
      const err = new Error(attempt.error.message ?? 'err') as Error & { status?: number };
      if (attempt.error.status) err.status = attempt.error.status;
      throw err;
    }
  };
  return { llm: { stream }, calls: () => calls };
}

describe('streamWithRetry (R2)', () => {
  it('聚合顺序:多 chunk 按序 concat,onDelta 逐 chunk 回调', async () => {
    const { llm, calls } = streamingLlm([{ chunks: ['你', '好', '世', '界'] }]);
    const deltas: string[] = [];
    const out = await streamWithRetry(llm, {}, {}, { onDelta: (d) => deltas.push(d) });
    expect(calls()).toBe(1);
    expect(out.content).toBe('你好世界');
    expect(deltas).toEqual(['你', '好', '世', '界']);
  });

  it('可恢复错误(429)→ onRetry 触发后重试成功', async () => {
    const { llm, calls } = streamingLlm([
      { error: { status: 429, message: 'rate limited' } },
      { chunks: ['重试成功'] },
    ]);
    const retries: Array<{ attempt: number; message: string }> = [];
    const out = await streamWithRetry(llm, {}, {}, {
      baseDelay: 0.001,
      onRetry: (attempt, err) => retries.push({ attempt, message: (err as Error).message }),
    });
    expect(calls()).toBe(2);
    expect(out.content).toBe('重试成功');
    expect(retries).toEqual([{ attempt: 1, message: 'rate limited' }]);
  });

  it('流中途断(部分 chunk 后抛连接错误)→ 重试后完整聚合(失败尝试丢弃)', async () => {
    const { llm, calls } = streamingLlm([
      { chunks: ['部'], error: { message: 'connection reset' } },
      { chunks: ['完整'] },
    ]);
    const out = await streamWithRetry(llm, {}, {}, { baseDelay: 0.001 });
    expect(calls()).toBe(2);
    expect(out.content).toBe('完整');
  });

  it('业务错误(400)直抛零延迟、onRetry 不触发、无 warn', async () => {
    const { llm, calls } = streamingLlm([{ error: { status: 400, message: 'bad request' } }]);
    const retries: number[] = [];
    const cap = captureWarn();
    try {
      await expect(
        streamWithRetry(llm, {}, {}, { baseDelay: 0.001, onRetry: (n) => retries.push(n) }),
      ).rejects.toThrow('bad request');
    } finally {
      cap.restore();
    }
    expect(calls()).toBe(1);
    expect(retries).toHaveLength(0);
    expect(cap.lines).toHaveLength(0);
  });

  it('退避前 warn 发出 attempt/异常类型/下次间隔(照 invokeWithRetry 模式)', async () => {
    const { llm, calls } = streamingLlm([
      { error: { status: 429 } },
      { error: { status: 503 } },
      { chunks: ['ok'] },
    ]);
    const cap = captureWarn();
    try {
      await streamWithRetry(llm, {}, {}, { baseDelay: 0.001 });
    } finally {
      cap.restore();
    }
    expect(calls()).toBe(3);
    expect(cap.lines).toHaveLength(2);
    expect(cap.lines[0]).toContain('LLM stream attempt 1 failed with Error; retrying in 0.001s');
    expect(cap.lines[1]).toContain('LLM stream attempt 2 failed with Error; retrying in 0.002s');
  });

  it('耗尽重试 reraise 原异常', async () => {
    const { llm, calls } = streamingLlm([
      { error: { status: 429 } },
      { error: { status: 429 } },
      { error: { status: 429 } },
    ]);
    await expect(streamWithRetry(llm, {}, {}, { attempts: 3, baseDelay: 0.001 })).rejects.toThrow('err');
    expect(calls()).toBe(3);
  });

  it('工具轮流:空 content chunk + tool_call_chunks → onDelta 跳过、聚合出 tool_calls', async () => {
    const stream = async function* () {
      yield new AIMessageChunk({
        content: '',
        tool_call_chunks: [{ name: 'web_search', args: '{"query":"q1"}', id: 'call_1', index: 0, type: 'tool_call_chunk' }],
      });
      yield new AIMessageChunk({ content: '' });
    };
    const deltas: string[] = [];
    const out = await streamWithRetry({ stream }, {}, {}, { onDelta: (d) => deltas.push(d) });
    expect(deltas).toEqual([]); // 工具轮无文本增量
    expect(out.tool_calls).toEqual([{ name: 'web_search', args: { query: 'q1' }, id: 'call_1', type: 'tool_call' }]);
    expect(out.content).toBe('');
  });

  it('content 数组形态(文本段)→ join 后回调', async () => {
    const stream = async function* () {
      yield { content: [{ type: 'text', text: 'AA' }, { type: 'text', text: 'BB' }] };
    };
    const deltas: string[] = [];
    const out = await streamWithRetry({ stream }, {}, {}, { onDelta: (d) => deltas.push(d) });
    expect(deltas).toEqual(['AABB']);
    expect(out.content).toEqual([{ type: 'text', text: 'AA' }, { type: 'text', text: 'BB' }]);
  });
});
