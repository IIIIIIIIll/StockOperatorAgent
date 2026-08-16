# 审计整改:跨平台就绪实施(父任务)

## Goal

执行模块化审计(08-16-modularity-audit)的**全部可执行项**:7 个子任务并行实施,覆盖 web bundle 去死链、采集抽象、死代码清理、平台探针收敛、常量单源、图表维护性、iOS 安全区、RN env 键位。验收 = 审计清单逐项关闭 + 全平台回归验证。

用户价值:审计结论落地 —— web bundle 瘦身、采集层抽象成型、死代码清零、新平台(iOS/桌面)接线点前移,跨平台成本在翻倍前被压掉。

## In Scope(7 子任务,即审计对应项)

| 子任务 | 审计项 | 核心交付 |
|---|---|---|
| collect-refactor | P1 + D1 | deviceCollect 动态 import(web bundle 去 node-tdx-market 死链);MarketCollector 接口 + resolveSkipGates 共享(freshness 门去双实现);useAnalysis 采集分支收敛 |
| dead-code-cleanup | H1-H4 | 删 ReportScreen.tsx(130 行);删 runner CFG_KEY 三函数;删/ignore chart-view.html(200KB);删 app/lib/log.ts shim(消费方直连 src/log.ts) |
| probe-unify | P6 | src/log.ts detectPlatform 成为唯一平台判定;runner store 选择、webSearch 复用 |
| constants-single-source | D3 + 键名/常量 | caps 默认值单源(billionsTools 导出);src/metaKeys.ts 收敛 demo:f10/f10:*/capital:*;DEMO_TICKER 单点('600036' 5 处硬编码) |
| chart-maintainability | D2 + D4 + D5 | pane 顶比例公共纯函数(web 两组件);chart:build/chart:check npm script(生成一致性校验);模板 fallback 注释 |
| ios-safe-area | P4-UI | App.tsx 改用 react-native-safe-area-context(新依赖);Android 行为不变 |
| rn-env-keys | P5 | EXPO_PUBLIC_TAVILY_API_KEY / EXPO_PUBLIC_TDX_HOST 支持(真机可达,默认不启用);.env.example 文档化 |

## Out of Scope(审计"不做/长期"或依赖真实平台方案,本树不含;用户可推翻)

- **桌面 Node 后端(P2/P3)**:store 工厂 + 嵌入式 Node 代理 + settings Node 后端 —— 审计结论"留到真实平台计划确认后",无桌面方案即 speculative 投资(YAGNI)。桌面方案确定时另立任务。
- **applySwitchesToEnv 显式注入**(审计"不做/长期"):Android 实证可用,改动面大收益不紧迫。
- **iOS ATS 例外**:仅 http:// LLM 端点场景;需 https 时文档化即可。
- **iOS 工程 prebuild**(A-§6-1):纯工程前置,本机无 macOS/CI,留到有 iOS 构建环境。
- **WebView 渲染器与 web 分支合并**:架构上不可能(独立 JS 上下文)。

## 验收准则(父级,跨子)

- [ ] AC1 审计清单逐项关闭:7 个子任务全部完成,每项有验证证据。
- [ ] AC2 根 `npx vitest run` 全绿(含新增测试)。
- [ ] AC3 app `npx tsc --noEmit` 全绿;根 tsc 仅剩 3 个既有基线错误(不新增)。
- [ ] AC4 web 冒烟:启动 demo 路径、种子缓存恢复路径、开始分析(非法输入拦截)回归通过;web bundle 不含 node-tdx-market 链(实证:产物 grep 或 metro bundle 输出)。
- [ ] AC5 模拟器:新依赖(safe-area-context)重编 debug APK 安装成功;重启恢复路径通过;**一次真实分析跑通**(collect-refactor 回归门:采集层重构后 TDX 直连链路)。
- [ ] AC6 零行为回归:死代码删除后全仓 grep 无悬空引用;常量收敛后功能等价。
- [ ] AC7 全部改动经 7 子任务 commit + 本父任务整合 commit;git 历史清晰。

## 依赖与并行

- 7 子任务**并行可行**:文件重叠区已在 design.md 归属表划定(同文件不同区域,edit 按内容匹配并发安全)。
- 唯一顺序约束:模拟器验证(AC5)须等 collect-refactor + ios-safe-area 完成(涉及采集与依赖);验证由父任务统一执行,不在子任务内跑。
- 子任务全部 skip 验证/commit(父任务统一验证后统一提交,或子各自提交由父审查——见 implement.md)。
