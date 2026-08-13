# security 审查报告

> 分片：SecuritySweep（全仓安全面）。纯只读审查：未运行任何测试/应用/linter，未发任何网络请求。
> 数据源标注：每条发现注明「外部不可信 / 内部受信」；vendor 快照与内部常量按 .trellis/spec/guides/index.md 信任边界规则处理（内部数据不报缺校验）。

## 审阅覆盖

| 文件 | 行数 | 结论 |
|---|---|---|
| main.py | 24 | 无发现 |
| utils/constants.py | 22 | 无发现 |
| utils/env_file.py | 175 | 有发现（F11） |
| utils/runtime_config.py | 103 | 无发现 |
| utils/billions_config.py | 110 | 无发现 |
| utils/market_time.py | 60 | 无发现 |
| utils/time_helper.py | 30 | 无发现 |
| utils/state.py | 16 | 无发现 |
| utils/formatting.py | 20 | 无发现 |
| core/investment_committee.py | 173 | 无发现 |
| core/role_registry.py | 200 | 无发现 |
| core/data_acquisition.py | 330 | 无发现 |
| core/legacy_akshare.py | 210 | 无发现 |
| core/stock_output_formatter.py | 50 | 无发现 |
| core/llms/llm_factory.py | 50 | 无发现 |
| core/llms/prompt.py | 180 | 无发现 |
| core/llms/tool_loop.py | 110 | 无发现 |
| core/llms/progress.py | 80 | 无发现 |
| core/llms/retry.py | 70 | 无发现 |
| core/llms/tools/web_search.py | 128 | 无发现 |
| core/llms/tools/get_market_intel.py | 104 | 无发现 |
| core/llms/tools/mcp_intel_cache.py | 70 | 有发现（F9） |
| core/llms/tools/get_financial_indicators.py | 60 | 无发现 |
| core/llms/tools/get_trend_indicators.py | 100 | 无发现 |
| core/llms/tools/get_company_info.py | 20 | 无发现 |
| core/llms/tools/extra_indicators.py | 90 | 无发现 |
| core/llms/tools/_capped.py | 40 | 无发现 |
| core/llms/tools/_items.py | 25 | 无发现 |
| core/llms/tools/billions_search.py | 80 | 无发现 |
| core/llms/tools/billions_twitter.py | 80 | 无发现 |
| core/llms/tools/billions_fetch.py | 75 | 有发现（F10） |
| core/llms/tools/billions_fin_db.py | 80 | 无发现 |
| core/ui/display.py | 527 | 无发现 |
| core/ui/charts.py | 140 | 无发现 |
| core/ui/data_markdown.py | 290 | 无发现 |
| core/ui/theme.py | 120 | 无发现 |
| agents/base.py | 85 | 无发现 |
| agents/chinese_mainland/（7 文件） | 330 | 无发现 |
| data_source/.../tdx/tdx_source.py | 236 | 无发现（vendor 导入面见 F13） |
| data_source/.../tdx/reports.py | 130 | 无发现 |
| data_source/.../tdx/overview.py | 190 | 无发现 |
| data_source/.../tdx/mapping.py | 70 | 无发现 |
| data_source/.../tdx/f10_parser.py | 110 | 无发现 |
| data_source/.../tdx/adjust.py | 100 | 无发现 |
| data_source/.../billions/client.py | 214 | 无发现 |
| data_source/.../akshare/fetch_stcok_data.py | 30 | 无发现 |
| data_storage/chinese_mainland/ZODBStorage.py | 105 | 无发现（pickle 面评估见 F14） |
| data_structure/chinese_mainland/（5 文件） | 180 | 无发现 |
| scripts/backfill_f10_quarters.py | 90 | 无发现 |
| scripts/export_seed_002027.py | 60 | 无发现 |
| tdx/vendor/（55 .py，data_pipeline + tdx_mcp） | 4500 | 无发现（入口通读 + 危险模式全扫描；F13） |
| .streamlit/config.toml | 20 | 无发现（仅主题；server 保持默认 localhost） |
| .env.example | 40 | 无发现（全占位符，无真实密钥） |
| requirements.txt | 100 | 无发现（全部钉版本，无可疑依赖） |
| .gitignore（根/ts/ts-app） | — | 无发现（.env、database、logs、node_modules、dist 正确忽略） |
| ts/app/lib/proxies.cjs | 164 | 有发现（F1、F6） |
| ts/app/server.mjs | 68 | 有发现（F2） |
| ts/app/metro.config.js | 72 | 有发现（F1 dev 面） |
| ts/app/lib/logs-server.cjs | 105 | 有发现（F6、F8） |
| ts/app/lib/settings.ts | 241 | 有发现（F3、F4） |
| ts/app/lib/runner.ts | 118 | 有发现（F4） |
| ts/app/lib/log.ts | 10 | 无发现（重导出 ts/src/log.ts） |
| ts/src/log.ts | 180 | 无发现（上报 payload 不含密钥） |
| ts/src/llm.ts | 70 | 无发现 |
| ts/src/webSearch.ts | 212 | 有发现（F3 附带：Tavily 键名不匹配） |
| ts/src/events.ts | 160 | 无发现 |
| ts/src/store.ts | 241 | 无发现（全参数化 SQL） |
| ts/src/store-memory.ts | 90 | 无发现 |
| ts/src/webCollect.ts | 90 | 无发现 |
| ts/src/pipeline.ts | 160 | 无发现 |
| ts/src/committee.ts | 150 | 无发现 |
| ts/src/agents.ts | 300 | 无发现 |
| ts/src/toolLoop.ts | 120 | 无发现 |
| ts/src/retry.ts | 130 | 无发现 |
| ts/src/progress.ts | 60 | 无发现 |
| ts/src/gates.ts | 80 | 无发现 |
| ts/src/format.ts | 10 | 无发现 |
| ts/src/prompt.ts | 90 | 无发现 |
| ts/src/adjust.ts | 110 | 无发现 |
| ts/src/f10.ts | 110 | 无发现 |
| ts/src/reports.ts | 100 | 无发现 |
| ts/src/overview.ts | 120 | 无发现 |
| ts/src/indicators.ts | 170 | 无发现 |
| ts/src/tdx/quoteClient.ts | 90 | 无发现 |
| ts/src/tdx/f10Client.ts | 85 | 无发现 |
| ts/src/tdx/xdxr.ts | 75 | 无发现 |
| ts/app/App.tsx | 401 | 有发现（F5） |
| ts/app/screens/DataScreen.tsx | 200 | 无发现 |
| ts/app/screens/SettingsPanel.tsx | 190 | 无发现 |
| ts/app/screens/ReportScreen.tsx | 90 | 无发现 |
| ts/app/components/MarkdownText.tsx | 40 | 无发现（RNMD 不渲染 HTML，无 XSS 面） |
| ts/app/components/ReportContent.tsx | 95 | 无发现 |
| ts/app/components/IndicatorChart.tsx | 200 | 无发现 |
| ts/app/theme.ts | 80 | 无发现 |
| ts/app/index.ts | 8 | 无发现 |
| ts/app/.env.example | 7 | 有发现（F3） |
| ts/app/package.json | 35 | 有发现（F7） |
| ts/package.json | 25 | 有发现（F7） |
| ts/tools/probe.mts | 100 | 有发现（F12） |
| ts/tools/export_fixtures.py | 70 | 有发现（F12） |
| ts/test/（25 文件） | 6000 | 无发现（安全模式扫描 + 安全相关用例抽查） |

## 发现

### [CRITICAL] /llm-proxy 开放 SSRF：转发目标客户端可控 + 响应全量回显，无鉴权
- **位置**: ts/app/lib/proxies.cjs:25-41（handleLlmProxy 本体）；路由 ts/app/server.mjs:52-55、ts/app/metro.config.js:63-66（dev 与生产共用同一实现）
- **问题**: `/llm-proxy/*` 端点无任何鉴权/来源校验。转发目标 base 完全由客户端通过 `X-LLM-Base` 请求头或 JSON body 的 `base` 字段指定，无 scheme/host 白名单；上游响应体（含任意内网服务的响应）被原样 pipe 回客户端。任何能触达该端点的客户端（结合 F2 的局域网暴露）可让 server 对内网任意 HTTP(S) 服务发起带攻击者指定 Authorization/body 的 POST 并读取完整响应——开放 SSRF + 内网探测 + 响应回显（含云 metadata 服务、同机其他服务等）。dev 模式 Metro 中间件同样生效（Expo 默认监听局域网）。
- **证据**:
  ```js
  const { base, ...payload } = JSON.parse(body);
  const baseUrl = req.headers['x-llm-base'] || base;
  const target = `${baseUrl}/${req.url.slice('/llm-proxy/'.length)}`;
  const upstream = await fetch(target, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: req.headers.authorization || '' },
    body: JSON.stringify(payload) });
  ...
  if (upstream.body) { for await (const chunk of upstream.body) res.write(chunk); }
  ```
- **建议**: ① 转发目标只允许从服务端受信配置读取（env/配置，忽略客户端 X-LLM-Base/body.base），或对 base 做 scheme（仅 https）+ host 白名单/内网 IP 阻断；② 端点加鉴权（回环绑定 + 同源/token 校验）；③ 限制响应体大小与并发。
- **spec 对照**: ts/index.md「同源代理」节定义了 SSE pipe 透传与双入口收敛，但未定义上游地址校验/鉴权——spec 未覆盖的安全缺口；同源代理隐含的信任模型（仅同源浏览器）被 F2 的对外监听破坏。
- **数据源**: 外部不可信（任意 HTTP 客户端请求）

### [WARNING] server.mjs 未指定监听 host，全部端点暴露到局域网且无鉴权
- **位置**: ts/app/server.mjs:66
- **问题**: `server.listen(PORT)` 不带 host → Node 绑定 `::`/0.0.0.0（所有网卡）。生产 web server 与 dev Metro 中间件上的 `/llm-proxy`、`/tdx-collect`、`/web-search`、`/logs` 全部无鉴权暴露到局域网，放大 F1 并引入 F6 的 DoS/污染面。
- **证据**: `server.listen(PORT, () => { console.log(...); });`
- **建议**: 默认 `server.listen(PORT, '127.0.0.1')` 或提供显式 host 配置；确需局域网访问时给敏感端点加 token 鉴权。
- **spec 对照**: ts/index.md「同源代理」未定义监听地址/鉴权契约——缺口。
- **数据源**: 内部部署配置（产生对外暴露面）

### [WARNING] EXPO_PUBLIC_LLM_API_KEY 内联进 web 静态包，密钥随站点分发
- **位置**: ts/app/.env.example:3-5；ts/app/lib/settings.ts:76-82；ts/app/App.tsx:79-81
- **问题**: Expo 把 `EXPO_PUBLIC_*` 在构建时内联进 web 静态产物（`expo export` → dist/）。用户按 .env.example 填入 `EXPO_PUBLIC_LLM_API_KEY` 后（settings.ts 明确用它做「面板未保存键的兜底」），密钥进入每个下载者都能拿到的 JS bundle。注释自述「浏览器可读」属刻意设计，但这是真实的密钥泄露通道且无任何警示文案。
- **证据**: `.env.example: EXPO_PUBLIC_LLM_API_KEY=`；`settings.ts: if (!k.llmApiKey && env.EXPO_PUBLIC_LLM_API_KEY) k.llmApiKey = env.EXPO_PUBLIC_LLM_API_KEY;`
- **建议**: web 部署不使用 EXPO_PUBLIC 注入真 key；LLM key 由服务端持有，/llm-proxy 由 server 注入 Authorization（浏览器零密钥）。
- **附带发现（同名文件，INFO）**: ts/app/.env.example:7 文档化 `EXPO_PUBLIC_TAVILY_API_KEY`，但代码读的是 `process.env.TAVILY_API_KEY`（ts/src/webSearch.ts:82）——web 端 Metro 只内联 EXPO_PUBLIC_*，该键在 web 上永不生效（死配置），而填了它仍会被打进 bundle；Node/RN 端需 shell env 同名键才生效。建议统一键名。
- **spec 对照**: N/A（无相关 spec）
- **数据源**: 内部配置（机制风险；模板本身无真实密钥）

### [WARNING] API 密钥明文持久化在 localStorage
- **位置**: ts/app/lib/settings.ts:58,109-114；ts/app/lib/runner.ts:37,48-57
- **问题**: LLM/TDX/亿信/LangSmith 四类密钥以明文 JSON 存 localStorage（键 `soa:settings`、`soa:llm-config`）。localStorage 对同源任意脚本可读、可被浏览器 profile/扩展提取。当前无已知 XSS 向量（MarkdownText 用 react-native-markdown-display，不渲染原始 HTML），属纵深防御缺口。
- **证据**: `const KEY = 'soa:settings'; ... globalThis.localStorage?.setItem(KEY, JSON.stringify(s));`；`globalThis.localStorage?.setItem(CFG_KEY, JSON.stringify(cfg));`
- **建议**: 密钥走服务端/受保护存储；至少 UI 提示风险；RN 侧接 Keychain/加密存储。
- **spec 对照**: N/A
- **数据源**: 内部（本地持久化）

### [WARNING] window.__soa 调试后门无条件暴露（成本 DoS / XSS 放大面）
- **位置**: ts/app/App.tsx:236-240
- **问题**: 无 NODE_ENV 守卫地把 `window.__soa = { start, switchTab, getState }` 挂到全局。任意同源脚本（含未来注入的第三方脚本/扩展）可反复调用 `__soa.start()` 触发真实 LLM/亿信分析，消耗用户 API 配额与费用（成本 DoS）；`getState` 暴露运行状态与部分报告内容。
- **证据**: `(window as unknown as Record<string, unknown>).__soa = { start: () => void start(), switchTab: (id: TabId) => setActiveTab(id), getState: () => ({ finalDecision, eventCount: events.length, running, partials, statuses }) };`
- **建议**: 仅 dev 构建暴露（NODE_ENV/__DEV__ 守卫）或移除。
- **spec 对照**: N/A（调试/自动化钩子，无 spec 约束）
- **数据源**: 内部（暴露后任意同源脚本可达）

### [WARNING] /tdx-collect 与 /logs 无鉴权无限流（LAN 暴露面上的 DoS/污染）
- **位置**: ts/app/lib/proxies.cjs:119-150（handleTdxCollect）；ts/app/lib/logs-server.cjs:62-105（handleLogs）
- **问题**: ① `/tdx-collect` 全局 `collecting` 互斥 + 45s 超时——局域网客户端可反复触发真实 TDX 网络抓取并独占互斥（拒绝服务 + 对外流量滥用），ticker 虽有 `/^\d{6}$/` 校验但无来源限制；② `/logs` 接受任意 POST 把内容写进日志文件（64KB/请求、无速率限制）——日志污染。
- **证据**: `let collecting = false; ... if (collecting) { res.writeHead(429, ...); return; } collecting = true;`（proxies.cjs:127-129）；`const { level, message, platform } = data ?? {}; ... appendLogLine(...)`（logs-server.cjs:74-91）
- **建议**: 与 F2 一并处理（回环绑定 + token 鉴权）；/tdx-collect 加调用冷却与并发上限。
- **spec 对照**: ts/index.md「同源代理」未定义鉴权——缺口
- **数据源**: 外部不可信

### [WARNING] 依赖供应链：allowScripts 全开 + 浮动 ^ 版本 + 小众协议依赖
- **位置**: ts/app/package.json:29-31；ts/package.json:12-19
- **问题**: ① ts/app 声明 `"allowScripts": {"**": true}`——允许全部依赖执行 postinstall 脚本；② ts/package.json 依赖全用 ^ 浮动范围（`node-tdx-market ^0.2.1`、`better-sqlite3 ^13.0.3`、`@langchain/* ^1.x`、`vitest ^4.1.10`、`typescript ^7.0.2`），npm 重装可拉到未审计新版本（package-lock.json 已锁，但锁文件本身需定期审计）；③ `node-tdx-market` 是小众第三方 TDX 二进制协议客户端，是全仓库最集中的供应链风险点。
- **证据**: `"allowScripts": { "**": true }`；`"node-tdx-market": "^0.2.1"`
- **建议**: 收紧/移除 allowScripts（仅放行受信包）；关键依赖改精确版本；对 node-tdx-market 做一次代码审计或 vendor 固定 commit 快照。
- **spec 对照**: N/A
- **数据源**: 内部（供应链决策）

### [INFO] /logs 日志行内容未换行消毒（日志注入/伪造）
- **位置**: ts/app/lib/logs-server.cjs:87-91
- **问题**: `message`/`platform` 未做 \r\n 剥离直接拼入日志行；platform 仅校验非空字符串。任意客户端可写入伪造日志行（伪造审计轨迹/干扰排障）。本地文件、低影响。
- **证据**: `appendLogLine(`${formatTs(data?.ts)} | ${level.toUpperCase()} | [soa] ${truncated} (platform:${platform})`);`
- **建议**: 对 message/platform 做换行转义/剥离。
- **spec 对照**: N/A
- **数据源**: 外部不可信

### [INFO] mcp_intel_cache 用 ticker 直接拼缓存目录（穿越点被上游校验挡住）
- **位置**: core/llms/tools/mcp_intel_cache.py:34-36
- **问题**: `_cache_path` 用 `f"ticker={ticker}"` 拼目录并在写侧 mkdir+write——若 ticker 含 `../` 即目录穿越（写任意位置）。当前全部调用链上游已校验 6 位数字（display.py:390-391 `isdigit() and len==6`；App.tsx:130-137 `/^\d{6}$/`），不可达；但模块自身无校验，未来新调用方可能绕过——纵深防御缺口。
- **证据**: `return Path(cache_root) / "mcp_intel" / f"ticker={ticker}" / "data.json"`
- **建议**: 模块内加 `re.fullmatch(r"\d{6}", ticker)` 防御式断言。
- **spec 对照**: 符合 error-handling 降级约定；穿越点由上游校验兜底
- **数据源**: 外部输入（UI ticker），当前有上游校验

### [INFO] billions_fetch 工具 url 参数无校验（LLM 工具输入，出网由上游执行）
- **位置**: core/llms/tools/billions_fetch.py:62-70；data_source/chinese_mainland/billions/client.py:195-214
- **问题**: fetch 工具 schema 只描述语义、url 无任何格式校验，输入由 LLM 生成——恶意网页内容进入搜索/情报上下文后可诱导模型请求任意 URL。实际抓取由亿信上游服务执行（本应用仅把 url 作为参数 POST 到固定端点，自身不出网），故不是本应用的 SSRF；影响限于上游侧成本与「内容回灌 prompt」的间接面。
- **证据**: `def billions_fetch(url: str | None = None, doc_id: str | None = None)` → `payload["url"] = url; self._post(_FETCH_PATH, payload, timeout=FETCH_TIMEOUT)`
- **建议**: 工具 schema 注明仅接受 http(s)，可选本地协议校验；系统提示约束模型只抓取检索结果中的链接。
- **spec 对照**: 符合 error-handling.md 工具降级约定；未定义 url 校验
- **数据源**: LLM 生成输入（不可信）；出网方为上游服务

### [INFO] update_env_file 以默认权限写 .env（多用户机器可读）
- **位置**: utils/env_file.py:151-156
- **问题**: 写 .env 未指定文件权限（write_text 默认 mode，umask 022 → 0644），含 API 密钥的 .env 对同机其他用户可读。单用户工作站影响低。
- **证据**: `tmp_path.write_text(new_content, encoding="utf-8"); os.replace(tmp_path, env_path)`
- **建议**: 写后 chmod 0600 或 open(mode=0o600)。
- **spec 对照**: 符合 architecture.md「.env 原子写」契约（原子性），权限未约定
- **数据源**: 内部（本地文件系统）

### [INFO] dev 工具：probe.mts 未校验 CLI ticker；export_fixtures.py 硬编码绝对路径
- **位置**: ts/tools/probe.mts:30；ts/tools/export_fixtures.py:24-29,62-63
- **问题**: ① probe.mts 的 `process.argv[2] ?? '600036'` 直接进 TCP 采集链（无 6 位校验，非 6 位输入进 f10MarketFor/addPrefix 等，行为未定义）；② export_fixtures.py 硬编码 `REPO = "/home/tan/StockOperatorAgent"` 且读取 `/tmp/f10_text.txt`（换机器/无该文件即失败）。均为 dev-only 工具，无生产影响。
- **证据**: `const ticker = process.argv[2] ?? '600036';`；`REPO = "/home/tan/StockOperatorAgent"`
- **建议**: probe 加 6 位数字校验；export_fixtures 改相对仓库根路径并去除 /tmp 依赖。
- **spec 对照**: N/A
- **数据源**: 内部（dev-only）

### [INFO] vendor 快照 sys.path.insert(0) 导入机制（受信快照，风险面为仓库可写）
- **位置**: data_source/chinese_mainland/tdx/tdx_source.py:25-31；vendor/scripts/data_pipeline/fetch_realtime_watchlist.py:9-12、run_data_job.py:8-11；vendor/scripts/tdx_mcp/*.py:25 等
- **问题**: 多处 `sys.path.insert(0, ...)` 把仓库目录置于 site-packages 之前导入 `scripts.*`（vendor 快照）。快照固定 commit（VENDOR.md `b95d8e915aa2fa4b703e64c38ca48eb51a6fa96e`），属受信内部代码——按信任边界规则（guides/index.md），内部快照 ≠ 外部不可信输入，不报「缺校验」。风险仅在仓库目录可被非受信方写入的场景（等价于「克隆代码即可执行」的 Python 标准信任模型），无外部输入经此面进入。
- **证据**: `if str(VENDOR_ROOT) not in sys.path: sys.path.insert(0, str(VENDOR_ROOT))`
- **建议**: 维持快照固定；可选加 vendor 完整性校验（如对关键文件 hash 校验）。
- **spec 对照**: VENDOR.md 文档化行为，符合
- **数据源**: 内部受信（固定 commit 快照）

### [INFO] ZODB pickle 面评估：无外部输入到达反序列化
- **位置**: data_storage/chinese_mainland/ZODBStorage.py:17-25；utils/constants.py:18
- **问题**: 评估结论——ZODB 数据文件路径是仓库锚定常量（`china_stock_data.fs`），仅装载应用自身持久化类（ChinaStock / persistent.list.PersistentList / BTrees.OOBTree），全部写入经 6 位校验的 ticker 路径；远程/网络/UI 输入永不进入 pickle.loads。本地数据库文件被替换即本机已被攻破（超出威胁模型）。无发现。
- **证据**: `self.storage = ZODB.FileStorage.FileStorage(utils.constants.china_db_path)`；`china_db_path = str(REPO_ROOT / 'database' / 'china_stock_data.fs')`
- **建议**: 无需改动；未来若引入不受信 pickle 源需重新评估。
- **spec 对照**: 符合 data_storage spec 单例/RLock 约定
- **数据源**: 内部受信

## spec 符合性结论

- **密钥纪律（error-handling.md「密钥值任何路径不 log」）**：全仓符合。Python 侧（env_file/llm_factory/billions client/tdx_mcp）与 TS 侧（settings.ts `describeLlmKeys` 掩码、ts/src/log.ts 上报 payload 不含密钥、logs-server 只落 message）均未发现密钥入日志、入明文 UI 回显或入 git（.env 均被 gitignore；.env.example 全占位符）。
- **ticker 输入校验**：双端符合。display.py `isdigit() + len==6 + BJ 拦截`；App.tsx `/^\d{6}$/ + BJ 拦截`；/tdx-collect `/^\d{6}$/`。
- **危险 sink 全仓扫描**：无 subprocess/os.system/shell=True/Popen、无 eval/exec/pickle.loads（grep 全仓验证）；SQLite 全部参数化语句；路径构造均锚定 REPO_ROOT。
- **偏离/缺口清单**：TS 同源代理层（ts/index.md「同源代理」）缺鉴权与上游地址校验契约（F1/F2/F6）；密钥存放面（EXPO_PUBLIC 进 bundle、localStorage 明文）为 spec 未覆盖（F3/F4）；window.__soa 调试钩子无生产守卫（F5）；依赖供应链策略宽松（F7）。
- **SSE 端点鉴权**：N/A——本仓库无对外 SSE 服务端点（vendor tdx_mcp 客户端仅解析上游 SSE 响应）；Streamlit 默认绑定 localhost、无鉴权为框架默认行为（.streamlit/config.toml 仅含主题配置，未改动 server 绑定）。

