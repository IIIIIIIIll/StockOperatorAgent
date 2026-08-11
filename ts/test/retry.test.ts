import { describe, expect, it } from 'vitest';
import { invokeWithRetry } from '../src/retry.ts';

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
