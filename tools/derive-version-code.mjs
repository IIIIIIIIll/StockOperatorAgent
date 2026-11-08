#!/usr/bin/env node
// S6-1（评审 2026-11-08）：Android versionCode 曾是 app/app.json 里的手改字面量，
// 没有任何环节强制它递增 —— 忘记 bump 就复用同一个 code，Play 直接拒收上传（且
// 只有发版那一刻才炸）。现改为从版本号确定性推导：
//     versionCode = major*10000 + minor*100 + patch      （0.1.10 → 110）
// 约束：minor/patch ≤ 99，保证严格单调且可逆读。发版步骤因此只剩「改版本号」。
//
// 用法：
//   node tools/derive-version-code.mjs              # 用 app/app.json 的 expo.version
//   node tools/derive-version-code.mjs 0.1.11       # 显式指定（CI 用 tag 版本）
//   node tools/derive-version-code.mjs --check      # 只校验，不写文件
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP_JSON = join(ROOT, 'app', 'app.json');

/** @param {string} version @returns {number} */
export function deriveVersionCode(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version).trim());
  if (!m) throw new Error(`版本号格式非法（需 X.Y.Z）：${version}`);
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = Number(m[3]);
  if (minor > 99 || patch > 99) throw new Error(`minor/patch 必须 ≤ 99：${version}`);
  return major * 10000 + minor * 100 + patch;
}

const argv = process.argv.slice(2);
const checkOnly = argv.includes('--check');
const explicit = argv.find((a) => !a.startsWith('--'));

const raw = readFileSync(APP_JSON, 'utf8');
let appJson;
try {
  appJson = JSON.parse(raw);
} catch (err) {
  console.error(`app/app.json 不是合法 JSON：${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
const version = explicit ?? appJson?.expo?.version;
if (typeof version !== 'string' || version === '') {
  console.error('app/app.json 缺少 expo.version');
  process.exit(1);
}

const next = deriveVersionCode(version);
const current = appJson?.expo?.android?.versionCode;
if (typeof current === 'number' && current > next) {
  // 倒退会让 Play 拒收，且说明 tag 比已发的 code 旧 —— 明确失败而不是静默写小。
  console.error(
    `versionCode 会倒退：${current} → ${next}（version=${version}）。` +
      '请确认 tag 是否比已发布版本更旧。',
  );
  process.exit(1);
}

if (checkOnly) {
  if (current !== next) {
    console.error(`versionCode 与版本号不一致：app.json=${current} 推导=${next}（version=${version}）`);
    process.exit(1);
  }
  console.log(`versionCode 校验通过：${next}（version=${version}）`);
} else {
  appJson.expo.android = { ...(appJson.expo.android ?? {}), versionCode: next };
  writeFileSync(APP_JSON, `${JSON.stringify(appJson, null, 2)}\n`);
  console.log(`versionCode ${current ?? '(none)'} → ${next}（version=${version}）`);
}
