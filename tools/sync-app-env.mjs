// 把仓库根 `.env` 里的 LLM 三键同步成 Expo 需要的 `app/.env`(`EXPO_PUBLIC_LLM_*`)。
//
// 为什么需要这一层:应用侧读的是 `EXPO_PUBLIC_LLM_*`(`app/lib/settings.ts` 的
// 环境兜底,由 babel-preset-expo 在**构建时**内联),Node 侧读的是 `LLM_*`。
// 两边名字不同,手工抄一遍就是两份真相、还会抄漏前缀。
//
// 用法:node tools/sync-app-env.mjs [--dry]
//   --dry  只报「找到几个键」,不写文件
//
// 三条纪律:
//   - **绝不打印值**,只打印变量名与是否找到(值进了终端就等于进了日志/截图)。
//   - 保留 `app/.env` 里已有的其它行(比如 EXPO_PUBLIC_SOA_ACCESS_TOKEN),只
//     增改这三个键。
//   - `app/.env` 在 `app/.gitignore:1` 里,别把它改成入库文件。
//
// 注意:烘进包里的键是可被解包提取的 —— 这套只在本地/模拟器验证时用,发版构建
// 不要带 EXPO_PUBLIC_LLM_*。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, '.env');
const DST = join(ROOT, 'app', '.env');
const DRY = process.argv.includes('--dry');

/** Node 侧变量名 → Expo 侧变量名。 */
const MAP = [
  ['LLM_BASE_URL', 'EXPO_PUBLIC_LLM_BASE_URL'],
  ['LLM_API_KEY', 'EXPO_PUBLIC_LLM_API_KEY'],
  ['LLM_MODEL', 'EXPO_PUBLIC_LLM_MODEL'],
];

/** 解析 `KEY=VALUE` 形态(忽略注释/空行,去掉成对引号)。 */
function parseEnv(text) {
  const out = new Map();
  for (const line of text.split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out.set(m[1], v);
  }
  return out;
}

if (!existsSync(SRC)) {
  console.error(`✗ 找不到仓库根 .env(${SRC})`);
  process.exit(1);
}

const src = parseEnv(readFileSync(SRC, 'utf8'));
const missing = MAP.filter(([from]) => !src.get(from)).map(([from]) => from);
if (missing.length) {
  console.error(`✗ 根 .env 缺少: ${missing.join(', ')}`);
  process.exit(1);
}

const lines = existsSync(DST) ? readFileSync(DST, 'utf8').split('\n') : [];
const wrote = [];
for (const [from, to] of MAP) {
  const value = src.get(from);
  const at = lines.findIndex((l) => new RegExp(`^\\s*${to}\\s*=`).test(l));
  if (at >= 0) {
    lines[at] = `${to}=${value}`;
    wrote.push(`${to}(覆盖)`);
  } else {
    lines.push(`${to}=${value}`);
    wrote.push(`${to}(新增)`);
  }
}

console.log(`根 .env 找到 3 个键;app/.env 目标:${wrote.join(' ')}`);
if (DRY) {
  console.log('--dry:未写文件');
} else {
  // 末尾补一个换行,避免下次追加时和前一行粘在一起
  const text = lines.join('\n').replace(/\n*$/, '\n');
  writeFileSync(DST, text, { mode: 0o600 });
  console.log(`✓ 已写 ${DST}(模式 0600,文件内容未打印)`);
}
