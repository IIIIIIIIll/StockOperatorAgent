// node:zlib 最小实现 —— Hermes 无原生 zlib,而 node-tdx-market 的响应帧解压
// (dist/protocol/frame.js 的 decodeResponse → inflateSync)依赖它。纯 TS、无 RN
// 依赖:zlib 头(RFC 1950)+ DEFLATE(三种 block 类型、规范 Huffman、LZ77)
// + Adler-32 校验,行为对齐 Node zlib 的 inflateSync。
import { Buffer } from 'buffer';

// ─── Adler-32(校验和)──────────────────────────────────────────────────────────
function adler32(data: ArrayLike<number>): number {
  let s1 = 1;
  let s2 = 0;
  for (let i = 0; i < data.length; i++) {
    s1 = (s1 + data[i]) % 65521;
    s2 = (s2 + s1) % 65521;
  }
  return ((s2 << 16) | s1) >>> 0;
}

// ─── 位读取器(DEFLATE 位级字段为 LSB-first)────────────────────────────────────
class BitReader {
  private pos = 0;
  private bitBuf = 0;
  private bitCnt = 0;

  constructor(private readonly data: Uint8Array) {}

  /** 读 n 位(LSB-first),n ≤ 16 */
  bits(n: number): number {
    while (this.bitCnt < n) {
      if (this.pos >= this.data.length) throw new Error('inflate: unexpected end of input');
      this.bitBuf |= this.data[this.pos++] << this.bitCnt;
      this.bitCnt += 8;
    }
    const value = this.bitBuf & ((1 << n) - 1);
    this.bitBuf >>>= n;
    this.bitCnt -= n;
    return value;
  }

  /** 跳到字节边界(丢弃不足一字节的填充位) */
  alignToByte(): void {
    const skip = this.bitCnt & 7;
    if (skip > 0) {
      this.bitBuf >>>= skip;
      this.bitCnt -= skip;
    }
  }

  get bytesConsumed(): number {
    return this.pos;
  }
}

// ─── 规范 Huffman 解码表 ───────────────────────────────────────────────────────
interface HuffmanTable {
  counts: Int32Array; // 每种码长的码数量
  firstCode: Int32Array; // 每种码长的第一个码值
  tableIndex: Int32Array; // 每种码长在 symbols 中的起始下标
  symbols: Int32Array; // 按(码长, 符号)序排列的符号
}

function buildHuffman(lengths: Uint8Array): HuffmanTable {
  const counts = new Int32Array(16);
  for (let i = 0; i < lengths.length; i++) counts[lengths[i]]++;
  counts[0] = 0; // 长度为 0 的符号不参与编码
  // 码长分布合法性:over-subscribed(码字不够分)报错;incomplete 允许(zlib 同款)。
  let left = 1;
  for (let len = 1; len <= 15; len++) {
    left = (left << 1) - counts[len];
    if (left < 0) throw new Error('inflate: invalid code lengths (over-subscribed)');
  }
  const firstCode = new Int32Array(16);
  let code = 0;
  for (let len = 1; len < 16; len++) {
    code = (code + counts[len - 1]) << 1;
    firstCode[len] = code;
  }
  const symbols: number[] = [];
  for (let sym = 0; sym < lengths.length; sym++) {
    if (lengths[sym] > 0) symbols.push(sym);
  }
  // canonical 顺序:码长升序,同码长按符号升序
  symbols.sort((a, b) => lengths[a] - lengths[b] || a - b);
  const tableIndex = new Int32Array(16);
  let idx = 0;
  for (let len = 1; len < 16; len++) {
    tableIndex[len] = idx;
    idx += counts[len];
  }
  return { counts, firstCode, tableIndex, symbols: Int32Array.from(symbols) };
}

function decodeSymbol(r: BitReader, t: HuffmanTable, maxLen: number): number {
  let code = 0;
  let first = 0;
  for (let len = 1; len <= maxLen; len++) {
    code |= r.bits(1);
    const count = t.counts[len];
    if (code < first + count) {
      return t.symbols[t.tableIndex[len] + (code - first)];
    }
    first = (first + count) << 1;
    code <<= 1;
  }
  throw new Error('inflate: invalid huffman code');
}

// ─── DEFLATE 常量表 ────────────────────────────────────────────────────────────
const LENGTH_BASE = new Uint16Array([
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115,
  131, 163, 195, 227, 258,
]);
const LENGTH_EXTRA = new Uint8Array([
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
]);
const DIST_BASE = new Uint16Array([
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537,
  2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
]);
const DIST_EXTRA = new Uint8Array([
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12,
  13, 13,
]);
// 码长编码的符号顺序(RFC 1951 规定)
const CLEN_ORDER = new Uint8Array([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);

// 固定 Huffman 码表(所有固定块共享,模块加载时构建一次)
const FIXED_LITLEN = buildHuffman(
  (() => {
    const lengths = new Uint8Array(288);
    for (let i = 0; i < 144; i++) lengths[i] = 8;
    for (let i = 144; i < 256; i++) lengths[i] = 9;
    for (let i = 256; i < 280; i++) lengths[i] = 7;
    for (let i = 280; i < 288; i++) lengths[i] = 8;
    return lengths;
  })()
);
const FIXED_DIST = buildHuffman(new Uint8Array(32).fill(5));

function inflateSymbols(
  r: BitReader,
  litlen: HuffmanTable,
  dist: HuffmanTable,
  out: number[]
): void {
  for (;;) {
    const sym = decodeSymbol(r, litlen, 15);
    if (sym === 256) return;
    if (sym < 256) {
      out.push(sym);
      continue;
    }
    if (sym > 285) throw new Error('inflate: invalid length symbol');
    const lenIdx = sym - 257;
    const length = LENGTH_BASE[lenIdx] + r.bits(LENGTH_EXTRA[lenIdx]);
    const distSym = decodeSymbol(r, dist, 15);
    if (distSym > 29) throw new Error('inflate: invalid distance symbol');
    const distance = DIST_BASE[distSym] + r.bits(DIST_EXTRA[distSym]);
    if (distance === 0 || distance > out.length) throw new Error('inflate: invalid distance');
    // 允许重叠拷贝(向前引用):逐字节回填即可
    for (let i = 0; i < length; i++) out.push(out[out.length - distance]);
  }
}

function inflateBlock(r: BitReader, out: number[]): void {
  const btype = r.bits(2);
  if (btype === 0) {
    // stored(未压缩):字节对齐,4 字节 LEN/NLEN 头
    r.alignToByte();
    const len = r.bits(16);
    const nlen = r.bits(16);
    if ((len ^ 0xffff) !== nlen) throw new Error('inflate: stored block length mismatch');
    for (let i = 0; i < len; i++) out.push(r.bits(8));
    return;
  }
  if (btype === 1) {
    inflateSymbols(r, FIXED_LITLEN, FIXED_DIST, out);
    return;
  }
  if (btype === 2) {
    // dynamic huffman:先读码长编码的码表,再读 litlen/dist 码长
    const hlit = r.bits(5) + 257;
    const hdist = r.bits(5) + 1;
    const hclen = r.bits(4) + 4;
    const clenLengths = new Uint8Array(19);
    for (let i = 0; i < hclen; i++) clenLengths[CLEN_ORDER[i]] = r.bits(3);
    const clenTable = buildHuffman(clenLengths);
    const lengths = new Uint8Array(hlit + hdist);
    let i = 0;
    while (i < lengths.length) {
      const sym = decodeSymbol(r, clenTable, 7);
      if (sym < 16) {
        lengths[i++] = sym;
      } else if (sym === 16) {
        if (i === 0) throw new Error('inflate: repeat with no previous length');
        const repeat = 3 + r.bits(2);
        const prev = lengths[i - 1];
        for (let k = 0; k < repeat; k++) {
          if (i >= lengths.length) throw new Error('inflate: code length overflow');
          lengths[i++] = prev;
        }
      } else if (sym === 17) {
        const repeat = 3 + r.bits(3);
        i += repeat;
        if (i > lengths.length) throw new Error('inflate: code length overflow');
      } else {
        const repeat = 11 + r.bits(7);
        i += repeat;
        if (i > lengths.length) throw new Error('inflate: code length overflow');
      }
    }
    inflateSymbols(
      r,
      buildHuffman(lengths.subarray(0, hlit)),
      buildHuffman(lengths.subarray(hlit)),
      out
    );
    return;
  }
  throw new Error('inflate: invalid block type');
}

/** zlib(RFC 1950)解压:2 字节头 + DEFLATE 流 + 4 字节 Adler-32。 */
export function inflateSync(data: Buffer | Uint8Array): Buffer {
  if (data.length < 2) throw new Error('inflate: input too short');
  const cmf = data[0];
  const flg = data[1];
  if ((cmf & 0x0f) !== 8) throw new Error('inflate: unknown compression method');
  if (((cmf << 8) | flg) % 31 !== 0) throw new Error('inflate: invalid zlib header');
  if ((flg & 0x20) !== 0) throw new Error('inflate: preset dictionary not supported');
  if ((cmf >> 4) > 7) throw new Error('inflate: invalid window size');

  const r = new BitReader(data.subarray(2));
  const out: number[] = [];
  let bfinal = 0;
  do {
    bfinal = r.bits(1);
    inflateBlock(r, out);
  } while (!bfinal);

  // DEFLATE 流以字节对齐结束,剩余应为 4 字节 Adler-32 校验和(大端)
  r.alignToByte();
  if (data.length - 2 - r.bytesConsumed !== 4) throw new Error('inflate: invalid zlib trailer');
  const expected =
    ((data[data.length - 4] << 24) |
      (data[data.length - 3] << 16) |
      (data[data.length - 2] << 8) |
      data[data.length - 1]) >>>
    0;
  if (expected !== adler32(out)) throw new Error('inflate: adler32 checksum mismatch');
  return Buffer.from(out);
}
