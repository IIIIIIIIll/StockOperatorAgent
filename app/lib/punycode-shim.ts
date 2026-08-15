// 'punycode' 最小实现 —— markdown-it@10 的 normalizeLink 用 punycode.toASCII/
// toUnicode 做 URL hostname 的 IDNA 归一化,而 Hermes/Metro 无此内建。这里实现
// RFC 3492 的完整编码/解码算法(与 npm punycode@2 行为一致,小写输出)。
const BASE = 36;
const T_MIN = 1;
const T_MAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;
const DELIMITER = '-';
const MAX_INT = 0x7fffffff;

function adapt(delta: number, numPoints: number, firstTime: boolean): number {
  let k = 0;
  delta = firstTime ? Math.floor(delta / DAMP) : delta >> 1;
  delta += Math.floor(delta / numPoints);
  while (delta > ((BASE - T_MIN) * T_MAX) / 2) {
    delta = Math.floor(delta / (BASE - T_MIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - T_MIN + 1) * delta) / (delta + SKEW));
}

function digitToBasic(digit: number): number {
  // digit < 26 → 'a'..'z';否则 '0'..'9'
  return digit + 22 + 75 * (digit < 26 ? 1 : 0);
}

function basicToDigit(codePoint: number): number {
  if (codePoint - 48 < 10) return codePoint - 22; // '0'-'9' → 0-9
  if (codePoint - 65 < 26) return codePoint - 65; // 'A'-'Z' → 10-35
  if (codePoint - 97 < 26) return codePoint - 97; // 'a'-'z' → 10-35
  return BASE;
}

/** 单个 label 的 punycode 编码(RFC 3492)。 */
export function encode(input: string): string {
  const codePoints = [...input].map((c) => c.codePointAt(0) as number);
  const output: string[] = [];
  for (const cp of codePoints) {
    if (cp < 0x80) output.push(String.fromCharCode(cp));
  }
  const basicLength = output.length;
  let handledCPCount = basicLength;
  if (basicLength > 0) output.push(DELIMITER);
  let n = INITIAL_N;
  let delta = 0;
  let bias = INITIAL_BIAS;
  while (handledCPCount < codePoints.length) {
    let m = MAX_INT;
    for (const cp of codePoints) {
      if (cp >= n && cp < m) m = cp;
    }
    const handledCPCountPlusOne = handledCPCount + 1;
    if (m - n > Math.floor((MAX_INT - delta) / handledCPCountPlusOne)) {
      throw new RangeError('punycode: overflow');
    }
    delta += (m - n) * handledCPCountPlusOne;
    n = m;
    for (const cp of codePoints) {
      if (cp < n && ++delta > MAX_INT) throw new RangeError('punycode: overflow');
      if (cp === n) {
        let q = delta;
        for (let k = BASE; ; k += BASE) {
          const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias;
          if (q < t) break;
          const qMinusT = q - t;
          const baseMinusT = BASE - t;
          output.push(String.fromCharCode(digitToBasic(t + (qMinusT % baseMinusT))));
          q = Math.floor(qMinusT / baseMinusT);
        }
        output.push(String.fromCharCode(digitToBasic(q)));
        bias = adapt(delta, handledCPCountPlusOne, handledCPCount === basicLength);
        delta = 0;
        handledCPCount++;
      }
    }
    delta++;
    n++;
  }
  return output.join('');
}

/** 单个 label 的 punycode 解码(RFC 3492)。 */
export function decode(input: string): string {
  const output: number[] = [];
  const inputLength = input.length;
  const basic = input.lastIndexOf(DELIMITER);
  for (let index = 0; index < basic; index++) {
    const cp = input.charCodeAt(index);
    if (cp >= 0x80) throw new RangeError('punycode: invalid input');
    output.push(cp);
  }
  let i = 0;
  let n = INITIAL_N;
  let bias = INITIAL_BIAS;
  let index = basic < 0 ? 0 : basic + 1;
  while (index < inputLength) {
    const oldi = i;
    let w = 1;
    for (let k = BASE; ; k += BASE) {
      if (index >= inputLength) throw new RangeError('punycode: invalid input');
      const digit = basicToDigit(input.charCodeAt(index++));
      if (digit >= BASE || digit > Math.floor((MAX_INT - i) / w)) {
        throw new RangeError('punycode: overflow');
      }
      i += digit * w;
      const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias;
      if (digit < t) break;
      const baseMinusT = BASE - t;
      if (w > Math.floor(MAX_INT / baseMinusT)) throw new RangeError('punycode: overflow');
      w *= baseMinusT;
    }
    const out = output.length + 1;
    bias = adapt(i - oldi, out, oldi === 0);
    if (Math.floor(i / out) > MAX_INT - n) throw new RangeError('punycode: overflow');
    n += Math.floor(i / out);
    i %= out;
    output.splice(i, 0, n);
    i++;
  }
  return String.fromCodePoint(...output);
}

function mapDomain(string: string, fn: (label: string) => string): string {
  const parts = string.split('@');
  let result = '';
  if (parts.length > 1) {
    result = parts[0] + '@';
    string = parts[1];
  }
  return result + string.split('.').map(fn).join('.');
}

/** IDNA toASCII:非 ASCII label 编码为 xn-- 前缀 punycode。 */
export function toASCII(input: string): string {
  return mapDomain(input, (label) =>
    /[^\0-\x7f]/.test(label) ? `xn--${encode(label)}` : label
  );
}

/** IDNA toUnicode:xn-- 前缀 label 解码回 Unicode。 */
export function toUnicode(input: string): string {
  return mapDomain(input, (label) =>
    /^xn--/.test(label) ? decode(label.slice(4)) : label
  );
}
