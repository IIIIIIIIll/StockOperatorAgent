// LLM 调用重试 —— 移植自 Python core/llms/retry.py
// 可恢复：429/500/502/503/504/连接/超时 → 指数退避 ×3（1s 起，上限 8s）
// 业务错误（400/认证）直抛零延迟；耗尽 reraise 原异常
// 每次退避前 warn(attempt/异常类型/下次间隔),对齐 Python before_sleep。
// 08-11-ts-streaming-output:streamWithRetry —— invokeWithRetry 的流式孪生,
// 同退避/可恢复判定/警告模式;迭代 llm.stream() + concat 聚合,onDelta/onRetry 回调。
import { concat } from '@langchain/core/utils/stream';
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

// ─── 流式调用 + 重试（方案 B agent 级流式,design.md §3） ──────────────────

export interface StreamableLlm {
  stream(payload: unknown, config?: unknown): Promise<AsyncIterable<unknown>> | AsyncIterable<unknown>;
}

export interface StreamWithRetryOptions {
  attempts?: number; // 对齐 invokeWithRetry
  baseDelay?: number;
  /** 每文本 chunk 增量实时回调(空/工具轮 chunk 不回调)。 */
  onDelta?: (delta: string) => void;
  /** 退避前回调(attempt 从 1 计)。 */
  onRetry?: (attempt: number, err: unknown) => void;
}

/** chunk 文本增量提取:content 为 string 直接取;数组取文本段 join;
 *  空/undefined 跳过(工具轮 chunk content 为空,天然过滤)。 */
function extractDeltaText(chunk: unknown): string {
  if (typeof chunk !== 'object' || chunk === null || !('content' in chunk)) return '';
  const content = chunk.content; // unknown:经 'content' in 收窄
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === 'string') return block;
        if (typeof block === 'object' && block !== null && 'text' in block) return block.text;
        return undefined;
      })
      .filter((t): t is string => typeof t === 'string')
      .join('');
  }
  return '';
}

/** 流式 LLM 调用 + 重试:迭代 llm.stream(),文本增量实时 onDelta;聚合用
 *  @langchain/core/utils/stream 的 concat(正确处理 content 数组/
 *  tool_call_chunks → tool_calls);失败(含流中途断)同 invokeWithRetry
 *  语义(1s 起 ×2 上限 8s ≤3 次),退避前 warn 照 invokeWithRetry 模式,
 *  耗尽 reraise。返回聚合后消息({content, tool_calls})。 */
export async function streamWithRetry(
  llm: StreamableLlm,
  payload: unknown,
  config?: unknown,
  opts?: StreamWithRetryOptions,
): Promise<{ content: unknown; tool_calls?: unknown }> {
  const attempts = opts?.attempts ?? ATTEMPTS;
  const baseDelay = opts?.baseDelay ?? BASE_DELAY;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      let aggregated: unknown;
      for await (const chunk of await llm.stream(payload, config)) {
        const text = extractDeltaText(chunk);
        if (text) opts?.onDelta?.(text);
        aggregated = aggregated === undefined ? chunk : concat(aggregated as never, chunk as never);
      }
      if (aggregated === undefined) return { content: '' }; // 空流(零 chunk)
      if (typeof aggregated === 'object' && aggregated !== null) {
        // 已知:langchain stream chunk 均为消息对象(AIMessageChunk/AIMessage),
        // concat 聚合后仍是消息——原样返回(调用方读 content/tool_calls,且
        // state 消息通道需要真实消息实例,重建 {content,tool_calls} 会破坏
        // LangGraph 消息 coercion)。
        return aggregated as { content: unknown; tool_calls?: unknown };
      }
      // 非对象聚合(如纯字符串 chunk 的假件):不丢文本,原样作为 content 返回。
      return { content: aggregated };
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
      warn(`LLM stream attempt ${attempt} failed with ${errType}; retrying in ${delay}s`);
      opts?.onRetry?.(attempt, err);
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, delay * 1000);
      await promise;
    }
  }
  throw lastErr;
}
