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

// LLM 同源代理(dev server):POST /llm-proxy/{path} → 转发配置的 base,
// 补 CORS 头(网页与 dev server 同源,彻底绕开浏览器跨域限制——
// 对齐 Streamlit 服务端调用 LLM 的架构)。生产构建见 server.mjs。
async function llmProxyHandler(req, res) {
  try {
    let body = '';
    for await (const chunk of req) body += chunk;
    const { base, ...payload } = JSON.parse(body);
    const target = `${base}/${req.url.slice('/llm-proxy/'.length)}`;
    const upstream = await fetch(target, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: req.headers.authorization || '',
      },
      body: JSON.stringify(payload),
    });
    const text = await upstream.text();
    res.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') || 'application/json',
    });
    res.end(text);
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: `LLM 代理转发失败:${String((err).message ?? err)}` } }));
  }
}

config.server.enhanceMiddleware = (middleware, _server) => {
  return (req, res, next) => {
    if (req.method === 'POST' && req.url.startsWith('/llm-proxy/')) {
      void llmProxyHandler(req, res);
      return;
    }
    return middleware(req, res, next);
  };
};

module.exports = config;
