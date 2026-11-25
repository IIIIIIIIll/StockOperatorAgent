// favicon 生成工具(一次性/可重跑):把品牌图标 `assets/icon.png` 降采样成
// `assets/favicon.png`。2026-11-24 发现 favicon 仍是 Expo 模板默认的蓝色「A」,
// 而 `app.json` 的 `web.favicon` 正引用它 —— 浏览器标签页一直是 Expo 图标。
//
// 为什么不是简单 resize:512 → 48 不是整数倍,最近邻会丢蜡烛、双线性会糊。
// 这里用**面积平均**(box filter,带小数权重):每个目标像素取它覆盖的源矩形
// 的面积加权均值。缩小时这是唯一不引入混叠的线性核。
//
// 用法:node app/scripts/make-favicon.mjs [--size 48] [--out <path>]
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 浏览器标签页取 48×48 够用(16/32/48 都从它再降)。 */
const DEFAULT_SIZE = 48;

/** 读 `--key value` 形式的参数。 */
function arg(key, fallback) {
  const i = process.argv.indexOf(`--${key}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  if (v === undefined) throw new Error(`--${key} 缺少值`);
  return v;
}

/**
 * 单轴面积平均:把 `src`(srcN 个像素 × stride 通道的交错数组)缩到 dstN。
 * 返回长度 dstN × stride 的交错数组。权重按覆盖长度精确分摊,不取整。
 * 只处理**一条线**(一行或一列),多行/多列由调用方切视图后逐条喂进来。
 */
function resampleAxis(src, srcN, dstN, stride) {
  const out = new Float64Array(dstN * stride);
  const scale = srcN / dstN;
  for (let d = 0; d < dstN; d++) {
    const start = d * scale;
    const end = start + scale;
    const first = Math.floor(start);
    const last = Math.min(srcN - 1, Math.ceil(end) - 1);
    let total = 0;
    for (let s = first; s <= last; s++) {
      // 源像素 s 覆盖 [s, s+1),与目标区间 [start, end) 的交集长度即权重
      const w = Math.min(end, s + 1) - Math.max(start, s);
      if (w <= 0) continue;
      total += w;
      for (let c = 0; c < stride; c++) {
        out[d * stride + c] += src[s * stride + c] * w;
      }
    }
    if (total > 0) {
      for (let c = 0; c < stride; c++) out[d * stride + c] /= total;
    }
  }
  return out;
}

/** 两趟可分离面积平均:先逐行横向缩列,再逐列纵向缩行。 */
function boxResample(png, dstW, dstH) {
  const srcW = png.width;
  const srcH = png.height;
  const stride = 4;
  // PNG.data 是 Buffer(Uint8Array),转 Float64 便于加权累加
  const src = new Float64Array(srcW * srcH * stride);
  for (let i = 0; i < src.length; i++) src[i] = png.data[i];

  // 横向:每行独立缩列,写进 dstW × srcH 的交错缓冲
  const horizontal = new Float64Array(dstW * srcH * stride);
  for (let y = 0; y < srcH; y++) {
    const row = src.subarray(y * srcW * stride, (y + 1) * srcW * stride);
    horizontal.set(resampleAxis(row, srcW, dstW, stride), y * dstW * stride);
  }

  // 纵向:每列独立缩行(先把列收成连续数组,再写回)
  const rows = new Float64Array(dstW * dstH * stride);
  const column = new Float64Array(srcH * stride);
  for (let x = 0; x < dstW; x++) {
    for (let y = 0; y < srcH; y++) {
      const at = y * dstW * stride + x * stride;
      column.set(horizontal.subarray(at, at + stride), y * stride);
    }
    const shrunk = resampleAxis(column, srcH, dstH, stride);
    for (let y = 0; y < dstH; y++) {
      rows.set(shrunk.subarray(y * stride, (y + 1) * stride), y * dstW * stride + x * stride);
    }
  }

  const out = new PNG({ width: dstW, height: dstH });
  for (let i = 0; i < rows.length; i++) {
    out.data[i] = Math.max(0, Math.min(255, Math.round(rows[i])));
  }
  return out;
}

const size = Number(arg('size', String(DEFAULT_SIZE)));
if (!Number.isInteger(size) || size < 8 || size > 512) {
  throw new Error(`--size 需是 8..512 的整数,收到 ${arg('size', '')}`);
}
const outPath = resolve(arg('out', join(ROOT, 'assets', 'favicon.png')));

const src = PNG.sync.read(readFileSync(join(ROOT, 'assets', 'icon.png')));
const dst = boxResample(src, size, size);
writeFileSync(outPath, PNG.sync.write(dst));
console.log(
  `favicon: ${src.width}×${src.height} → ${size}×${size} → ${outPath}`,
);
