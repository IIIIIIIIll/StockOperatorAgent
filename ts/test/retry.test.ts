import { describe, expect, it } from 'vitest';
import { invokeWithRetry } from '../src/retry';

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
    await expect(invokeWithRetry(llm, {}, {}, { baseDelay: 0.001 })).rejects.toThrow('bad request');
    expect(calls()).toBe(1);
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
