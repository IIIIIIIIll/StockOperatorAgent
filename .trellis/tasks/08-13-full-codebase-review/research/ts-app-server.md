# ts-app-server 审查报告

> 分片:TS 服务端/代理层(ts/app/lib + ts/app/server.mjs + ts/app/metro.config.js)
> 审查方式:纯只读,逐文件完整阅读;跨文件引用经 grep 核实(webSearch.ts / webCollect.ts / llm.ts / log.ts / committee / Python web_search.py)。

## 审阅覆盖

|文件|行数|结论|
|---|---|---|
|ts/app/lib/proxies.cjs|164|有发现(CRITICAL×0, WARNING×4, INFO×2)|
|ts/app/lib/logs-server.cjs|91|有发现(WARNING×1)|
|ts/app/lib/logs-server.d.cts|15|无发现(纯类型声明,与 .cjs 导出一致)|
|ts/app/lib/runner.ts|114|有发现(INFO×1)|
|ts/app/lib/settings.ts|241|有发现(WARNING×1, INFO×1)|
|ts/app/lib/log.ts|6|无发现(纯重导出 ts/src/log.ts,导出符号逐一对齐)|
|ts/app/server.mjs|68|有发现(CRITICAL×1, INFO×2)|
|ts/app/metro.config.js|65|有发现(INFO×1)|

## 发现

### [CRITICAL] 畸形百分号编码路径使生产 server 进程崩溃(远程 DoS)
- **位置**: ts/app/server.mjs:31(serveStatic;createServer 回调 :60 同步调用,无 try/catch)
- **问题**: `decodeURIComponent(new URL(req.url, 'http://x').pathname)` 对畸形百分号编码(如 `GET /%ZZ`)抛 `URIError`;serveStatic 在请求回调内同步执行且全文件无任何异常兜底,Node 默认 uncaughtException 直接退出进程 → 未认证客户端一条畸形请求即可打崩生产 web server(dist 静态服务 + 全部代理下线),属可远程触发的 DoS。
- **证据**:
  ```js
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  ...
  serveStatic(req, res);
  ```
- **建议**: decodeURIComponent 包 try/catch → 失败回 400;或先做合法性预检。
- **spec 对照**: 违反本文件对日志端点确立的「失败 → 5xx {error},不崩 server」错误处理约定(logs-server.cjs:42-43 注释);ts/index.md 未定义静态服务异常路径,但进程级崩溃显然非设计意图。

### [WARNING] /llm-proxy 请求体无大小上限(内存耗尽 DoS)
- **位置**: ts/app/lib/proxies.cjs:23-24
- **问题**: `for await (const chunk of req) body += chunk;` 无上限累积;同仓 logs 端点(logs-server.cjs:15, MAX_BODY_BYTES=64KB)有 64KB 上限而 LLM 代理没有;dev(Metro)与生产(server.mjs)双入口均无鉴权,任意可达者可发超大 POST 体持续拖垮内存。
- **证据**: `let body = ''; for await (const chunk of req) body += chunk;`
- **建议**: 对齐 logs-server 校验:累计超限即 413 回包并终止读取。
- **spec 对照**: 无直接 spec;与仓库既有 64KB 上限模式不一致。

### [WARNING] /llm-proxy 未鉴权开放代理(SSRF 面;生产 server 绑定全接口)
- **位置**: ts/app/lib/proxies.cjs:26-34 + ts/app/server.mjs:63(`server.listen(PORT)`)
- **问题**: 代理目标完全由客户端可控(`x-llm-base` 头或 body.base 任意 URL),Node 侧 fetch 可访问内网/云元数据(169.254.169.254)等端点,并原样透传客户端 Authorization 头;server.listen 默认绑定所有接口且端点无任何鉴权 → 局域网任意主机可把该服务当开放 HTTP 代理。**密钥暴露面结论**:LLM key 本就存于浏览器 localStorage(设计如此,对齐 Python Streamlit 服务端调用架构),经同源代理转发上游,key 非服务端机密,代理本身不泄露服务端密钥;风险在于「开放代理 + 任意目标」的组合被滥用(SSRF/内网探测)。
- **证据**: `const baseUrl = req.headers['x-llm-base'] || base; const target = \`${baseUrl}/${req.url.slice('/llm-proxy/'.length)}\`;` + `Authorization: req.headers.authorization || ''` + `server.listen(PORT, ...)`(无 host/鉴权参数)
- **建议**: 限制 base 必须 http(s) 且拒绝内网/环回地址(SSRF 防护);生产监听支持 HOST 配置或加简单 token 鉴权。
- **spec 对照**: ts/index.md「同源代理」未定义鉴权;属安全面缺口的组合风险。

### [WARNING] handleWebSearch 拒绝含空格查询 → web 模式多词搜索必然 400
- **位置**: ts/app/lib/proxies.cjs:139-143
- **问题**: `/^\S+$/` 拒绝任何含空白查询;LLM 工具调用生成的自然查询(如「贵州茅台 最新公告」「宁德时代 2026 中报」)几乎必含空格 → 400 → 浏览器分支 makeProxySearcher(ts/src/webSearch.ts:65-70)对非 ok 抛错 → toolLoop 降级为占位「（联网搜索失败：web-search 代理 HTTP 400）」;而 Node/RN 直连 ddgSearcher 无此限制,同一查询两平台行为不一致。注释声称「对齐 Python web_search 工具语义」,但 Python 侧(core/llms/tools/web_search.py:121)对 query 无空白限制 —— 该约束与声称的语义不符,web 模式联网搜索对常见查询实际不可用。
- **证据**: `if (!q || q.length > 200 || !/^\S+$/.test(q)) { res.writeHead(400, ...); }`
- **建议**: 移除 `\S` 约束(保留非空 + ≤200 字符;可 trim 后判非空)。
- **spec 对照**: 偏离「对齐 Python web_search 工具语义」注释;ts/index.md 未规定该限制。

### [WARNING] /logs 日志注入:message 未净化换行,可伪造日志行/终端注入
- **位置**: ts/app/lib/logs-server.cjs:81-82(appendLogLine :34-39)
- **问题**: message 仅截断 4KB,未过滤 `\n`/`\r`,原样拼入行尾写入文件;POST /logs 在 dev/prod 均无鉴权 → 任意可达者可注入伪造日志行(审计污染),并可携带 ANSI 转义序列(终端 tail 查看时终端注入)。platform 亦仅校验非空。
- **证据**: `appendLogLine(\`${formatTs(data?.ts)} | ${level.toUpperCase()} | [soa] ${truncated} (platform:${platform})\`);` + `fs.appendFileSync(file, \`${line}\n\`);`
- **建议**: 落盘前对 message/platform 做 `replace(/[\r\n]+/g, ' ')` 净化(与 RN 沙盒侧行为保持一致)。
- **spec 对照**: ts/index.md 行格式约定未定义净化;属安全面缺失。

### [WARNING] LLM 可达性检测把代理 502 误判为「代理不存在」,端点宕机时给出误导诊断
- **位置**: ts/app/lib/settings.ts:178-185(代理侧 502 产生点 proxies.cjs:54)
- **问题**: 代理在「上游不可达/连接失败」时也回 502(proxies.cjs:47-55 catch);checkLlmReachability 将 502 一律当作「代理不可用」→ 回退浏览器直连 → 跨域失败 → 展示「浏览器跨域被拒(CORS)——本环境无 /llm-proxy 代理(请用 npx expo start 或 node server.mjs 启动)」(settings.ts:199-201)。真实原因是配置的 LLM 端点不可达/域名错误 —— 恰在端点宕机这一核心诊断场景给出错误归因(代理明明在跑)。
- **证据**: `if (viaProxy.status !== 502 && viaProxy.status !== 404) { proxyUsed = true; return await classifyChatResponse(...); } warn('LLM 代理不可用(HTTP ...)');`
- **建议**: 502 时解析代理响应体错误信息直接展示(或区分「代理自身不可达」与「上游错误」两种状态)。
- **spec 对照**: 无直接 spec;属可达性诊断逻辑缺陷。

### [WARNING] TDX 采集超时后互斥失效:后台采集继续,可并发双 TdxClient 连接
- **位置**: ts/app/lib/proxies.cjs:115-127
- **问题**: 45s 超时仅使 Promise.race 落败,doCollect 仍在后台执行;finally 无条件 `collecting = false` → 用户收到 504 后立即重试,即与上一采集并行(两路 TdxClient 同连 TDX server),违背注释「并发互斥(单连接够用)」;超时 timer 亦未 clear(常驻事件循环 45s)。
- **证据**: `const result = await Promise.race([doCollect(ticker), new Promise((_, reject) => setTimeout(...45s))]); ... finally { collecting = false; }`
- **建议**: 用 AbortController 取消 doCollect,或记录 in-flight Promise,超时后保持锁直到其真正 settle。
- **spec 对照**: 偏离「并发互斥(单连接够用)」设计注释。

### [INFO] runner.ts 遗留 LLM 配置持久化死代码(双份持久化路径)
- **位置**: ts/app/lib/runner.ts:39-62
- **问题**: readSavedConfig/saveConfig/clearConfig(localStorage key `soa:llm-config`)全仓无调用点;与 settings.ts 的 `soa:settings`(KEY, settings.ts:57)形成两套 LLM 配置持久化路径,易误导后续维护。
- **建议**: 删除死代码,统一走 settings.ts 持久化。
- **spec 对照**: N/A(风格/维护性)。

### [INFO] checkLlmReachability 中 proxyUsed 赋值后从未读取
- **位置**: ts/app/lib/settings.ts:169, 179
- **问题**: `let proxyUsed = false; ... proxyUsed = true;` 变量从未被消费,死代码。
- **建议**: 删除,或用于日志标注走了代理。
- **spec 对照**: N/A。

### [INFO] proxies.cjs 注释「补 CORS 头」过时
- **位置**: ts/app/lib/proxies.cjs:18
- **问题**: 代理为同源(浏览器相对路径 `/llm-proxy/...`),不需要 CORS 头,代码也确实未设置;注释与实现不符(历史遗留文案)。
- **建议**: 更新注释(同源代理,无需 CORS)。
- **spec 对照**: N/A。

### [INFO] server.mjs PORT 非法值启动即崩且无友好提示;无 HOST 配置
- **位置**: ts/app/server.mjs:12, 63
- **问题**: `Number(process.env.PORT || 8090)` 对 `PORT=abc` 得 NaN,`server.listen(NaN)` 抛 ERR_SOCKET_BAD_PORT 进程退出且报错晦涩;且无 HOST 环境变量支持(默认绑定全接口,放大发现 3 的暴露面)。
- **建议**: 校验 PORT 为合法整数否则回退默认;支持 HOST 配置。
- **spec 对照**: N/A。

### [INFO] 客户端断开不中止上游 LLM 请求(付费 token/带宽浪费)
- **位置**: ts/app/lib/proxies.cjs:41-45
- **问题**: 流式透传中客户端断开只由 catch 兜底 destroy,未用 AbortController 取消 upstream fetch → 上游 LLM 继续生成到结束(流式场景下付费 token 白耗)。
- **建议**: 监听 `req` 的 aborted/close 事件 → controller.abort()。
- **spec 对照**: N/A(现行为安全,不挂起;仅资源效率)。

### [INFO] metro.config.js 顶层 require proxies.cjs 使 `expo export` 依赖 strip-types
- **位置**: ts/app/metro.config.js:46-47
- **问题**: 配置加载即 require proxies.cjs → 拉入 `../../src/*.ts` 依赖链;`npm run web` 第一步 `expo export --platform web` 未带 `--experimental-strip-types`(ts/app/package.json scripts.web),Node <23.6 时 export 阶段即失败(注释已声明 ≥23.6 默认开启,属可移植性提示,非当前环境问题)。
- **建议**: export 命令同样补 flag,或注释明示 Node ≥23.6 要求。
- **spec 对照**: 符合 ts/index.md「dev npm start 与生产启动命令已带 flag」的既定假设,仅提示边界。

### [INFO] llm.ts 注释示例 '/llm-proxy/v1' 与实际用法不符
- **位置**: ts/src/llm.ts:45(跨文件引用;消费点 ts/app/App.tsx:166-168)
- **问题**: 注释示例 proxyBase 为 `'/llm-proxy/v1'`,实际 App.tsx 传 `\`${origin}/llm-proxy\``(不含 /v1,防双重 /v1,App.tsx:165 注释已说明);注释误导后续维护。
- **建议**: 同步注释。
- **spec 对照**: N/A。

## spec 符合性结论

**审查重点逐项核对(ts/index.md 同源代理段 + 环境约束段):**

1. **SSE 透传** ✅ 符合:proxies.cjs:41-45 `if (upstream.body) { for await (const chunk of upstream.body) res.write(chunk); } res.end();` 与 spec 逐字一致,无 `await upstream.text()` 整体缓冲;双入口(metro 中间件/server.mjs)共用单份实现,防漂移收敛符合 spec。
2. **writeHead 兜底** ✅ 符合:proxies.cjs:47-55 catch 中 `if (res.headersSent) { res.destroy(); return; }` 精确实现 spec 要求;未 writeHead 路径保持 502 JSON。
3. **CJS/ESM 混载** ✅ 符合:ts/app/package.json 无 `"type"` 字段 → metro.config.js(.js)为 CJS、server.mjs(.mjs)为 ESM、proxies/logs-server 显式 .cjs;ESM import CJS 的命名导出经 cjs-module-lexer 从 `module.exports = {...}` 字面量解析,可用;`require('../../src/*.ts')` 依赖 strip-types 已由 start/web/serve 脚本带 flag,且被 require 的 .ts 模块(quoteClient/f10Client/webSearch/store-memory/events/llm)无顶层 await,require(esm) 路径成立。
4. **日志统一出口** ✅ 符合:lib/log.ts 为纯重导出,web 上报 /logs 与 RN 沙盒/Node 均由 ts/src/log.ts 统一路由,无第二出口。
5. **偏离清单**:上述 CRITICAL×1 + WARNING×6(进程崩溃兜底缺失、请求体/日志注入/SSRF 三个安全缺口、web 搜索空格校验与 Python 语义不符、502 语义重载、采集超时互斥失效)。

> 已排除的疑似问题(防假阳性核查):logs-server 轮转 ENOENT 竞争(appendLogLine 全同步,单线程下不交叉);/llm-proxy 双重 /v1(proxyBase 实际不含 /v1,App.tsx:165 注释确认设计意图);static 目录穿越(path.join + URL 点段归一化 + startsWith(DIST) 双保险,不可达);日志目录穿越(SOA_LOG_DIR 为运维 env,请求数据不参与路径构造)。
