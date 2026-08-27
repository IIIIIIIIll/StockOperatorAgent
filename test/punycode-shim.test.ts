// punycode-shim IDNA 归一化(F32:全角/中文句点分隔符 —— 旧实现只按 ASCII '.'
// 切分,「例。com」整串当单 label 编码,链接损坏)。
import { describe, expect, it } from 'vitest';
import { toASCII, toUnicode } from '../app/lib/punycode-shim.ts';

describe('punycode-shim mapDomain(F32)', () => {
  it('。 (U+3002)/． (U+FF0E)/｡ (U+FF61) 与 ASCII 点等价切分(toASCII 一致)', () => {
    const variants = ['例。com', '例．com', '例｡com', '例.com'];
    const ascii = variants.map((d) => toASCII(d));
    expect(new Set(ascii).size).toBe(1); // 全部分隔符归一为同一编码结果
    expect(ascii[0]).toBe('xn--fsq.com'); // 例 = U+4F8B → punycode 'fsq'
  });

  it('toUnicode 同样识别全角分隔符(xn-- 前缀 label 解码,其余原样)', () => {
    expect(toUnicode('xn--fsq。com')).toBe('例.com');
    expect(toUnicode('xn--fsq．com')).toBe('例.com');
    expect(toUnicode('xn--fsq｡com')).toBe('例.com');
  });

  it('纯 ASCII 域名不受影响(无 xn-- 前缀不编解码)', () => {
    expect(toASCII('example.com')).toBe('example.com');
    expect(toUnicode('example。com')).toBe('example.com');
  });
});
