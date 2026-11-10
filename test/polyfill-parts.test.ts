// polyfill 可测部分单测(R4:此前 app/lib/polyfill.ts 零测试)。
//
// polyfill.ts 本体是「装到 globalThis」的副作用,断言它等于断言运行时本身。
// 真正会回归的是拆到 polyfill-parts.ts 的纯逻辑 —— 三处历史上真实崩过的契约:
// Hermes 无 crypto(要 v4 UUID)、timer 句柄无 unref、Buffer#subarray 不返回
// Buffer。house style 禁 vi.mock,所以依赖全部注入。
import { describe, expect, it } from 'vitest';
import {
  createTimerRegistry,
  fillRandomView,
  formatUuid,
  randomBytes,
  wrapSubarray,
  type RawTimerHandle,
} from '../app/lib/polyfill-parts.ts';

describe('randomBytes(注入熵源)', () => {
  it('长度正确且每个字节取自熵源', () => {
    const seq = [0, 0.5, 0.999];
    let i = 0;
    const out = randomBytes(3, () => seq[i++]);
    expect(Array.from(out)).toEqual([0, 128, 255]); // floor(x * 256)
  });

  it('n = 0 → 空数组;熵源不被调用', () => {
    let calls = 0;
    expect(randomBytes(0, () => (calls++, 0)).length).toBe(0);
    expect(calls).toBe(0);
  });
});

describe('formatUuid(RFC 4122 v4)', () => {
  it('全零字节 → 版本位 4、variant 位 8', () => {
    const zeros = new Uint8Array(16);
    expect(formatUuid(zeros)).toBe('00000000-0000-4000-8000-000000000000');
  });

  it('形状:8-4-4-4-12,共 36 字符、全十六进制', () => {
    const uuid = formatUuid(randomBytes(16, Math.random));
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(uuid[14]).toBe('4'); // 第三段的版本号
    expect(['8', '9', 'a', 'b']).toContain(uuid[19]); // 第四段首字符 = variant 10xx
  });

  it('不改入参(重复调用同一字节数组结果稳定)', () => {
    const bytes = new Uint8Array(16);
    const first = formatUuid(bytes);
    expect(bytes.every((b) => b === 0)).toBe(true);
    expect(formatUuid(bytes)).toBe(first);
  });
});

describe('fillRandomView', () => {
  it('就地写并返回同一对象;只写视图范围,邻居字节不动', () => {
    const backing = new Uint8Array(8).fill(0xaa);
    const view = new Uint8Array(backing.buffer, 2, 3);
    const returned = fillRandomView(view, () => 0.5);
    expect(returned).toBe(view);
    expect(Array.from(view)).toEqual([128, 128, 128]);
    expect(Array.from(backing)).toEqual([0xaa, 0xaa, 128, 128, 128, 0xaa, 0xaa, 0xaa]);
  });

  it('非 8 位视图按字节长度填充(DataView 也适用)', () => {
    const backing = new Uint8Array(4);
    fillRandomView(new DataView(backing.buffer), () => 0);
    expect(Array.from(backing)).toEqual([0, 0, 0, 0]);
  });
});

describe('createTimerRegistry(Hermes 句柄补 unref/ref)', () => {
  it('wrap → unref/ref 返回同一个 wrapper(链式调用不换对象)', () => {
    const { wrap } = createTimerRegistry();
    const w = wrap(123);
    expect(w.unref()).toBe(w);
    expect(w.ref()).toBe(w);
    expect(w.hasRef()).toBe(true);
  });

  it('unwrap 还原原始句柄(clearTimeout 要拿到原生句柄)', () => {
    const { wrap, unwrap } = createTimerRegistry();
    const raw = { id: 'native' };
    expect(unwrap(wrap(raw))).toBe(raw);
  });

  it('unwrap 对未包装的值原样透传(原生 Timer / 数字 / undefined)', () => {
    const { unwrap } = createTimerRegistry();
    const native: RawTimerHandle = { id: 'native' };
    expect(unwrap(native)).toBe(native);
    expect(unwrap(7)).toBe(7);
    expect(unwrap(undefined)).toBeUndefined();
  });

  it('两个 registry 互不相通(工厂隔离,不共享 WeakMap)', () => {
    const a = createTimerRegistry();
    const b = createTimerRegistry();
    const raw = { id: 'a-owned' };
    const wrapped = a.wrap(raw);
    expect(b.unwrap(wrapped)).toBe(wrapped); // b 不认识 a 的 wrapper → 原样返回
  });
});

describe('wrapSubarray(Buffer#subarray 必须返回 Buffer)', () => {
  class FakeBuf extends Uint8Array {}

  const isFakeBuf = (v: Uint8Array): v is FakeBuf => v instanceof FakeBuf;
  // Buffer.from 的实参本来就是 ArrayBufferLike;Uint8Array 构造签名只收 ArrayBuffer,
  // 测试里窄一层即可(与生产 Buffer.from(buffer, off, len) 行为一致)
  const makeBuf = (buffer: ArrayBufferLike, byteOffset: number, byteLength: number): FakeBuf =>
    new FakeBuf(buffer as ArrayBuffer, byteOffset, byteLength);

  it('底层已返回 Buffer → 原样返回(零拷贝,不重复包装)', () => {
    const self = new FakeBuf([1, 2, 3, 4]);
    const already = new FakeBuf(self.buffer, 1, 2);
    const wrapped = wrapSubarray<FakeBuf>(isFakeBuf, makeBuf, () => already);
    expect(wrapped.call(self, 1, 3)).toBe(already);
  });

  it('裸 Uint8Array → 重新包成 Buffer,且共享底层内存', () => {
    const source = new FakeBuf([1, 2, 3, 4]);
    let gotOffset = -1;
    let gotLength = -1;
    const wrapped = wrapSubarray<FakeBuf>(
      isFakeBuf,
      (buffer, byteOffset, byteLength) => {
        gotOffset = byteOffset;
        gotLength = byteLength;
        return new FakeBuf(buffer as ArrayBuffer, byteOffset, byteLength);
      },
      // 模拟坏的运行时:subarray 直接返回裸视图
      function (this: FakeBuf, start = 0, end = this.length): Uint8Array {
        return new Uint8Array(this.buffer, this.byteOffset + start, end - start);
      },
    );
    const out = wrapped.call(source, 1, 3);
    expect(out).toBeInstanceOf(FakeBuf);
    expect(Array.from(out)).toEqual([2, 3]);
    expect([gotOffset, gotLength]).toEqual([1, 2]);
    out[0] = 9; // 共享内存:改视图即改源
    expect(source[1]).toBe(9);
  });
});
