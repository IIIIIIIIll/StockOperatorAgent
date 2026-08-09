// Metro:App 与 ts/src 业务层共享(import '../../src/...')
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const fs = require('node:fs');

const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, '..')];
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, 'node_modules'),
  path.resolve(__dirname, '..', 'node_modules'),
];

// langsmith ESM 顶层循环 import(utils/env.js → index.js → client.js)在
// 浏览器 TDZ 崩("Cannot access 'Client' before initialization")。包自带
// 完整 CJS 镜像(延迟 getter 无 TDZ)——全部重定向到 .cjs:
const LANGSMITH_DIR = path.dirname(require.resolve('langsmith/package.json'));

function langsmithCjs(sub) {
  const candidate = path.join(LANGSMITH_DIR, 'dist', `${sub}.cjs`);
  return fs.existsSync(candidate) ? candidate : path.join(LANGSMITH_DIR, 'dist', `${sub}.js`);
}

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const origin = context.originModulePath ?? '';
  if (origin.includes(`${path.sep}langsmith${path.sep}`)) {
    // 包内相对 import('./x.js') → 同目录 .cjs 镜像(无镜像则原样)
    const cjs = moduleName.replace(/^\.\//, '').replace(/\.js$/, '.cjs');
    const resolved = path.join(path.dirname(origin), cjs);
    if (fs.existsSync(resolved)) {
      return { type: 'sourceFile', filePath: resolved };
    }
  }
  if (moduleName === 'langsmith') {
    return { type: 'sourceFile', filePath: langsmithCjs('index') };
  }
  if (moduleName.startsWith('langsmith/')) {
    const sub = moduleName.slice('langsmith/'.length).replace(/\.js$/, '');
    return { type: 'sourceFile', filePath: langsmithCjs(sub) };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
