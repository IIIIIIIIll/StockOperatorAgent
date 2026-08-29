# PRD: 全功能端到端真实验证(web + 安卓,所有可选功能)

## Background

08-23 e2e-web-android 验证了 demo stub 链路与失败路径;08-24 e2e-real-analysis
验证了**单 ticker(600036,cn 市场)真实 LLM 全链路**,当时多市场(HK/US)、
TDX MCP、亿信五能力、Finnhub、LangSmith 追踪等可选功能未做实证。用户现要求:
**一次完整的端到端全功能实际验证**,chrome(web)与 adb(emulator-5554)均已就绪,
**包括所有可选功能**。

## Goal

在真实运行面(web 生产构建 + chrome 驱动;安卓 debug APK + emulator-5554)上,
以真实 LLM 凭证 + 全部能力开关开启 + 多市场,完成完整分析链路的行为级实证,
逐功能留下证据。验证**不修改产品代码**(发现阻塞性 bug 需修复时另行征得用户同意)。

## Scope:功能矩阵(全开)

| 功能 | 触发面 | 证据通道 |
|------|--------|----------|
| 真实 LLM 分析链(committee/pipeline/retry/toolLoop/streaming) | web+安卓 | `mode==='real'`、/llm-proxy 2xx 往返计数、D15 终态 |
| TDX 行情采集(cn:日K/盘口/F10) | web /tdx-collect 代理;安卓 deviceBridge TCP | 分析上下文/UI 数据、server 日志、logcat |
| TDX MCP 实时情报(tdxMcp 开关+TDX key) | web 浏览器直连;安卓直连 | 情报段内容、console、降级文案记录 |
| 联网搜索(DDG 免 key;web 经 /web-search 代理) | web+安卓 | 搜索段内容、代理日志 |
| 亿信五能力(FINDB/SEARCH/TWITTER/FETCH/ANALYST,BILLIONS key) | web 直连;安卓直连 | 各能力产出段落、调用日志(掩码 key) |
| HK 市场数据链(Yahoo 代理,00700) | web /yahoo-collect;安卓直连 | 港股采集数据、报告单元/货币 |
| US 市场数据链(Yahoo+AAPL;Finnhub 无 key → 降级路径) | web+安卓 | 美股数据、finnhub 降级文案如实记录 |
| 图表渲染(lightweight-charts)/F10/报告 markdown | web+安卓 | 页面截图、报告内容 |
| LangSmith 追踪(可选开关,key/project 在根 .env) | **用户评审门决定跳过** | 报告标注未验证(用户选择) |
| 委员会辩论/多角色观点轮次/增量渲染/进度流 | web+安卓 | 终态 UI、chips、步骤计数 |

## Acceptance Criteria

- **AC-P1 前置门**:`npx vitest run` 全绿(基线 ≥666P/0F,08-29 实证)、
  `npx tsc --noEmit` 0 错误、`npm run chart:build && chart:check` 通过且
  不产生未提交 diff。
- **AC-W1 web 构建托管**:`npx expo export --platform web` 成功,server.mjs
  托管加载,双通道 console 无错误级输出(SPA 重渲染丢 hook 缺口如实记录)。
- **AC-W2 web 注入生效**:注入三键+全部可选键后 reload,**页面不出现「演示
  模式」**;`/llm-proxy` 有 2xx 往返。
- **AC-W3 web cn 全功能**:600036 真实分析完成 D15 终态(「✓ 分析完成(N 步)」
  + 全角色 chips「完成」+ real 模式),TDX 采集/TDX MCP/联网搜索/亿信产出
  有可查证据。
- **AC-W4 web 多市场**:00700(HK)与 AAPL(US)各完成一次真实分析终态,
  Yahoo 数据进入上下文;Finnhub 无 key 降级如实记录。
- **AC-A1 安卓构建安装**:`gradlew assembleDebug` 成功,安装 emulator-5554,
  冷启动无 FATAL EXCEPTION(debug 包走 Metro + `adb reverse tcp:8081`)。
- **AC-A2 安卓注入生效**:`run-as` 写 settings 生效,无「演示模式」。
- **AC-A3 安卓 cn 全功能**:600036 真实分析完成 D15 终态,deviceBridge TDX
  采集生效,logcat ReactNativeJS 无错误级输出。
- **AC-A4 安卓多市场**:AAPL(US)真实分析终态(评审门已批准)。
- **AC-R1 报告**:research/e2e-report.md 按 AC 矩阵给证据路径;密钥全掩码
  (≤8 字符键取前 2 + 省略号);skipped/降级项如实说明。

## Constraints

- **密钥不入库**:任务工件/报告/截图一律掩码(`sk-jGV3…30Lp` 形式);完整值
  仅存在于运行时注入动作。
- **真实 LLM/亿信计费**:运行次数已定——web 3 次(cn/hk/us)+ 安卓 2 次
  (cn/us),总量 5 次全流程(用户评审门确认「全部都覆盖」)。
- 模拟器沿用现成 emulator-5554,不新装 SDK 组件。
- 判据复用 `.trellis/spec/ts/web-e2e.md` D15 配方 + console 双通道 gotcha +
  安卓驱动 gotcha(通知弹窗/uiautomator dump/run-as 引号)。
- 根 `.env` 当前 `TDX_MCP_DISABLED=1`(08-02 旧开关):web/安卓设置注入层
  tdxMcp=true 会覆盖 env 反推,TDX MCP 实际走启用路径——以运行实证为准,
  若 MCP 服务不可达则如实记录降级。

## Out of scope

iOS、release 签名产物、桌面 Electron 壳、性能/视觉回归、设置 UI 自动化
深度测试、LLM 输出质量评估(只验链路真伪与终态)、生产构建的安卓
(debug 包即可)、Finnhub 无 key 时无法实证的增强路径。
