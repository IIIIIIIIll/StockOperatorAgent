// LLM 调用重试 —— 移植自 Python core/llms/retry.py
// 可恢复：429/500/502/503/504/连接/超时 → 指数退避 ×3（1s 起，上限 8s）
// 业务错误（400/认证）直抛零延迟；耗尽 reraise 原异常
// 每次退避前 warn(attempt/异常类型/下次间隔),对齐 Python before_sleep。
import { warn } from './log.ts';

const ATTEMPTS = 3;
const BASE_DELAY = 1.0;
const MAX_DELAY = 8.0;
const RETRYABLE_STATUS: Record<number, boolean> = {
  429: true,
  500: true,
  502: true,
  503: true,
  504: true,
};

function isRetryable(exc: unknown): boolean {
  if (typeof exc !== 'object' || exc === null) return false;
  const e = exc as { status?: unknown; message?: string };
  if (typeof e.status === 'number' && RETRYABLE_STATUS[e.status]) return true;
  const msg = typeof e.message === 'string' ? e.message.toLowerCase() : '';
  return /connection|connect error|timeout|timed out|network/i.test(msg);
}

export type LlmCallable =
  | { invoke(payload: unknown, config?: unknown): Promise<unknown> }
  | ((payload: unknown, config?: unknown) => Promise<unknown>);

export async function invokeWithRetry(
  llm: LlmCallable,
  payload: unknown,
  config?: unknown,
  opts?: { attempts?: number; baseDelay?: number },
): Promise<unknown> {
  const attempts = opts?.attempts ?? ATTEMPTS;
  const baseDelay = opts?.baseDelay ?? BASE_DELAY;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return typeof llm === 'function' ? await llm(payload, config) : await llm.invoke(payload, config);
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === attempts) throw err;
      const delay = Math.min(baseDelay * 2 ** (attempt - 1), MAX_DELAY);
      // 异常类型探针:任意 throw 值,运行时 shape 不可静态化(非 Error 实例也取 constructor.name)
      let errType = 'Error';
      if (err && typeof err === 'object' && 'constructor' in err) {
        const ctor = err.constructor;
        if (typeof ctor === 'function' && ctor.name) errType = ctor.name;
      }
      warn(`LLM invoke attempt ${attempt} failed with ${errType}; retrying in ${delay}s`);
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, delay * 1000);
      await promise;
    }
  }
  throw lastErr;
}
