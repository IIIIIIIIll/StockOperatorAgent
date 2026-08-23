# 全仓评审汇总报告 — 2026-08-23

- **HEAD**: e4d8680 · 方法: 两波评审（7 路域审读 → P1/P2 对抗验证）· 只读，未改产品代码。
- **客观基线**: `tsc --noEmit` 零错误；vitest 51 文件 581 测试 = 580 通过 + 1 跳过（较上轮 +69 用例）。敏感文件零跟踪（keystore/.env/二进制），git 跟踪文件密钥扫描干净（48 文件宽扫逐条分诊）。

## 统计

| 严重度 | 数量 | 说明 |
|---|---|---|
| P0 | 0 | — |
| **P1** | **1** | 全部经第二波实证 CONFIRMED |
| **P2** | **7** | 同上 |
| P3 | 33 | polish/清理/文档漂移，未过对抗验证（按设计仅验 major+） |
| FP 拦截 | 1 | 原 P1「Hermes 缺 AbortSignal.timeout」REFUTED |

## 上轮整改核验矩阵（AC1）

36 条逐项核验（详见 `verify-remediation.md`）：**fixed 35 / partially-fixed 1 / not-fixed 0 / regressed 0**。33 个整改 commit 与代码一一对应；重点项 B1（全链 40s abort+锁有界）、B3（字段级合并）、C1（零 rethrow 三方收敛）、C2（同步守卫）、A3–A6、E 系测试缺口全部实证落地。唯一缺口：**D15** —— 控制器侧 hasDone 已交付，但消费侧掉落（见下表）。

## P1/P2 发现（已全部对抗验证）

| ID | 严重度 | 标题 | 锚点 | 复判定 |
|---|---|---|---|---|
| F1 | **P1** | FileStore hydrate 裸 JSON.parse + 非原子整文件写 → 单个坏文件致桌面/真机启动死循环，需手删 userData 才恢复 | src/store-file.ts:107/:115、store-node.ts:25、desktop/main.mjs:157 | CONFIRMED (0.97) |
| F2 | P2 | Electron 无 requestSingleInstanceLock：双开共享 userData，独立内存镜像整文件覆写丢更新并放大 F1 撕裂窗口 | desktop/main.mjs:278-283 | CONFIRMED (0.97) |
| C2 | P2 | FinnhubClient.companyProfile2 裸 fetch 无超时（B1 同款残余，U4 只修了 Yahoo 链）；黑洞连接卡住采集主干至平台兜底 ~300s | src/finnhub/finnhubClient.ts:56-57 | CONFIRMED (0.96) |
| C3 | P2 | obtainA3 模块缓存无失效机制：A3 被吊销后 401 自愈被 provider-first 短路，quoteSummary 永久降级至重启 | src/yahoo/deviceYahooCollect.ts:58-72 | CONFIRMED (0.96) |
| AL2 | P2 | toolLoop 收尾轮不校验仍返回 tool_calls 的响应：空最终结论 pushReport+done 并持久化 lastRun，UI 无错误信号 | src/toolLoop.ts:107-113、agents.ts:163-166 | CONFIRMED (0.95) |
| D15 | P2 | 「✓ 分析完成」不消费 hasDone（App.tsx 仍判 !running && progress>0）：LLM 阶段失败与完成勾选同屏；上轮关闭表与 HEAD 矛盾 | app/App.tsx:269-275 | CONFIRMED (0.95) |
| TQ1 | P2 | us+finnhub 采集绑定链（controller :341-344 + glue 三分派）零正向测试，美股行业富化静默失效无红灯 | test/analysis-controller.test.ts 仅负向 cn 断言 | CONFIRMED |
| TQ2 | P2 | child.mjs STORE_OP_VALIDATORS 安全校验（A5 纵深）零自动化测试，desktop 层无任何 vitest 文件 | desktop/child.mjs:170-217 | CONFIRMED |

## FP 拦截记录（防再 churn）

- ~~C1/AL1【原 P1】billions/mcp 用 AbortSignal.timeout 在 Hermes 恒 TypeError~~ → **REFUTED**：expo@57 winter 运行时 import 图内先于应用代码执行 `installAbortSignalPatch`（node_modules/expo → runtime.native.ts → AbortSignal.ts 补 timeout/any 静态）；abort-controller 实为 3.0.0。web/桌面原生 API 不受影响。净残留降为 P3 文档债（yahooClient.ts:67-69 注释失真）。

## P3 清单（33 条，按域）

- **注释/spec 漂移族（8）**: deviceYahooCollect.ts:9 头注、proxies.cjs:315 注释、tools/probe.mts:152 注释、yahooClient.ts:67-69 注释（均为 U5/U4 整改后失真）；chart-ui.md §UI 编排未随 U13 更新；core/investment-committee.md paths/入口指向已删 Python 实现；settings.ts CORS 注释与实现相反；theme.ts「跟随系统」在原生永不可达（app.json 锁 light）。
- **测试覆盖（TQ3–TQ8, 6）**: server Host gate 零测试；签名脚本校验零测试；live.integration 钉死真实分红数据将腐烂；**全仓无 CI 测试门**（release.yml 不跑 vitest/tsc）；punycode-shim 含完整 RFC3492 零测试；runner 单例 FileStore 在 vitest 下落盘路径不可达，「端到端」实为内存语义。另 zlib-shim 手写 inflate 251 行零测试（AppLibUi 域）。
- **健壮性（4）**: webSearch 直连链无应用层超时（C6）；child 启动窗口期无父死检测可留孤儿（F3）；FileStore.close 无 closed 门闩与 IdbStore 不一致（SC-1，现被调用纪律规避）；controller.start 无守卫 __soa.start 可双采集（C2 变体，仅调试面）。
- **正确性/一致性（5）**: composeYahooOverview.amount 取量字段当成交额且与 snapshot 矛盾（C5，低置信）；US 无效符号报港股文案（C4）；「今天」锚点 UTC/北京双源违背 asiaToday 单源契约（00:00–08:00 错一天）；502 被当「代理不存在」反向指引；本机端点无 Origin 门（Host 门挡不住 drive-by 简单请求，响应不可读但请求驱动成立）。
- **卫生/UX（10）**: configError/proxyUsed 死代码；亿信格式化三函数双实现已漂移；工具结果注入无统一截断/token 预算；设置面板「会话级」文案与持久化相反；≤8 字符密钥日志不掩码；暗色板死支；electron-builder 图标缺失（F7）；android job 无缓存（F4）；第三方 action 未 SHA pin（F5）；__soa 双采集残余。

## Verified-clean 抽检（防再 churn 摘要）

SSRF 双防线（normalizeBaseUrl+isPublicHeader DNS 黑名单）、preload 恰 4 方法+sandbox/contextIsolation、child 六 op 白名单+15s IPC 超时、生命周期 shutdown→flush→SIGKILL 闭环、断言强度全仓优秀（零 snapshot 滥用）、mock 保真度高、B3 变体排查全负、tdx 全部创建点带超时、GBK/iconv 符合 tdx-data 契约。各切片报告含完整清单。

## 建议

1. **修复任务拆分建议**: P1+F2 一组（存储 durability：hydrate 容错 + tmp+rename + 单实例锁）；C2+C3+C6 一组（采集链超时/A3 失效统一接 fetchWithTimeout+invalidateA3Cache）；AL2+D15 一组（收尾轮兜底 + hasDone 消费一行修）；TQ1/TQ2/TQ8 测试补齐；CI 测试门单独小任务（收益/成本比最高）。
2. **spec 更新候选**: chart-ui.md、investment-committee.md 重写 TS 视角；注释漂移族随对应修复一并清理。
