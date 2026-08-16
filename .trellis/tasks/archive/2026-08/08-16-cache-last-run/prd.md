# 上次分析结果缓存与启动恢复

## Goal

App 每次启动都展示 demo 占位(600036 演示数据 + 无报告/决策),用户上次真实分析的结果丢失在会话外。目标:把最近一次成功分析的结果(最终决策、各角色报告、股票信息、ticker、完成时间、运行模式)持久化到现有 store 的 meta KV,App 启动时自动恢复展示,替代 demo 占位。

用户价值:打开 App 看到的是自己上次分析的内容,而不是模拟数据;无需重新分析即可回顾/截图/决策。

## Confirmed Facts(代码证据)

- `FinalReport`(`src/events.ts:30`)含 `ticker` / `stock_information` / `final_decision` / `opinions[{key, tabTitle, content}]`;`done` 事件携带完整报告(`events.ts:21`)。
- store 四实现(Store/IdbStore/FileStore/InMemory)共用 `StoreLike` 同步契约,均有 `getMeta`/`setMeta` string KV(`src/store.ts`、`src/store-idb.ts`、`src/store-memory.ts`),跨会话持久化(web=IndexedDB、RN=文件、Node=SQLite)。
- meta 已有键前缀惯例:`demo:f10`、`f10:${ticker}`、`capital:${ticker}`、`soa:llm-config`。
- App 启动链(`app/App.tsx:63-113`):`await storeReady()` → `loadDemoData()`(仅空库)→ demo `setStockInformation` → `loadSettings()`,无任何上次运行恢复逻辑。
- 报告 Tab 渲染依赖 `events` 数组中的 `report` 事件(`App.tsx:242` `activeReports` 过滤)+ `finalDecision` 状态;DataScreen 依赖 `stockInformation` + `lastRunTicker` 状态。
- 测试命令:`npx vitest run`(根 package.json `test`)+ `npx tsc --noEmit`(typecheck)。

## Requirements

- R1 最近一次**成功**分析(`done` 事件)结束后,将完整结果写入 store meta 缓存,含 ticker、stock_information、final_decision、opinions(每角色 key/tabTitle/content)、完成时间(ISO)、运行模式(`real`|`demo`)。
- R2 App 启动、store 就绪后:若有缓存 → 恢复展示(各报告 Tab 内容、最终决策、采集数据 Tab 的股票信息、ticker、角色状态 chips 置"完成"),不再展示 demo 占位股票信息;无缓存 → 维持现状(demo 占位)。
- R3 恢复内容必须有可辨识的时间/模式标记,让用户知道这是上次缓存结果而非实时新分析(如"已显示上次分析结果 · 2026-08-16 14:23 · 真实 LLM")。
- R4 新分析开始(`start()`)清除当前展示;分析成功后缓存被新结果覆盖;分析失败不触碰缓存(旧缓存保留)。
- R5 缓存读写走现有 `StoreLike` meta,不新增存储后端/表/字段;四平台(web/RN/Node/内存)行为一致。
- R6 缓存损坏(JSON 解析失败/字段缺失)时静默降级为无缓存,不阻塞启动。

## Acceptance Criteria

- [ ] AC1 成功分析后,`store.getMeta('soa:last-run')` 返回可 JSON.parse 的记录,字段含 ticker/stock_information/final_decision/opinions/at/mode。
- [ ] AC2 存在缓存时启动 App:各角色报告 Tab 显示上次内容、最终决策区显示上次决策、采集数据 Tab 显示上次股票信息与 ticker;无缓存时行为与现状一致(demo)。
- [ ] AC3 恢复的 UI 上有时间+模式标记(R3)。
- [ ] AC4 新分析成功后缓存更新为最新;失败时缓存保持旧值。
- [ ] AC5 手动写入损坏 JSON 到 `soa:last-run` 后启动:App 正常启动,回退 demo 路径,无崩溃。
- [ ] AC6 新模块单测通过 + 全量 `npx vitest run` + `npx tsc --noEmit` 通过。
- [ ] AC7 浏览器冒烟:web 启动 → 无 key 演示分析 → 刷新页面 → 恢复上次分析内容(演示模式标记),且采集数据 Tab 显示上次 ticker。

## Out of Scope

- 多 ticker 历史缓存/浏览列表(仅缓存最近一次运行;用户明确说"上一次运行的结果")。
- 缓存过期策略/自动刷新(无过期;用户随时可点"开始分析"刷新)。
- 缓存命中时自动跳过采集/分析(不改变运行语义,仅展示层恢复)。
- 后端 Node probe 等其他 runner 消费者的缓存 UI(缓存写与读均在 App 层;Node 不消费该 meta 键)。

## Open Questions

无(需求与代码证据已收敛;见设计文档与最终规划摘要)。
