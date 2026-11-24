// 图标居中对齐工具(一次性/可重跑):把 app/assets 里的品牌图标**内容**移到
// 画布正中。2026-11-22 用户反馈「icon 好像不是中心的」——实测 icon.png 白色
// 蜡烛图包围盒 y=[100,339](中心 219.5)对画布 512 的中心 256 偏上 36.5px,
// android-icon-foreground.png 偏上 36px,monochrome 偏上 5.5px/偏左 1.5px。
//
// 做法:取「字形覆盖率」图(不透明背景图从 G 通道反解 alpha,透明图直接用
// A 通道)→ 用双线性重采样做**亚像素**平移(整数平移会残留 0.5px)→ 按原
// 配色重建。不是简单整图平移:整图平移会把边缘的抗锯齿噪点一起搬走,重建
// 后抗锯齿干净、颜色归一。
//
// 用法:node app/scripts/recenter-icons.mjs [--dry]
//   --dry  只测量并打印偏移,不写文件
//
// 注意:app/android/ 是 expo prebuild 产物(gitignored),图标 mipmap 由
// prebuild 从本脚本改过的 assets 重新生成 —— 改完需 `npx expo prebuild
// --platform android --no-install` 才会进 APK。
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const DRY = process.argv.includes('--dry');

/** 不透明背景的品牌红(icon.png / android-icon-background.png 实测同名色)。 */
const BRAND_RED = [211, 47, 47];

/** 目标文件表:opaque = 背景不透明(白字+红底,alpha 从 G 通道反解);
 *  transparent = RGBA 直接读 A 通道;ink = 字形自身的 RGB(重建时保留)。 */
const TARGETS = [
  { file: 'icon.png', opaque: BRAND_RED },
  { file: 'android-icon-foreground.png' },
  { file: 'android-icon-monochrome.png' },
];

/** 归一到 [0,1](仓库 no-nested-ternary:这里拆成两步比较,不写嵌套三元)。 */
function clamp01(v) {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/** 读 PNG → {w,h,alpha:Float64Array(rgba 覆盖率), ink:[r,g,b]} */
function load(file, opaque) {
  const png = PNG.sync.read(readFileSync(join(ASSETS, file)));
  const { width: w, height: h } = png;
  const alpha = new Float64Array(w * h);
  // 字形墨色 = alpha 最高处像素的 RGB(透明图用;不透明图固定白色)
  let ink = [255, 255, 255];
  let bestA = -1;
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    if (opaque) {
      // pixel = red*(1-a) + white*a → G = redG + (255-redG)*a
      alpha[i] = clamp01((png.data[p + 1] - opaque[1]) / (255 - opaque[1]));
    } else {
      alpha[i] = png.data[p + 3] / 255;
      if (alpha[i] > bestA) {
        bestA = alpha[i];
        ink = [png.data[p], png.data[p + 1], png.data[p + 2]];
      }
    }
  }
  return { w, h, alpha, ink };
}

/** 覆盖率 ≥ 0.5 的包围盒(0.5 阈值让抗锯齿边不进 bbox,量的是实心笔画)。 */
function bbox({ w, h, alpha }) {
  let x0 = w, x1 = -1, y0 = h, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (alpha[y * w + x] < 0.5) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return { x0, x1, y0, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

/** 双线性平移:out(x,y) = in(x - dx, y - dy);画布外采样 = 0(透明/纯底)。 */
function shift({ w, h, alpha }, dx, dy) {
  const out = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = y - dy;
    const y0 = Math.floor(sy);
    const fy = sy - y0;
    if (y0 < -1 || y0 >= h) continue;
    for (let x = 0; x < w; x++) {
      const sx = x - dx;
      const x0 = Math.floor(sx);
      const fx = sx - x0;
      if (x0 < -1 || x0 >= w) continue;
      const at = (xx, yy) => (xx < 0 || xx >= w || yy < 0 || yy >= h ? 0 : alpha[yy * w + xx]);
      out[y * w + x] =
        at(x0, y0) * (1 - fx) * (1 - fy) +
        at(x0 + 1, y0) * fx * (1 - fy) +
        at(x0, y0 + 1) * (1 - fx) * fy +
        at(x0 + 1, y0 + 1) * fx * fy;
    }
  }
  return out;
}

/** 重建 PNG:不透明图 → 品牌红底白字;透明图 → ink 色 + 平移后的 alpha。 */
function render({ w, h, ink }, alpha, opaque) {
  const png = new PNG({ width: w, height: h });
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    const a = clamp01(alpha[i]);
    const bg = opaque ?? [0, 0, 0];
    const bgA = opaque ? 1 : 0;
    png.data[p] = Math.round(bg[0] + (ink[0] - bg[0]) * a);
    png.data[p + 1] = Math.round(bg[1] + (ink[1] - bg[1]) * a);
    png.data[p + 2] = Math.round(bg[2] + (ink[2] - bg[2]) * a);
    png.data[p + 3] = Math.round((bgA + (1 - bgA) * a) * 255);
  }
  return PNG.sync.write(png);
}

let changed = 0;
for (const t of TARGETS) {
  const img = load(t.file, t.opaque);
  const before = bbox(img);
  // 口径:画布中心取 w/2、h/2(PNG 像素中心在 x+0.5,对整数尺寸而言与 bbox
  // 中心的 (x0+x1)/2 同一坐标系,无需再补偿 0.5)
  const cx = img.w / 2;
  const cy = img.h / 2;
  const sx = cx - before.cx;
  const sy = cy - before.cy;
  const shifted = Math.abs(sx) < 0.05 && Math.abs(sy) < 0.05 ? img.alpha : shift(img, sx, sy);
  const after = bbox({ w: img.w, h: img.h, alpha: shifted });
  console.log(
    `${t.file}  ${img.w}x${img.h}\n` +
      `  before bbox x[${before.x0},${before.x1}] y[${before.y0},${before.y1}] center(${before.cx.toFixed(1)},${before.cy.toFixed(1)}) ` +
      `offset(${(before.cx - cx).toFixed(1)},${(before.cy - cy).toFixed(1)})\n` +
      `  shift(${sx.toFixed(1)},${sy.toFixed(1)}) → center(${after.cx.toFixed(1)},${after.cy.toFixed(1)}) ` +
      `offset(${(after.cx - cx).toFixed(1)},${(after.cy - cy).toFixed(1)})`,
  );
  if (DRY) continue;
  if (Math.abs(sx) < 0.05 && Math.abs(sy) < 0.05) {
    console.log('  已居中,跳过写盘');
    continue;
  }
  writeFileSync(join(ASSETS, t.file), render(img, shifted, t.opaque));
  changed++;
}
console.log(DRY ? '(dry run,未写盘)' : `写入 ${changed} 个文件`);
