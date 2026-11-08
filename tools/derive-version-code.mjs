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
//
// 注意：CLI 部分必须由 isMain 守卫 —— 2026-11-08 CI 实证：无守卫时 test 一 import
// 就会跑完整 CLI（读/写 app/app.json，失败直接 process.exit(1) 把 vitest worker 打死）。
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP_JSON = join(ROOT, 'app', 'app.json');

/**
 * X.Y.Z → major*10000 + minor*100 + patch（0.1.10 → 110）。
 * @param {string} version
 * @returns {number}
 */
export function deriveVersionCode(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version).trim());
  if (!m) throw new Error(`版本号格式非法（需 X.Y.Z）：${version}`);
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = Number(m[3]);
  if (minor > 99 || patch > 99) throw new Error(`minor/patch 必须 ≤ 99：${version}`);
  return major * 10000 + minor * 100 + patch;
}

/** CLI 主体（纯函数式：返回退出码，不 process.exit —— 便于测试与复用）。 */
function main(argv) {
  const checkOnly = argv.includes('--check');
  const explicit = argv.find((a) => !a.startsWith('--'));

  let appJson;
  try {
    appJson = JSON.parse(readFileSync(APP_JSON, 'utf8'));
  } catch (err) {
    console.error(`app/app.json 读取或解析失败：${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  const version = explicit ?? appJson?.expo?.version;
  if (typeof version !== 'string' || version === '') {
    console.error('app/app.json 缺少 expo.version');
    return 1;
  }

  let next;
  try {
    next = deriveVersionCode(version);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  const current = appJson?.expo?.android?.versionCode;
  if (typeof current === 'number' && current > next) {
    // 倒退会让 Play 拒收，且说明 tag 比已发的 code 旧 —— 明确失败而不是静默写小。
    console.error(
      `versionCode 会倒退：${current} → ${next}（version=${version}）。` +
        '请确认 tag 是否比已发布版本更旧。',
    );
    return 1;
  }

  if (checkOnly) {
    if (current !== next) {
      console.error(`versionCode 与版本号不一致：app.json=${current} 推导=${next}（version=${version}）`);
      return 1;
    }
    console.log(`versionCode 校验通过：${next}（version=${version}）`);
    return 0;
  }

  appJson.expo.android = { ...(appJson.expo.android ?? {}), versionCode: next };
  writeFileSync(APP_JSON, `${JSON.stringify(appJson, null, 2)}\n`);
  console.log(`versionCode ${current ?? '(none)'} → ${next}（version=${version}）`);
  return 0;
}

const isMain = process.argv[1] ? pathToFileURL(process.argv[1]).href === import.meta.url : false;
if (isMain) {
  const code = main(process.argv.slice(2));
  if (code !== 0) process.exit(code);
}
