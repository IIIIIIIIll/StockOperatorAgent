// 防复发:expo export 每次会把 app/tsconfig.json 改写为 extends "expo/tsconfig.base"
// (08-29-e2e 实证)。CI 只装根 lockfile、没有 app/node_modules/expo,改写后
// vitest(vite:oxc)按就近 tsconfig 解析 extends 报 [TSCONFIG_ERROR]。
// 本脚本检测到被改写 → 原样写回 HEAD 内联版(字节一致,含注释);未被改写 →
// 跳过。node 内建(零依赖);挂载:app/package.json "web" 脚本(export 后)与
// release.yml Build web bundle 步骤末尾。
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_TSCONFIG = join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'tsconfig.json');

// EXPECTED:当前 HEAD 的 app/tsconfig.json 全量内容(内联 expo tsconfig.base,
// 含注释)。模板字符串内嵌,与文件字节完全一致;expo export 改写后逐字节恢复。
// 升级 expo 模板需要手动同步本字符串(与文件同步更新,注释已注明)。
const EXPECTED = `{
  // 不再 extends "expo/tsconfig.base":vitest(vite:oxc)转换 app/**/*.ts 时按就近
  // tsconfig 解析 extends,而 CI 只装根 lockfile、没有 app/node_modules/expo,
  // 会报 [TSCONFIG_ERROR]。此处内联 expo SDK 57 tsconfig.base 全量选项;
  // 升级 expo 模板时需手动同步本文件。
  "compilerOptions": {
    "allowJs": true,
    "esModuleInterop": true,
    "jsx": "react-jsx",
    "lib": [
      "DOM",
      "ESNext"
    ],
    "module": "preserve",
    "moduleDetection": "force",
    "moduleResolution": "bundler",
    "customConditions": [
      "react-native"
    ],
    "noEmit": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "strict": true,
    "target": "ESNext",
    "allowImportingTsExtensions": true
  },
  "include": [
    "**/*.ts",
    "**/*.tsx",
    "**/*.d.ts",
    "../src/expo-file-system.d.ts"
  ],
  "exclude": [
    "node_modules",
    "babel.config.js",
    "metro.config.js",
    "jest.config.js",
    "android",
    "ios"
  ]
}`;

function main() {
  const current = readFileSync(APP_TSCONFIG, 'utf8');
  // tsconfig 是 JSONC(带 // 注释)——解析前剥离整行注释(文件内字符串无 //,
  // 全量内容见 EXPECTED,受控);解析失败(异常内容)→ 跳过不覆盖,防误伤。
  let parsed;
  try {
    parsed = JSON.parse(current.replace(/^\s*\/\/.*$/gm, ''));
  } catch {
    console.log('[restore-app-tsconfig] app/tsconfig.json 无法解析(内容异常),跳过不覆盖');
    return;
  }
  if (parsed.extends === 'expo/tsconfig.base') {
    writeFileSync(APP_TSCONFIG, EXPECTED);
    console.log('[restore-app-tsconfig] 检测到 expo export 改写 app/tsconfig.json(extends expo/tsconfig.base),已恢复内联版');
  } else {
    console.log('[restore-app-tsconfig] app/tsconfig.json 未被改写(无 expo/tsconfig.base),跳过');
  }
}

main();
