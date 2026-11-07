// zlib-shim inflate 输出上限回归(评审 2026-11-07 CR-38):TDX 帧解压前必须有
// 上限,否则损坏/恶意 deflate 流会把 number[] 累积到 OOM(每元素 ≈8 字节)。
import { describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import { inflateSync, MAX_INFLATE_OUTPUT } from '../app/lib/zlib-shim.ts';

describe('inflateSync 输出上限(CR-38)', () => {
  it('解压输出超过上限 → 抛错,不无限累积', () => {
    const payload = Buffer.alloc(MAX_INFLATE_OUTPUT + 1024);
    const compressed = deflateSync(payload);
    expect(() => inflateSync(compressed)).toThrow(/output too large/);
  });

  it('上限内仍正常解压', () => {
    const payload = Buffer.from('hello '.repeat(1000));
    expect(inflateSync(deflateSync(payload)).toString()).toBe(payload.toString());
  });
});
