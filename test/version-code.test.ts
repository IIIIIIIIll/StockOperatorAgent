// S6-1（评审 2026-11-08）：Android versionCode 必须单调递增，否则 Play 拒收上传。
// 旧实现是 app/app.json 里的手改字面量，测试只断言 > 0 —— 忘 bump 无人发现。
// 现由版本号推导，这里钉住推导规则与边界。
import { describe, expect, it } from 'vitest';
import { deriveVersionCode } from '../tools/derive-version-code.mjs';

describe('deriveVersionCode（S6-1）', () => {
  it('major*10000 + minor*100 + patch', () => {
    expect(deriveVersionCode('0.1.10')).toBe(110);
    expect(deriveVersionCode('0.1.11')).toBe(111);
    expect(deriveVersionCode('1.2.3')).toBe(10203);
    expect(deriveVersionCode('12.34.56')).toBe(123456);
  });

  it('严格单调：同一 major 内 patch/minor 前进必然增大', () => {
    const seq = ['0.1.9', '0.1.10', '0.1.99', '0.2.0', '0.2.1', '0.10.0', '1.0.0'];
    const codes = seq.map(deriveVersionCode);
    for (let i = 1; i < codes.length; i++) {
      expect(codes[i], `${seq[i]} > ${seq[i - 1]}`).toBeGreaterThan(codes[i - 1]);
    }
  });

  it('非法输入直接抛：格式不符 / minor 或 patch > 99', () => {
    for (const bad of ['1.2', '1.2.3.4', 'v1.2.3', '', '1.2.x']) {
      expect(() => deriveVersionCode(bad), bad).toThrow(/格式非法/);
    }
    expect(() => deriveVersionCode('1.100.0')).toThrow(/≤ 99/);
    expect(() => deriveVersionCode('1.0.100')).toThrow(/≤ 99/);
  });
});
