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
      // langsmith 的 package.json browser 字段会把 fs.js → fs.browser.js、
      // worker_threads.js → worker_threads.browser.js;Metro 不认 browser 字段,
      // 这里等价实现:目标有 .browser. 孪生文件则用孪生(浏览器桩,无 node:fs)。
      const browserTwin = resolved.replace(/\.cjs$/, '.browser.cjs').replace(/\.js$/, '.browser.js');
      return { type: 'sourceFile', filePath: fs.existsSync(browserTwin) ? browserTwin : resolved };
    }
  }
  if (moduleName === 'langsmith') {
    return { type: 'sourceFile', filePath: langsmithCjs('index') };
  }
  if (moduleName.startsWith('langsmith/')) {
    const sub = moduleName.slice('langsmith/'.length).replace(/\.js$/, '');
    return { type: 'sourceFile', filePath: langsmithCjs(sub) };
  }
  // node: 内建重定向 —— Hermes 无 Node 内建,node-tdx-market 的 dist 产物用到的
  // node:net / node:events / node:zlib 分别映射到 lib 下的适配层与实现。
  if (moduleName === 'node:net') {
    return { type: 'sourceFile', filePath: path.resolve(__dirname, 'lib', 'net-shim.ts') };
  }
  if (moduleName === 'node:events') {
    // 不能 require.resolve('events'):在 Node 里会命中内建模块;必须显式指到 npm 包文件
    return { type: 'sourceFile', filePath: require.resolve('events/events.js') };
  }
  if (moduleName === 'node:zlib') {
    return { type: 'sourceFile', filePath: path.resolve(__dirname, 'lib', 'zlib-shim.cjs') };
  }
  if (moduleName === 'node:async_hooks') {
    return { type: 'sourceFile', filePath: path.resolve(__dirname, 'lib', 'async-hooks-shim.ts') };
  }
  // markdown-it@10 normalizeLink 用 punycode.toASCII/toUnicode(IDNA),Metro 无此内建
  if (moduleName === 'punycode') {
    return { type: 'sourceFile', filePath: path.resolve(__dirname, 'lib', 'punycode-shim.ts') };
  }
  // langgraph:原生平台跟随包声明的 browser 条件(web 平台即此构建)——避免
  // dist/index.js → node.js 里模块顶层 new AsyncLocalStorage() 的 node: 依赖。
  if (moduleName === '@langchain/langgraph') {
    const lgDir = path.dirname(require.resolve('@langchain/langgraph/package.json'));
    return { type: 'sourceFile', filePath: path.join(lgDir, 'dist', 'web.js') };
  }
  return context.resolveRequest(context, moduleName, platform);
};

// 同源代理(dev server):/llm-proxy /tdx-collect /yahoo-collect /web-search 与生产
// server.mjs 共用 lib/proxies.cjs 单份实现(含 .ts 依赖,需 Node 带
// --experimental-strip-types 启动——见 package.json "start");日志汇聚见
// lib/logs-server.cjs。
const { handleLlmProxy, handleTdxCollect, handleWebSearch, handleYahooCollect } = require('./lib/proxies.cjs');
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
    if (req.method === 'POST' && req.url.startsWith('/yahoo-collect')) {
      void handleYahooCollect(req, res);
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
