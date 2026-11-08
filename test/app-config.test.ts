// 发布配置回归门(评审 2026-11-07 CR-05/CR-07):
// - versionCode 必须显式配置且单调递增 —— 缺省会由 expo prebuild 默认成 1,
//   第二个 AAB 上传会被 Google Play 拒绝。
// - allowBackup 必须 false —— 设置(含 LLM/TDX/亿信 API key)以明文写
//   Paths.document/soa-settings.json,Android Auto Backup 默认 true 会把它
//   同步到用户云备份。
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

import { deriveVersionCode } from '../tools/derive-version-code.mjs';

const expo = JSON.parse(fs.readFileSync('app/app.json', 'utf8')).expo as {
  version: string;
  android?: { versionCode?: number; allowBackup?: boolean };
};

describe('app.json 发布配置(CR-05/CR-07)', () => {
  // S6-1(评审 2026-11-08):旧断言只要求「正整数」,注释却写着「单调递增」——
  // 忘 bump 无人发现,Play 上传才拒。现钉住「由版本号推导」的一致性:
  // versionCode === major*10000+minor*100+patch(发布流程跑 tools/derive-version-code.mjs)。
  it('android.versionCode 与 expo.version 推导值一致', () => {
    expect(expo.android?.versionCode).toBe(deriveVersionCode(expo.version));
  });

  it('android.allowBackup 为 false(明文密钥不进云备份)', () => {
    expect(expo.android?.allowBackup).toBe(false);
  });
});
