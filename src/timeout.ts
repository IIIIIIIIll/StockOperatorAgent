// 网络超时原语(平台中立,零 node:/零 RN 依赖,进 metro 图安全)。
//
// 为什么需要两个原语而不是一个:
// - AbortController 只能中断「还没开始的 HTTP 请求」。fetch resolve 只代表响应头
//   到齐,body 是独立流 —— 卡住的 body 会让整条 promise 链永不 settle(代理锁
//   随之挂住,后续请求全 429)。这类卡死只能靠 Promise.race 让「调用方」有界。
// - 因此:请求腿用 abortRequestAfter(可真取消),body 腿用 raceBodyTimeout(仅
//   让链有界,底层 socket 交给 undici 自身超时/GC)。
//
// 错误家族不在此模块决定:各数据源各自抛自家的 typed error(CollectError /
// YahooApiError / …),通过 onTimeout 工厂注入,避免跨源异常泄漏。

/** 给一次请求套上超时信号。返回 { signal, abort, done }:done() 在 finally 里调用,
 *  清理计时器;abort() 供调用方在 signal.aborted 后判断「是不是我超的时」。 */
export function abortRequestAfter(timeoutMs: number): {
  signal: AbortSignal;
  abort: () => void;
  done: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    abort: () => controller.abort(),
    done: () => clearTimeout(timer),
  };
}

/** 读取响应体,并把「body 流完」圈进超时窗口。超时 → onTimeout() 产出的错误。 */
export async function raceBodyTimeout<T>(
  read: () => Promise<T>,
  timeoutMs: number,
  onTimeout: () => Error,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(onTimeout()), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// ─── 取消(AbortSignal)原语 ────────────────────────────────────────────────
// 取消必须与「失败」区分开:UI 上用户点了取消不是错误,不能弹红条。判据就靠
// `name === 'AbortError'`,所以错误构造集中在这里,不各处 new DOMException
// (Hermes 上 DOMException 由 expo winter 运行时补齐,时机不保证)。

/** signal 的取消原因 → Error。优先用 signal.reason(标准语义,Node/浏览器都填
 *  DOMException),缺失时造一个 name='AbortError' 的普通 Error。 */
export function abortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  if (reason instanceof Error) return reason;
  const err = new Error('操作已取消');
  err.name = 'AbortError';
  return err;
}

/** 是否为取消而非失败。 */
export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/** 已取消 → 抛 AbortError;未取消 → 无副作用。用于每个可能很长的循环入口。 */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal);
}

/** 把一个**已在飞行中**的 Promise 与取消信号挂在一起(评审 2026-11-21)。
 *
 *  用途:第三方工具调用(如 web_search 的 fetch)只接受 await,没有接入口让我们
 *  中断它。signal 先到 → 立即 reject AbortError,调用方的 run() 能结算,socket
 *  由底层自行回收;原 Promise 的结果被丢弃(不再是死等 300s 体读取)。
 *  注意:这是「不等它」而不是「真中断」——写清楚,免后人误以为能停 I/O。 */
export function raceAbort<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

/** 可取消的 sleep(退避计时器用)。取消 → reject AbortError,计时器同时清掉,
 *  避免「取消后仍被迟到的 resolve 佯装成功」。 */
export function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError(signal));
  if (!signal) return new Promise<void>((resolve) => setTimeout(resolve, ms));
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
