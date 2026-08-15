// node:zlib CJS 跳板 —— frame.js 用同步 require("node:zlib") 取 inflateSync;
// Metro lazy/ESM 互操作下同步 require ESM 模块拿到空导出(诊断 2026-08-15:
// 动态 import 正常但同步 require 得 undefined)。CJS → TS 先例:proxies.cjs
// require('../../src/*.ts')(Node);Metro 对 .ts 的 require 同样可打包。
module.exports = require('./zlib-shim.ts');
