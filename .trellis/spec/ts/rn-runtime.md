---
description: RN/Hermes 运行时兼容(app/lib/polyfill + shim 族、metro resolveRequest 重定向、跨目录动态 import 边界)
paths:
  - app/lib/polyfill.ts
  - app/lib/zlib-shim.ts
  - app/lib/zlib-shim.cjs
  - app/lib/net-shim.ts
  - app/lib/punycode-shim.ts
  - app/lib/async-hooks-shim.ts
---

# RN/Hermes 运行时兼容面(08-15-android-standalone-tdx)

真机跑通 node-tdx-market + LangChain 所需的 Hermes 缺口,全部在
`app/lib/polyfill.ts` / `app/lib/*-shim.*`(metro resolveRequest 重定向):

- **Buffer#subarray 必须返回 Buffer 视图**(部分 Buffer 实现返回裸 Uint8Array
  → readUInt32BE undefined);polyfill 包一层 `Buffer.from(view.buffer,
  offset, len)`。
- **timer 句柄补 unref/ref no-op**(Hermes 返回数字;RN timer 不阻塞进程,
  no-op 语义正确);clearTimeout/clearInterval 自动解包。
- **crypto**:randomUUID + getRandomValues(Math.random 熵,仅 id 用途)。
- **navigator.userAgent**(langchain isJsDom 读它)→ 补空串。
- **AbortSignal.throwIfAborted**(LangGraph stream config 挂 signal,包装器
  调用)。
- **node:zlib**:node-tdx-market 每帧 inflateSync——手写 RFC1950/1951
  inflate(zlib-shim.ts);同步 require 经 **CJS 跳板**(zlib-shim.cjs)取导出。
- **GBK 解码用 iconv-lite**(Hermes TextDecoder 不支持 gbk),不走 TextDecoder。
- **lazy 模式下跨目录相对动态 import 运行时解析失效**(agents.ts
  `import './committee.ts'`)→ 改静态 import(agents↔committee 循环在 Metro
  CJS 语义下安全,运行时访问 live binding)。
- **EXPO_PUBLIC_* 必须直接 process.env.X 成员访问**——babel-preset-expo 只
  静态内联直接访问(约束与密钥轮换详见 [env-switches.md](./env-switches.md))。

## 修改纪律

- 新增 Hermes 缺口补丁一律进 polyfill.ts 或新建 `*-shim.{ts,cjs}`,并在 metro
  resolveRequest 登记重定向;不要改 node-tdx-market/langchain 源码。
- 同步 require 场景(如 zlib)必须走 CJS 跳板——ESM 静态 import 会把依赖拉进
  未打补丁的解析路径。
- 补丁尽量平台中立可单测(polyfill.ts 在 Node 下也应可执行,幂等)。
