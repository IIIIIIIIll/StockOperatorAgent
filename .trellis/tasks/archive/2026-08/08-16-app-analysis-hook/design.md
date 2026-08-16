# 设计:App.tsx 抽取 useAnalysis hook

## 边界

新文件 `app/hooks/useAnalysis.ts`(新增 `hooks/` 目录;lib/ 是桥接/基础设施,分析编排是 UI 逻辑,独立目录语义更清晰)。

```
App.tsx(渲染 + UI 状态 + 派生)          useAnalysis(状态 + 启动链 + 订阅 + start)
  activeTab/showSettings/ticker   →       events/finalDecision/stockInformation/running/
  error/partials/statuses/dataVersion/lastRunTicker/lastRunAt/settings
  __soa 钩子 / 派生 / makeStyles           start(ticker) / onSettingsChange
```

## Hook 契约

```ts
// app/hooks/useAnalysis.ts
export interface UseAnalysis {
  events: PipelineEvent[];
  finalDecision: string;
  stockInformation: string;
  running: boolean;
  error: string | null;
  partials: Record<string, string>;
  statuses: Record<string, RoleStatus>;
  dataVersion: number;
  lastRunTicker: string;
  lastRunAt: { at: string; mode: 'real' | 'demo' } | null;
  settings: SettingsState;
  start: (ticker: string) => Promise<void>;
  onSettingsChange: (next: SettingsState) => void;
}
export function useAnalysis(): UseAnalysis { … }
```

内部结构(自 App.tsx 原样搬移,仅机械调整):

1. **状态**:原 11 个 useState/useRef 原样搬入,初始值不变(含 `useState(() => loadSettings())` 惰性初始化)。
2. **启动 effect**(原 `App.tsx:78-131` 附近):`storeReady()` → `setDeviceStore` → `loadDemoData()` → 缓存恢复/`loadLastRun` 分支(含经理 `final_decision` chips 修复)→ `loadSettings()` → `missingLlmKeys` 提示 → `setDataVersion(1)`。空依赖数组不变。
3. **订阅 effect**(原 done 分支含 `saveLastRun`/`setLastRunAt`):空依赖数组;闭包内 `modeRef`(ref 稳定)+ `enabledRoles()`(模块级新鲜)不引入陈旧问题。
4. **`start(ticker: string)`**:唯一签名变化——`ticker` 由 state 改为参数;`settings` 读 hook 内 state 不变;其余(校验/BJ 拦截/applySwitches/keepalive/采集 web|device/亿信 mcp 预查/双算/`runner.run`/finally)逐行搬移,`modeRef.current` 同步逻辑保留。
5. **`onSettingsChange`**:`setSettings + saveSettings + applySwitchesToEnv + setError(null)` 原样搬移。

## App.tsx 保留面

- UI 状态:`activeTab`/`showSettings`/`ticker` + `useWindowDimensions`/`wide` + 窄屏自动收侧栏 effect。
- 派生:`missing`/`gateNotice`(读 hook 返回的 settings)/`tabs`/`activeRole`/`activeReports`(events + activeTab 过滤)/`progress`。
- `__soa` 钩子 effect:`start: () => void start(ticker)`、`switchTab`、`getState`(读 hook 返回的 finalDecision/events/running/partials/statuses)——钩子 effect 无依赖数组(每次渲染刷新闭包),行为不变。
- 渲染与 `makeStyles` 原样。

## 关键风险与对策

- **订阅闭包陈旧**:现状空依赖数组能成立的前提是闭包只碰稳定引用(`modeRef`)+ 模块级函数;搬入 hook 后同一前提成立,不新增依赖。`start` 经 `__soa` 每次渲染刷新,不陈旧。
- **启动 effect 幂等**:空依赖数组仅挂载跑一次,搬移不变。
- **竞态**:`running` 防重入(按钮 disabled)逻辑原样搬移;`start` 并发调用行为与现状一致(不新增防护,避免行为变化)。
- **行为漂移**:禁止顺手改任何逻辑(双算、错误文案、keepalive 时序);git diff 审查逐行等价。

## 兼容与回滚

- 纯新增文件 + 单文件修改;`src/` 业务层零改动。
- 回滚:`git revert` 本任务 commit,或删除 `app/hooks/useAnalysis.ts` 并还原 App.tsx。
- 无持久化/schema/API 变更;web/RN 共用同一 hook(组件层无平台分支)。
