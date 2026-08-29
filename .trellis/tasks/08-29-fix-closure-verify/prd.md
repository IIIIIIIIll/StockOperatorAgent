# PRD: 修复闭环验证(web cn 全流程 + 安卓回归)

## Goal

f958a7b 三个修复(F1 亿信 fetch 绑定 / F2 /tdx-mcp 代理 / F5 /billions-proxy)
已完成 curl 级端到端实证,但**分析内完整链路**未验证(上次 AAPL 重跑是 us 市场
不触发 MCP,且亿信代理客户端当时未进 dist)。本任务:
- **web cn 600036 全流程**:三个修复在真实分析中的表现(情报段真实 MCP 数据、
  亿信素材进报告、无降级异常)。
- **安卓快速回归**:代码变更(src/billionsClient/mcp/runner)被安卓 bundle 消费,
  重建 debug APK + cn 全流程确认零回归(proxy 分支仅 web 启用,预期无影响)。

## Acceptance Criteria

- **AC-W1** web cn 600036 全流程完成 D15 终态(✓ 分析完成 + 全角色 + 真实 LLM)。
- **AC-W2** 浏览器 resource timing 出现 `/tdx-mcp` 请求且 2xx(MCP 情报经代理)。
- **AC-W3** 情报段上下文不再是「(通达信 MCP 查询异常…)」——含真实 MCP 行情
  内容或如实记录新形态。
- **AC-W4** 浏览器 resource timing 出现 `/billions-proxy` 请求且 2xx(亿信经
  代理);信息面检索失败日志不再出现(或仅上游 502 形态)。
- **AC-A1** 安卓重建 assembleDebug 成功、安装、无 FATAL。
- **AC-A2** 安卓 cn 600036 全流程 D15 终态;logcat 无错误级输出;亿信无
  Illegal invocation(安卓直连正常,回归确认)。

## Constraints

- 2 次 LLM 全流程运行(web cn + 安卓 cn);密钥掩码,仅运行时注入。
- 复用 .trellis/spec/ts/web-e2e.md 配方(注入/D15/双通道/安卓 gotcha)。
- 发现产品 bug → 记录并另开修复任务(本任务不修码)。

## Out of scope

hk/us 重跑、finnhub 再验证(已实证)、版本 bump/release、S4 keystore。
