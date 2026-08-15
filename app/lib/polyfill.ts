// Hermes 无全局 Buffer;node-tdx-market 打包产物用 Buffer.alloc/from/concat。
// 注意:exhq-types.js 在模块顶层就执行 Buffer.from(...)(EXHQ_SETUP_DATA 常量),
// 早于 index.ts 的函数体——所以本模块必须作为 index.ts 的**第一个 import** 求值,
// 在 App 依赖图(含 node-tdx-market)之前装上全局。
import { Buffer } from 'buffer';

(globalThis as { Buffer?: unknown }).Buffer = Buffer;

// Node 契约:Buffer#subarray 返回 Buffer(带 readUInt32BE 等全部方法)。部分
// 运行时(含 Hermes 原生/第三方 Buffer 实现)的 subarray 直接继承 Uint8Array,
// 返回裸 Uint8Array——node-tdx-market 的 extractFrame 用 subarray 切帧,后续
// decodeResponse 读 readUInt32BE 即 "undefined is not a function"(诊断 2026-08-15)。
// 统一包一层:仍是共享内存视图(零拷贝),但恢复完整 Buffer API;Buffer 自身已
// 覆盖 subarray 的实现(本包)经 isBuffer 短路,不重复包装。
const origSubarray = Buffer.prototype.subarray;
Buffer.prototype.subarray = function subarrayView(start?: number, end?: number): Buffer {
  const view = origSubarray.call(this, start, end) as Uint8Array;
  if (Buffer.isBuffer(view)) return view;
  return Buffer.from(view.buffer, view.byteOffset, view.byteLength);
};

// Node 契约:setTimeout/setInterval 返回带 unref()/ref() 的 Timeout 句柄
// (node-tdx-market startHeartbeat/scheduleReconnect 调 timer.unref()——"不让
// 心跳/重连 timer 阻止进程退出")。Hermes 的句柄是数字,无 unref → 运行时
// "undefined is not a function"。RN 里 timer 本就不阻塞进程退出,unref 语义
// 即 no-op:包装句柄补 unref/ref,并让 clearInterval/clearTimeout 自动解包。
const rawSetTimeout = globalThis.setTimeout.bind(globalThis);
const rawClearTimeout = globalThis.clearTimeout.bind(globalThis);
const rawSetInterval = globalThis.setInterval.bind(globalThis);
const rawClearInterval = globalThis.clearInterval.bind(globalThis);
const wrappedToRaw = new WeakMap<object, unknown>();

function wrapTimer(raw: unknown): object {
  const wrapper = {
    unref(): object {
      return wrapper;
    },
    ref(): object {
      return wrapper;
    },
    hasRef(): boolean {
      return true;
    },
  };
  wrappedToRaw.set(wrapper, raw);
  return wrapper;
}

function unwrapTimer(handle: unknown): ReturnType<typeof setTimeout> | undefined {
  if (handle !== null && typeof handle === 'object') {
    const raw = wrappedToRaw.get(handle);
    if (raw !== undefined) return raw as ReturnType<typeof setTimeout>;
  }
  return handle as ReturnType<typeof setTimeout> | undefined;
}

(globalThis as { setTimeout?: unknown }).setTimeout = ((fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) =>
  wrapTimer(rawSetTimeout(fn, ms, ...args))) as typeof setTimeout;
(globalThis as { clearTimeout?: unknown }).clearTimeout = ((handle: unknown) =>
  rawClearTimeout(unwrapTimer(handle))) as typeof clearTimeout;
(globalThis as { setInterval?: unknown }).setInterval = ((fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) =>
  wrapTimer(rawSetInterval(fn, ms, ...args))) as typeof setInterval;
(globalThis as { clearInterval?: unknown }).clearInterval = ((handle: unknown) =>
  rawClearInterval(unwrapTimer(handle))) as typeof clearInterval;

// Hermes 的 navigator 只有 product('ReactNative'),无 userAgent——langchain
// env 检测(isJsDom)读 navigator.userAgent.includes('jsdom') 直接崩
// ("Cannot read property 'includes' of undefined")。补空 userAgent:
// jsdom 判定恒 false,其余 env 检测按 navigator.product 走,语义不变。
const navGlobal = globalThis as { navigator?: { product?: string; userAgent?: string } };
if (navGlobal.navigator && navGlobal.navigator.userAgent === undefined) {
  Object.defineProperty(navGlobal.navigator, 'userAgent', {
    value: '',
    configurable: true,
    enumerable: true,
    writable: true,
  });
}

// Hermes 无全局 crypto(uuid 包/langchain 用它生成 trace/请求 id → 运行时
// "Property 'crypto' doesn't exist")。补最小面:randomUUID + getRandomValues。
// 熵源 Math.random——仅 id 用途,非安全场景(密钥不落日志,见 ts spec)。
interface CryptoLike {
  randomUUID(): string;
  getRandomValues<T extends ArrayBufferView | null>(array: T): T;
}

// Hermes 的 AbortSignal 缺 throwIfAborted(LangGraph 给 stream config 挂
// AbortSignal,包装器 next() 调 signal.throwIfAborted() → "undefined is not
// a function")。按 spec 语义补:已中止则抛 reason。
interface AbortSignalLike {
  aborted: boolean;
  reason?: unknown;
  throwIfAborted?(): void;
}

const signalProto = (globalThis as { AbortSignal?: { prototype?: AbortSignalLike } }).AbortSignal?.prototype;
if (signalProto && typeof signalProto.throwIfAborted !== 'function') {
  signalProto.throwIfAborted = function throwIfAborted(): void {
    if (this.aborted) {
      throw (this.reason ?? new Error('The operation was aborted.'));
    }
  };
}

const cryptoGlobal = globalThis as { crypto?: CryptoLike };
if (!cryptoGlobal.crypto) {
  const randomBytes = (n: number): Uint8Array => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
    return out;
  };
  cryptoGlobal.crypto = {
    getRandomValues<T extends ArrayBufferView | null>(array: T): T {
      if (array === null) return array;
      const view = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
      view.set(randomBytes(view.byteLength));
      return array;
    },
    randomUUID(): string {
      const b = randomBytes(16);
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    },
  };
}
