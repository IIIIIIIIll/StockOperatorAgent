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

// 同源代理(dev server):/llm-proxy /tdx-collect /web-search 与生产 server.mjs
// 共用 lib/proxies.cjs 单份实现(含 .ts 依赖,需 Node 带 --experimental-strip-types
// 启动——见 package.json "start");日志汇聚见 lib/logs-server.cjs。
const { handleLlmProxy, handleTdxCollect, handleWebSearch } = require('./lib/proxies.cjs');
const { handleLogs } = require('./lib/logs-server.cjs');

config.server.enhanceMiddleware = (middleware, _server) => {
  return (req, res, next) => {
    if (req.method === 'POST' && req.url.startsWith('/llm-proxy/')) {
      void handleLlmProxy(req, res);
      return;
    }
    if (req.method === 'GET' && req.url.startsWith('/tdx-collect')) {
      void handleTdxCollect(req, res);
      return;
    }
    if (req.method === 'GET' && req.url.startsWith('/web-search')) {
      void handleWebSearch(req, res);
      return;
    }
    if (req.method === 'POST' && req.url === '/logs') {
      void handleLogs(req, res); // 日志汇聚(与 server.mjs 同实现,见 lib/logs-server.cjs)
      return;
    }
    return middleware(req, res, next);
  };
};

module.exports = config;
