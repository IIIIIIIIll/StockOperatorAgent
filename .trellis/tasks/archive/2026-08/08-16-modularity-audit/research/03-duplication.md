# 切片 C:重复实现审计(03-duplication)

审计日期:2026-08-16 ｜ 纯静态只读审计(不跑 vitest/tsc/模拟器)｜ 所有发现均有 file:line 锚点 + grep 实证;未实证处标注 [INFERENCE]。审计基准:.trellis/spec/ts/index.md(事件协议/同源代理单份实现/流式契约)。

## 一、发现列表

### Q1 图表三套(chartHtml.ts / IndicatorChart.tsx / build-chart-view.mts)

- [non-problem] 图表三套非三套独立实现,而是「1 活渲染器组件 + 1 生成产物 + 1 模板生成工具」:数据准备/指标计算全部收敛在 src/chartData.ts + src/indicators.ts,唯一编排点是 DataScreen(DataScreen.tsx:62-63 `computeAll(...)` 供图表与 chips 共用同一份结果;IndicatorChart 消费 `changePctHistData`(src/chartData.ts import + IndicatorChart.tsx:171-172)、FinancialTrendChart 消费 `FinancialSeries` 类型与 FINANCIAL_COLORS(chartData.ts:49-53,FinancialTrendChart.tsx:10)。build-chart-view.mts 仅 import node:fs/path/url(工具头部,零 src 依赖)→ 纯模板生成器,不重复任何数据准备/指标计算。 | impact: 跨平台无影响,数据契约单点 | recommendation: 维持现状
- [non-problem] web TS 分支与 WebView 内嵌 JS 渲染器是「镜像语义」而非可消除重复:RN 原生 bundle 不能复用 web 分支的 lightweight-charts TS 调用(WebView 是独立 JS 上下文),必须内嵌自足渲染器;两端经 JSON 数据契约同步(契约文档单点在 tools/build-chart-view.mts:52「渲染器语义(镜像 IndicatorChart / FinancialTrendChart web 分支)」;两端各自带 2026-08-15 同款实测注释互指:IndicatorChart.tsx:214-216、FinancialTrendChart.tsx:65-66、build-chart-view.mts 内嵌 JS)。 | impact: web/Android 已活;iOS=RN WebView 同路径可用;桌面=web 分支可用 | recommendation: 维持现状
- [minor] pane 顶位置比例计算逻辑手写 3 份:IndicatorChart.tsx:217-224、FinancialTrendChart.tsx:67-74、build-chart-view.mts 内嵌 JS(`var sumStretch=0; ... acc += (height*st2)/sumStretch;`)。同公式(sumStretch/acc/tops,setStretchFactor 布局语义)三处复制;HTML 侧因模板内嵌 vanilla JS 无法 import TS,属可接受镜像,但改 stretch 布局语义需 3 处同步。 | impact: 维护成本(已靠注释互指缓解);跨平台无功能影响 | recommendation: 至少把两个 web 组件的 tops 计算抽公共纯函数(如 src/chartLayout.ts),HTML 侧保持镜像注释
- [minor] 生成物与源模板无一致性校验:tools/build-chart-view.mts 不在 package.json scripts(仅 test/typecheck/probe),无 CI/构建期校验 chartHtml.ts 与 .mts 模板是否同步——手改 chartHtml.ts 或忘重跑会静默漂移(文件头「勿手改」仅靠自觉,chartHtml.ts:1)。 | impact: 维护成本,漂移后 iOS/Android 图表异常且难定位 | recommendation: 加 npm script(如 chart:build)+ vitest 快照比对或构建期校验
- [nit] app/assets/chart-view.html 为运行时零引用的已提交产物:全部命中均为注释(FinancialTrendChart.tsx:109、IndicatorChart.tsx:314、DataScreen.tsx:91、chartHtml.ts:2);运行时走 `source={{ html: CHART_HTML }}`(IndicatorChart.tsx:319、FinancialTrendChart.tsx:114)。.gitignore 无 chart-view 条目(grep 无命中)→ 已提交。 | impact: 仓库噪音/陈旧产物 | recommendation: 删除或加入 .gitignore(工具仍生成,供浏览器手动调试)
- [nit] 活路径确认:IndicatorChart(DataScreen.tsx:95)+ FinancialTrendChart(DataScreen.tsx:103)均为活路径;CHART_HTML 单点常量被两组件共享(IndicatorChart.tsx:12、FinancialTrendChart.tsx:11),非各自内联。tools/build-chart-view.mts 无任何运行时引用方 = 纯调试/构建工具。 | impact: 无 | recommendation: 维持

### Q2 报告渲染(ReportContent.tsx vs ReportScreen.tsx)

- [minor,卫生-死代码] ReportScreen.tsx 全仓库零导入(App.tsx 活路径为 ReportContent:App.tsx:9 import、App.tsx:162 使用;grep `ReportScreen` 全仓仅命中自身定义 + .trellis 归档文档)。职责重叠:角色 Tab 条/进度区/观点 expander/最终结论双实现(ReportScreen.tsx:17-123 事件数组驱动 + 本地 activeKey;ReportContent.tsx:39-92 由 App stateKey 驱动 + 流式 partial + MarkdownText + reviseNodeName 修订槽)。差异即代差:ReportContent 支持 08-11 流式输出契约(partials/statuses 参数),ReportScreen 仅消费 events 数组 + 纯 Text,是 st.tabs 语义的早期重复实现。08-13 审计已标 W32、08-14 py-ui 已标 M3,遗留未清。 | impact: 新平台零影响(不打包);维护双实现漂移风险 | recommendation: 删除 app/screens/ReportScreen.tsx(≈130 行),报告渲染只留 App.tsx + ReportContent 单路径

### Q3 常量/配置漂移

- [minor] meta 键命名空间散落裸字面量,仅 3/6 个 const 化:const 化:`soa:last-run`(LAST_RUN_KEY,src/lastRun.ts:8,消费 lastRun.ts:35,40,经 useAnalysis.ts:39-40 import);`soa:llm-config`(CFG_KEY,runner.ts:98,死键见死代码清单 D2);`soa:settings`(KEY,settingsStore.ts:35)。裸字面量:`demo:f10`(写 runner.ts:50,读 useAnalysis.ts:122、DataScreen.tsx:26,3 处);`f10:${ticker}`(写 webCollect.ts:55,读 runner.ts:91、deviceCollect.ts:105、DataScreen.tsx:26,模板 4 处);`capital:${ticker}`(写 webCollect.ts:65,读 DataScreen.tsx:34,2 处)。无 `name:*` / `demo:indicators` 键(grep 无命中;股票名走 putStock;原 hardcode demo.indicators 已移除,实证 DataScreen.tsx:60 注释)。 | impact: 改键名/加前缀需多文件 grep,跨平台无功能影响 | recommendation: 集中到 src/metaKeys.ts 导出常量与 ticker 模板工厂函数
- [minor] demo ticker '600036' 硬编码 5 处 + demo.json 数据源双轨:runner.ts:41 用 demo.ticker(demo.json 单点),但 App.tsx:25(初始 state)、App.tsx:84(placeholder)、useAnalysis.ts:71,94,124、DataScreen.tsx:26(`ticker === '600036'` 特判 demo 回退)均硬编码 '600036'。若换 demo 票,DataScreen.tsx:26 的 demo:f10 回退静默失效。 | impact: 维护成本 | recommendation: 导出 demo ticker 常量(由 demo.json 派生)统一引用
- [minor] caps 默认值三份:settings.ts:48 `DEFAULT_CAPS = { searchMax: 3, twitterMax: 2, fetchMax: 3 }`(camelCase,UI 面板默认)↔ billionsTools.ts:14-18 `BILLIONS_DEFAULT_MAX = { SEARCH: 3, TWITTER: 2, FETCH: 3 }`(SCREAMING,env 默认)↔ billionsTools.ts:172 `?? 3` 第三兜底。接线实证:settings.caps → runner.ts:233 `maxCallsByCap: { SEARCH: caps.searchMax, ... }` → billionsTools.ts:150-152 maxCallsByCap 优先 → env BILLIONS_{CAP}_MAX_CALLS(billionsTools.ts:170)→ 默认(billionsTools.ts:172)。任一默认单边改动 → web(UI caps)与 Node(env/默认)行为漂移。 | impact: 维护成本/行为漂移风险,跨平台无功能影响 | recommendation: 单一常量源(billionsTools 导出,settings.ts import 或反向)
- [non-problem] localStorage 键双键但活键单点:'soa:settings'(settingsStore.ts:35,活,settings.ts:60-86 loadSettings/saveSettings 走 settingsStore)+ 'soa:llm-config'(runner.ts:98,死,见 D2)。两套持久化路径并存但死路径无调用者,不构成运行时双写。 | impact: 无 | recommendation: 删除死键后即单键
- [non-problem] env 名均单点定义/消费:EXPO_PUBLIC_LLM_API_KEY/MODEL/BASE_URL(消费 settings.ts:82-84,文档 .env.example:3-5);EXPO_PUBLIC_LOG_ENDPOINT(log.ts:79);TAVILY_API_KEY(webSearch.ts:82),已删除的 EXPO_PUBLIC_TAVILY_API_KEY 无残留引用(实证 .env.example:7-8 注释);BILLIONS_API_KEY(billionsClient.ts:94);BILLIONS_{CAP}_MAX_CALLS(billionsTools.ts:170);TDX_API_KEY(mcp.ts:240);TDX_HOST(deviceCollect.ts:29);SOA_LOG_DIR/SOA_LOG_FILE(logs-server.cjs:21 / log.ts:107 区域);PORT/HOST(server.mjs:12,78)。TDX_MCP_DISABLED 写 settings.ts:109 读 mcp.ts:199,另有 TDX_MCP_ENABLED 覆盖层(mcp.ts:195,文档化设计「覆盖层优先」,非漂移)。 | impact: 无 | recommendation: 维持
- [non-problem] 文件路径均单点:soa-store(store-file.ts:25 DEFAULT_BASE_DIR)与 store-idb.ts:133 `dbName = 'soa-store'` 同名不同物(目录 vs IndexedDB 库名,不同命名空间,仅命名巧合);meta.json(store-file.ts:24);soa-settings.json(settingsStore.ts:36);soa-logs.log + `.1` 轮转(log.ts:107,123);logs/soa-ts.log(logs-server.cjs:22)。 | impact: 无 | recommendation: 维持('soa-store' 同名可加注释区分)
- [non-problem] 代理端点四路由:实现单份收敛(lib/proxies.cjs + lib/logs-server.cjs,两文件头注释互证「复用同一份…防漂移」;spec ts/index.md 同源代理节背书),路由表双份是必须(metro.config.js:80,84,88,92 与 server.mjs:56,60,64,68 两个进程入口)。客户端消费字面量:settings.ts:169(/llm-proxy)、useAnalysis.ts:224(proxyBase '/llm-proxy')、webCollect.ts:82(/tdx-collect)、webSearch.ts:65(/web-search)、log.ts:77(/logs)——契约字符串散落但均固定端点。 | impact: 无 | recommendation: [nit] 四端点可收敛为 app/lib/endpoints.ts 导出

### Q4 日志(app/lib/log.ts vs src/log.ts)

- [minor] app/lib/log.ts 是纯 re-export 兼容 shim 而非死文件:全文 4 行,`export { log, info, warn, error, debug } from '../../src/log.ts'`(app/lib/log.ts:4-5)。活引用方 2 个:useAnalysis.ts:40(`../lib/log`)、settings.ts:7(`./log.ts`);settingsStore.ts:10 已直连 src/log.ts。历史关系:src/log.ts:2 注释「上移自 app/lib/log.ts(2026-08-11 ts-log-persistence)」,shim 保留动机注释为「既有 import(App.tsx / settings.ts)零改动」(app/lib/log.ts:3)——但 App.tsx 现无任何 log import(grep 实证),注释过期。 | impact: 无(新平台经 src/log.ts 探针自动路由) | recommendation: 仅 2 个引用方,直接改 import 至 src/log.ts 后删 shim(clean cutover);或至少更新注释去掉 App.tsx

### Q5 主题/颜色

- [non-problem] 图表系列色已单点且分层合理:IndicatorChart.tsx:25-32 C 常量 + :39 LEGEND 同文件单点(web 分支与原生 JSON 分支共用同一 C,图例与图上线条防漂移注释 :24);FINANCIAL_COLORS 单点 src/chartData.ts:49-53(FinancialTrendChart 经 series.color 消费,颜色在 chartData 侧由数据层注入)。主题色(theme.ts 涨跌/中性)与系列色(指标区分度)分层,非重复。 | impact: 无 | recommendation: 维持
- [minor] 主题兜底色在 HTML 模板内二次出现:build-chart-view.mts 内嵌模板 4 处 fallback('#6b7280'/'#FFFFFF'/'#e5e7eb' = theme.ts:31,28,32 亮色板 textSecondary/background/border 值,build-chart-view.mts:145,177,181-184;chartHtml.ts:68,100,104-108 同源生成)——防御性兜底(正常数据流 layout 必传不触发),若 theme.ts 亮色板改动此处静默不同步。 | impact: 维护成本(兜底路径) | recommendation: 模板注释标注「与 theme.ts light 对齐」或接受
- [nit] 品牌红 #D32F2F 双处:theme.ts:27(light.primary/up)vs app.json:16(adaptiveIcon backgroundColor)——图标静态底色与主题品牌色漂移(暗色主题 primary #EF5350 而图标恒 #D32F2F)。按钮白字 '#fff'(App.tsx:195、SettingsPanel.tsx:192)为 UI 细节可忽略。 | impact: 无 | recommendation: app.json 值加对齐注释或接受(原生图标跨主题恒一色属常态)

## 二、重复表

| 位置 | 重复内容 | 影响 | 合并建议 |
|---|---|---|---|
| IndicatorChart.tsx:217-224 / FinancialTrendChart.tsx:67-74 / build-chart-view.mts 内嵌 JS | pane 顶比例计算(sumStretch/acc/tops)同公式 3 份 | 改布局语义需 3 处同步 | web 两组件抽公共纯函数;HTML 侧镜像注释 |
| IndicatorChart web 分支 ↔ build-chart-view.mts 渲染器 | 图表渲染语义镜像(addSeries/pane/stretch/pane 标题) | 维护成本(已文档化镜像) | 接受(WebView 架构必然),保持契约注释互指 |
| settings.ts:48 DEFAULT_CAPS ↔ billionsTools.ts:14-18 BILLIONS_DEFAULT_MAX ↔ billionsTools.ts:172 `?? 3` | 亿信三能力默认上限 {3,2,3} 三份、两种命名 | 默认单边改动 → web/Node 行为漂移 | 单一常量源导出 |
| ReportContent.tsx ↔ ReportScreen.tsx | 报告 Tab 条/expander/最终结论/进度区双实现 | 双实现漂移(ReportScreen 已死) | 删除 ReportScreen.tsx |
| runner.ts CFG_KEY 持久化 ↔ settingsStore 'soa:settings' | 两套 LLM 配置持久化路径 | 误导维护(CFG_KEY 路径已死) | 删除死路径(见 D2) |
| theme.ts 亮色板 ↔ build-chart-view.mts 模板 fallback | #6b7280/#FFFFFF/#e5e7eb 兜底色 4 处 | 亮色板改动静默不同步(兜底路径) | 模板注释标注对齐 |
| chartHtml.ts(生成)↔ chart-view.html(生成)↔ build-chart-view.mts(源) | 同一 HTML 三形态 | 忘重跑即漂移 | 加 npm script + 一致性校验 |

## 三、死代码清单(引用方实证)

| 位置 | 内容 | 实证 |
|---|---|---|
| app/screens/ReportScreen.tsx(全文件,≈130 行) | st.tabs 早期重复实现 | grep `ReportScreen` 全仓仅命中自身定义(App.tsx 用 ReportContent:9,162);08-13 W32 / 08-14 py-ui M3 已记录 |
| app/lib/runner.ts:98-125 | CFG_KEY('soa:llm-config')+ readSavedConfig/saveConfig/clearConfig | grep `readSavedConfig|saveConfig|clearConfig|CFG_KEY` 全仓仅命中定义(零调用);注释自认「web 遗留;RN 真机不用」(runner.ts:96-97);08-13 ts-app-server.md 已标 W |
| app/assets/chart-view.html | 运行时零引用的生成产物 | 全部命中为注释;运行时用 CHART_HTML 内联(IndicatorChart.tsx:319) |
| app/lib/log.ts | 非死文件但注释过期(「App.tsx 零改动」,App.tsx 现无 log import) | grep App.tsx 无 log 命中;活引用仅 useAnalysis.ts:40、settings.ts:7 |

## 四、键名漂移表(键名 → 定义处 → 消费处 → 单点?)

| 键/名 | 定义处 | 消费处 | 单点? |
|---|---|---|---|
| soa:last-run | src/lastRun.ts:8(LAST_RUN_KEY) | lastRun.ts:35,40;useAnalysis.ts:39-40 | ✓ 单点 |
| soa:llm-config | runner.ts:98(CFG_KEY) | 无(死) | ✗ 死键 |
| soa:settings | settingsStore.ts:35(KEY) | settingsStore.ts load/save | ✓ 单点 |
| demo:f10 | runner.ts:50(写,裸字面量) | useAnalysis.ts:122;DataScreen.tsx:26 | ✗ 3 处裸字面量 |
| f10:${ticker} | webCollect.ts:55(写) | runner.ts:91;deviceCollect.ts:105;DataScreen.tsx:26 | ✗ 模板散 4 处 |
| capital:${ticker} | webCollect.ts:65(写) | DataScreen.tsx:34 | ✗ 2 处 |
| name:* / demo:indicators | 不存在 | —(股票名走 putStock;demo.indicators 已移除,DataScreen.tsx:60 注释) | — |
| localStorage 键 | soa:settings(活)/ soa:llm-config(死) | 同上 | 活键单点 |
| soa-store | store-file.ts:25(目录) vs store-idb.ts:133(db 名) | 各自命名空间 | ✓(同名巧合) |
| meta.json / soa-settings.json / soa-logs.log / logs/soa-ts.log | store-file.ts:24 / settingsStore.ts:36 / log.ts:107 / logs-server.cjs:22 | 各自模块 | ✓ 均单点 |
| EXPO_PUBLIC_LLM_* | settings.ts:82-84 + .env.example:3-5 | settings.ts | ✓ 单点 |
| EXPO_PUBLIC_LOG_ENDPOINT | log.ts:79 | log.ts | ✓ 单点 |
| TAVILY_API_KEY | webSearch.ts:82 | webSearch.ts | ✓ 单点(EXPO_PUBLIC_TAVILY 已删) |
| BILLIONS_API_KEY / BILLIONS_{CAP}_MAX_CALLS / BILLIONS_*_DISABLED | billionsClient.ts:94 / billionsTools.ts:170 / settings.ts:110-116 写、billionsTools.ts:163-164 读 | 各自 | ✓ 单点 |
| TDX_MCP_DISABLED(+TDX_MCP_ENABLED 覆盖层) | settings.ts:109 写 / mcp.ts:199 读;mcp.ts:195 | mcp.ts | ✓(覆盖层为文档化设计) |
| /llm-proxy /tdx-collect /web-search /logs | 实现单份 lib/proxies.cjs + lib/logs-server.cjs;路由双入口 metro.config.js:80-94 / server.mjs:56-70;客户端字面量 settings.ts:169、useAnalysis.ts:224、webCollect.ts:82、webSearch.ts:65、log.ts:77 | 各进程 | ✓ 实现单份(路由双份为进程必须) |

## 五、结论(三分类)

**真问题(挡跨平台):无。** 图表三套实为 1 渲染组件 + 1 生成常量 + 1 模板工具,数据契约/指标计算单点(src/chartData.ts + src/indicators.ts + DataScreen 编排);报告双实现中活路径唯一(ReportContent);日志、设置持久化、代理、路径、env 均单点化或文档化覆盖层;iOS(WebView 原生分支)与桌面(web 分支)均有现成路径,无必然崩溃/打包失败点。

**卫生问题(死代码/残留):** ① ReportScreen.tsx(死,≈130 行,零 import);② runner.ts:98-125 CFG_KEY 三函数 + 'soa:llm-config' 死键(零调用);③ app/assets/chart-view.html(运行时零引用产物);④ app/lib/log.ts 注释过期(App.tsx 引用已消失,仅 2 个活引用方,可直连 src/log.ts 后删 shim);⑤ build-chart-view.mts 无 npm script/无生成物一致性校验(漂移风险);⑥ meta 键裸字面量散落(demo:f10/f10:*/capital:*)与 '600036' 硬编码 5 处。

**非问题(当前设计合理):** Web 分支与 WebView 渲染器语义镜像(WebView 架构必然,JSON 契约单点文档化);代理双进程入口共享单份实现(proxies.cjs/logs-server.cjs);TDX_MCP_ENABLED 覆盖层;主题色与图表系列色分层(各自单点);caps 三份默认之外的 env/持久化/路径键均单点;'soa-store' 同名不同物。
