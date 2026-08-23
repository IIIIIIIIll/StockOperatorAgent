# PRD: Web & Android E2E Verification (2026-08-23)

## Background

08-23 整改（commit 117e8a9..85a5534）的验证止于 Node 层测试 + 源码级平台取证；桌面端做过真实双开。用户要求补 web 与安卓两端到端确认。

## Goal

在真实运行面上验证本轮修复行为与基础流程可用性。

## Acceptance Criteria

- **AC-W1** web 构建成功，server.mjs 托管下应用加载无 console error。
- **AC-W2** 无 key 时 demo 链路可完成一次分析：progress 推进 → done → 显示「✓ 分析完成」（D15 成功路径）。
- **AC-W3** 配置无效 key 触发失败：显示错误横幅且**不**出现「✓ 分析完成」（D15 失败路径——本轮核心修复的行为级确认）。
- **AC-W4** 市场切换/设置面板/数据页基础渲染正常；store 写读路径无异常（web 为 store-idb）。
- **AC-A1** `gradlew assembleDebug` 构建成功（编译面）。
- **AC-A2** APK 安装至 emulator-5554 并启动：无 FATAL EXCEPTION、JS bundle 正常加载、UI 渲染（截图为证）、tab 冒烟无崩溃。

## Constraints / 已知边界

- 模拟器 API level 与 SDK platforms(35/36/37) 以现成环境为准，不新装组件。
- Yahoo/Finnhub/LLM 真实外网链路不作为通过条件（网络出口不可控）；demo 链路与 UI 行为为准。
- 安卓侧仅冒烟级：启动/渲染/tab 切换/无崩溃；不做深度业务断言（无测试钩子注入通道）。

## Out of scope

iOS、release 签名产物、性能与视觉回归、真实数据源全链路。
