# 设计:任务地图与跨子契约

## 文件归属表(并发契约 —— 子任务只碰自己的区域)

| 文件 | collect-refactor | dead-code-cleanup | probe-unify | constants-single-source | chart-maintainability | ios-safe-area | rn-env-keys |
|---|---|---|---|---|---|---|---|
| app/hooks/useAnalysis.ts | import :36 动态化、采集分支 :235-266、log import :40 直连 | — | — | 启动 effect :122 demo:f10 读 → metaKeys | — | — | — |
| src/tdx/deviceCollect.ts | freshness 门 :60-82 抽共享、TdxClient import 保持 | — | — | — | — | — | TDX_HOST :29 → EXPO_PUBLIC_TDX_HOST |
| src/webCollect.ts | collectForWeb 保持(作为 MarketCollector 实现) | — | — | f10/capital 键 :55,65 → metaKeys | — | — | — |
| app/lib/runner.ts | freshness 门 :73-85 → resolveSkipGates;collectForWeb 包装 | CFG_KEY 三函数 :98-125 删 | store 选择 :30 用 detectPlatform | demo ticker/f10 写 :41,50 → 常量/metaKeys | — | — | — |
| src/log.ts | — | — | detectPlatform 导出复用面 | — | — | — | — |
| src/webSearch.ts | — | — | 探针 :79 复用 detectPlatform | — | — | — | :82 TAVILY 读取 → EXPO_PUBLIC_ 前缀 fallback |
| app/lib/settings.ts | — | log import :7 直连 src/log.ts | — | DEFAULT_CAPS :48 → import billionsTools 单源 | — | — | — |
| app/screens/ReportScreen.tsx | — | 删除 | — | — | — | — | — |
| app/assets/chart-view.html | — | 删或 .gitignore | — | — | — | — | — |
| app/lib/log.ts | — | 删除(先改两个消费方) | — | — | — | — | — |
| app/components/IndicatorChart.tsx | — | — | — | — | tops :217-224 → 公共函数 | — | — |
| app/components/FinancialTrendChart.tsx | — | — | — | — | tops :67-74 → 公共函数 | — | — |
| src/chartLayout.ts(新) | — | — | — | — | pane tops 公共函数 | — | — |
| tools/build-chart-view.mts | — | — | — | — | fallback 注释 + 生成校验配合 | — | — |
| app/package.json | — | — | — | — | chart:build/chart:check script | react-native-safe-area-context 依赖 | — |
| app/App.tsx | — | — | — | :84 placeholder → DEMO_TICKER | — | 安全区 :185 + root | — |
| src/metaKeys.ts(新) | — | — | — | demo:f10/f10:/capital: 常量 + ticker 模板工厂 | — | — | — |
| src/billionsTools.ts | — | — | — | 导出 BILLIONS_DEFAULT_MAX(单源) | — | — | — |
| app/.env.example | — | — | — | — | — | — | EXPO_PUBLIC_TAVILY_API_KEY / TDX_HOST 文档 |

> 规则:同文件不同区域的并发编辑安全(edit 按内容匹配);若两个子任务需改同一行,由先到者完成并 IRC 通知后到者(父任务已尽量按区域划开)。

## 跨子契约(接口面,先定死)

1. **MarketCollector(collect-refactor 定义,他人不依赖)**:
   ```ts
   // src/collector.ts(新)—— 平台无关接口 + 共享 freshness 门
   export interface MarketCollector {
     collect(ticker: string, opts?: CollectSkipOpts): Promise<WebCollectResult>;
   }
   export function resolveSkipGates(store: StoreLike, ticker: string): { skipDaily: boolean; skipF10: boolean; skipped: string[] };
   ```
   collect-refactor 内部将 `collectForWeb`/`collectForDevice` 包装为两个实现;useAnalysis 按平台选实现(动态 import deviceCollect)。
2. **metaKeys(constants-single-source 定义)**:
   ```ts
   // src/metaKeys.ts(新)
   export const LAST_RUN_KEY = 'soa:last-run';       // 已有 lastRun.ts 定义,此处不重复——仅新增以下
   export const DEMO_F10_KEY = 'demo:f10';
   export const f10Key = (ticker: string) => `f10:${ticker}`;
   export const capitalKey = (ticker: string) => `capital:${ticker}`;
   export const DEMO_TICKER = '600036';              // 由 demo.json 派生?demo.json 在 app/data/,src 不可依赖 app——
   ```
   决策:`DEMO_TICKER` 在 `src/metaKeys.ts` 导出 `'600036'`(与 demo.json 的 ticker 一致的约定;demo.json 属 app 侧资源,src 纯函数层不依赖它)。lastRun.ts 改 import LAST_RUN_KEY 从 metaKeys?不——LAST_RUN_KEY 已在 lastRun.ts 单点,metaKeys 不重复导出,避免双定义。
3. **caps 单源**:`billionsTools.ts` 导出 `BILLIONS_DEFAULT_MAX`(已有),`settings.ts` 的 DEFAULT_CAPS 改为 `{ searchMax: BILLIONS_DEFAULT_MAX.SEARCH, twitterMax: ..., fetchMax: ... }`;billionsTools 内部 `?? 3` 兜底改引 BILLIONS_DEFAULT_MAX 常量。
4. **detectPlatform 复用面**:`src/log.ts` 导出 `detectPlatform(): Platform`(已有,公开);runner.ts/webSearch.ts 改为复用(不再自写探针)。注意 webSearch 语义:`window.location?.origin` 非空判定 → `detectPlatform() === 'web'` 等价(web 必带 origin)。
5. **safe-area**:app/package.json 加 `react-native-safe-area-context`(expo 兼容版本,`npx expo install` 决定);App.tsx 用 `useSafeAreaInsets()` 替换 `RNStatusBar.currentHeight`(移除 RNStatusBar import);root 容器 paddingTop 用 `insets.top + theme.spacing.lg`。
6. **env 键位**:webSearch.ts `process.env.EXPO_PUBLIC_TAVILY_API_KEY ?? process.env.TAVILY_API_KEY`(EXPO_PUBLIC 优先,真机可达);deviceCollect.ts `process.env.EXPO_PUBLIC_TDX_HOST ?? process.env.TDX_HOST ?? '150.158.160.2'`。`.env.example` 补注释说明。

## 验证矩阵(父任务统一执行)

| 门 | 覆盖 | 方法 |
|---|---|---|
| 根 vitest | 全量回归 + 新增(collector/resolveSkipGates/metaKeys/chartLayout 单测) | `npx vitest run` |
| app tsc / 根 tsc | 类型面 | `cd app && npx tsc --noEmit`;根 `npx tsc --noEmit`(基线 3 错误) |
| web bundle 去死链(P1 实证) | node-tdx-market 不进 web bundle | metro bundle 输出 grep `node-tdx-market` / 生产 `npm run web` 产物检查 |
| web 冒烟 | demo/恢复/拦截 | 浏览器驱动(同 08-16 流程) |
| 模拟器 | 新依赖重编 + 恢复 + 真实分析 | gradle 重编 + adb;一次真实分析(collect-refactor 回归门) |

## 风险与回滚

- collect-refactor 是唯一高风险(改 web/RN 双平台加载路径 + 采集入口):动态 import 失败路径必须降级明确;回滚 = revert 该子 commit。
- ios-safe-area 引入新依赖:模拟器重编验证兜底;回滚 = revert 子 commit(依赖移除)。
- 死代码删除:全仓 grep 悬空引用检查(AC6)。
- 每子任务独立 commit → 父任务整合;任一步失败不影响其他子任务(并行隔离)。
