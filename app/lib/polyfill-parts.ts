// polyfill 的可测部分 —— 纯逻辑,不碰 globalThis。
//
// 为什么拆出来:polyfill.ts 整体是「把下面这些装到全局」的安装动作,Node 里能跑但
// 断言它等于断言框架本身。真正有回归价值的是这些纯函数/工厂 —— 它们的契约
// 直接对应历史上真实崩过的三处(Hermes 无 crypto / timer 无 unref /
// subarray 不返回 Buffer)。house style 禁 `vi.mock`,所以用注入代替打桩。

export type RandomSource = () => number; // [0,1),生产用 Math.random

/** n 字节随机数据。 */
export function randomBytes(n: number, rand: RandomSource): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.floor(rand() * 256);
  return out;
}

/** RFC 4122 v4 文本形态。version/variant 位在取 hex 之前设置。
 *  不改调用方入参 —— 拷一份再改,重复调用同一字节数组结果稳定。 */
export function formatUuid(bytes: Uint8Array): string {
  const b = new Uint8Array(bytes);
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10xx
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** 把随机字节写进任意视图,保留调用方的 buffer/offset(就地写,返回同一对象)。 */
export function fillRandomView<T extends ArrayBufferView>(array: T, rand: RandomSource): T {
  const view = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  view.set(randomBytes(view.byteLength, rand));
  return array;
}

export interface TimerWrapper {
  unref(): TimerWrapper;
  ref(): TimerWrapper;
  hasRef(): boolean;
}

/** 原生 timer 句柄:Node 是 Timeout 对象,Hermes 是数字,缺省无句柄。 */
export type RawTimerHandle = object | number | undefined;

/** 句柄包装 + 反查表。用工厂而不是模块级 WeakMap:polyfill 与测试各自独立,
 *  避免测试之间经由模块状态互相污染。 */
export function createTimerRegistry(): {
  wrap(raw: RawTimerHandle): TimerWrapper;
  unwrap(handle: unknown): RawTimerHandle;
} {
  const wrappedToRaw = new WeakMap<object, RawTimerHandle>();

  function wrap(raw: RawTimerHandle): TimerWrapper {
    const wrapper: TimerWrapper = {
      unref(): TimerWrapper {
        return wrapper;
      },
      ref(): TimerWrapper {
        return wrapper;
      },
      hasRef(): boolean {
        return true;
      },
    };
    wrappedToRaw.set(wrapper, raw);
    return wrapper;
  }

  function unwrap(handle: unknown): RawTimerHandle {
    if (handle !== null && typeof handle === 'object') {
      const raw = wrappedToRaw.get(handle);
      if (raw !== undefined) return raw;
    }
    // 原生 Timer / 数字句柄 / undefined 原样返回。调用点只会传 wrap 产物或
    // 平台 timer 返回值 —— 其他形状本就不该出现在这里。
    return handle as RawTimerHandle;
  }

  return { wrap, unwrap };
}

/** Buffer#subarray 的 Node 契约:返回 Buffer(带 readUInt32BE 等全部方法)。
 *  部分运行时的 subarray 直接继承 Uint8Array,返回裸视图 —— node-tdx-market 的
 *  extractFrame 切帧后再读 readUInt32BE 即 "undefined is not a function"。
 *  isBuffer 用类型守卫而不是 boolean 谓词,于是无需强转就能保留 B;
 *  makeBuffer 负责把裸视图重新包成 Buffer(生产:(buf,off,len) => Buffer.from(...))。 */
export function wrapSubarray<B extends Uint8Array>(
  isBuffer: (view: Uint8Array) => view is B,
  makeBuffer: (buffer: ArrayBufferLike, byteOffset: number, byteLength: number) => B,
  orig: (this: B, start?: number, end?: number) => Uint8Array,
): (this: B, start?: number, end?: number) => B {
  return function subarrayView(this: B, start?: number, end?: number): B {
    const view = orig.call(this, start, end);
    if (isBuffer(view)) return view;
    return makeBuffer(view.buffer, view.byteOffset, view.byteLength);
  };
}
