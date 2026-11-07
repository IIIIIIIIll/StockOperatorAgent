// 构建配置防漂移回归(评审 2026-11-07 CR-04/CR-40):
// - app/tsconfig.json 必须是内联版(无 extends):CI 只装根依赖时 vite/oxc
//   解析 extends "expo/tsconfig.base" 会 TSCONFIG_ERROR,13 个 test file 直接
//   transform 失败(2026-10-21 实证)。
// - desktop build 入口必须调用恢复脚本,否则 expo export 改写后留下脏 diff。
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

describe('app/tsconfig.json 防漂移(CR-04)', () => {
  it('不得声明 extends(内联 expo SDK 选项)', () => {
    const text = fs.readFileSync('app/tsconfig.json', 'utf8');
    expect(text).not.toMatch(/"extends"\s*:/);
  });
});

describe('desktop build 入口(CR-40)', () => {
  it('build 脚本调用 restore-app-tsconfig(与 app web / release 对齐)', () => {
    const pkg = JSON.parse(fs.readFileSync('desktop/package.json', 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.build).toContain('restore-app-tsconfig');
  });
});
