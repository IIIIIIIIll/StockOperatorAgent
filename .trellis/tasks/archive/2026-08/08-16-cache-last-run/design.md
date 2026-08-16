# 设计:上次分析结果缓存与启动恢复

## 边界与架构

新增 `src/lastRun.ts`(纯函数,依赖 `StoreLike` + `FinalReport`,不依赖 UI/平台)——可单测,四平台复用。App 层(`app/App.tsx`)只做接线:done 事件 → 写缓存;启动 → 读缓存 → 播种 React state。

```
FinalReport(done 事件)
   │ saveLastRun(store, report, mode, at)         src/lastRun.ts
   ▼
store meta 'soa:last-run' = JSON.stringify({ticker, stock_information,
  final_decision, opinions[{key,tabTitle,content}], at, mode})
   │ loadLastRun(store)                            App 启动链
   ▼
setLastRunTicker / setStockInformation / setFinalDecision
setEvents(opinions → report 事件) / setStatuses(命中角色置 done) / setLastRunAt
```

## 数据契约

```ts
// src/lastRun.ts
const LAST_RUN_KEY = 'soa:last-run';
export interface LastRunRecord {
  ticker: string;
  stock_information: string;
  final_decision: string;
  opinions: Opinion[];            // 复用 events.ts 的 Opinion 类型
  at: string;                     // ISO 完成时间
  mode: 'real' | 'demo';
}
export function saveLastRun(store: StoreLike, report: FinalReport, mode: 'real' | 'demo', at: string): void;
export function loadLastRun(store: StoreLike): LastRunRecord | null;  // 缺失/损坏 → null,不抛
```

- 键名 `soa:last-run` 对齐现有 `soa:llm-config` 前缀惯例。
- 序列化仅 JSON.stringify/parse;无 schema 版本字段(MVP;破坏性变更时换键即可)。
- `loadLastRun` 校验:解析失败、`ticker`/`stock_information`/`final_decision`/`opinions`(数组)缺失 → null。
- meta 是 TEXT 列,报告文本量级(几十 KB)无压力。

## App 接线(App.tsx)

### 写(done 事件,现有 subscribe effect 内)

```ts
else if (e.type === 'done') {
  const report = (e as Extract<PipelineEvent, { type: 'done' }>).report as FinalReport;
  ...
  saveLastRun(store, report, modeRef.current, new Date().toISOString());
  setLastRunAt(new Date().toISOString());
}
```

- `modeRef = React.useRef<'real'|'demo'>('demo')`,在 `start()` 计算 mode 处同步赋值(现有效果闭包持初始 settings,直接读 `settings` 会陈旧;ref 绕过闭包问题)。
- 仅在 `done` 写;`error` 路径不写 → 旧缓存保留(R4)。

### 读(启动 effect,`await storeReady()` 之后)

```ts
const last = loadLastRun(store);
if (last) {
  setLastRunTicker(last.ticker);
  setStockInformation(last.stock_information);
  setFinalDecision(last.final_decision);
  setEvents(last.opinions.map((o) => ({ type: 'report', key: o.key, tabTitle: o.tabTitle, content: o.content })));
  const st: Record<string, RoleStatus> = {};
  for (const o of last.opinions) {
    const r = enabledRoles().find((x) => x.stateKey === o.key);
    if (!r) continue;
    if (r.reviseNodeName) st[r.reviseNodeName] = 'done';
    st[r.nodeName] = 'done';
  }
  setStatuses(st);
  setLastRunAt(last.at);
} else {
  // 现状:demo setStockInformation(...)
}
```

- `loadDemoData()` 保持无条件调用(内部空库守卫;新装机仍有 demo 日K 可预览)。
- 恢复的 `report` 事件直接喂 `activeReports` 过滤,报告 Tab 渲染零改动;`progress` 事件不播种 → 进度区不出现假"完成(N 步)"。
- 状态 chips:`reviseNodeName` 存在时取修订节点(与现渲染逻辑一致 `App.tsx:323-324`);缓存未覆盖的启用角色保持"待运行"。

### 标记 UI(R3)

- 新增 `const [lastRunAt, setLastRunAt] = React.useState<string | null>(null)`,`start()` 时清 null。
- 表单下方与 gateNotice 同区域渲染:有 `lastRunAt` 且非 running 时显示
  `已显示上次分析结果 · <本地化时间> · <真实 LLM|演示模式>`(theme.colors.textSecondary,复用 `.warn` 行布局思路,不加新组件文件)。

## 兼容性

- 无 schema/DB 变更;store meta 面不变。
- 恢复仅影响 App 展示层;Node probe、测试、其他 runner 消费者不受影响。
- 旧安装(无 `soa:last-run` 键)→ `loadLastRun` null → 现状路径。
- 损坏数据(半写入/版本升级)→ null 降级,不阻塞启动(R6)。
- demo 模式运行也会缓存(标记 mode='demo'):无 key 用户至少看到上次自己的操作结果,配置 key 后真实运行覆盖之。这是刻意行为,非缺陷。

## 风险与回滚

- 风险:恢复内容与 store 实际行情数据不一致(缓存股票信息 vs 持久化日K)——可接受,采集数据 Tab 数据源是 store 日K(已跨会话持久化),仅文本块来自缓存;时间标记消除歧义。
- 风险:subscribe effect 闭包 settings 陈旧 → 用 modeRef 规避(见上)。
- 回滚:删除 `src/lastRun.ts` + App.tsx 两处接线(一写一读)+ lastRunAt 状态,即回现状;缓存键是惰性数据,不清理也零影响。
