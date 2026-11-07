// 发布配置回归门(评审 2026-11-07 CR-05/CR-07):
// - versionCode 必须显式配置且单调递增 —— 缺省会由 expo prebuild 默认成 1,
//   第二个 AAB 上传会被 Google Play 拒绝。
// - allowBackup 必须 false —— 设置(含 LLM/TDX/亿信 API key)以明文写
//   Paths.document/soa-settings.json,Android Auto Backup 默认 true 会把它
//   同步到用户云备份。
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const expo = JSON.parse(fs.readFileSync('app/app.json', 'utf8')).expo as {
  version: string;
  android?: { versionCode?: number; allowBackup?: boolean };
};

describe('app.json 发布配置(CR-05/CR-07)', () => {
  it('android.versionCode 为显式正整数', () => {
    const code = expo.android?.versionCode;
    expect(Number.isInteger(code)).toBe(true);
    expect(code as number).toBeGreaterThan(0);
  });

  it('android.allowBackup 为 false(明文密钥不进云备份)', () => {
    expect(expo.android?.allowBackup).toBe(false);
  });
});
