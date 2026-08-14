# Design：TS 本地数据持久化

## 1. 架构

```
ts/src/store.ts        StoreLike 接口（不变）+ Store（Node SQLite，不动）
ts/src/store-memory.ts InMemoryStore（保留：测试/降级用）
ts/src/store-idb.ts    IdbStore（web，新增）
ts/src/store-file.ts   FileStore（RN，新增，expo-file-system）
ts/app/lib/runner.ts   store 工厂：Platform.OS === 'web' ? IdbStore : FileStore
```

业务层（pipeline/webCollect/DataScreen/events/committee）只依赖 `StoreLike`——后端切换零消费方改动。

## 2. 存储设计

### IdbStore（IndexedDB）

- 4 个 object store：`stocks`(key=ticker)、`daily_bars`(key=[ticker,date])、`performance_reports`(key=[ticker,report_date])、`meta`(key=key)。
- 语义对齐 `InMemoryStore`/`Store`：
  - `addDatas`：读取该 ticker 最新 date → 过滤 `date > last` → 批量 put → 更新 stocks.lastDataUpdate。
  - `replaceDatas`：先删该 ticker 全部 daily_bars 再 addDatas（同 SQLite 语义：空输入早退不清库）。
  - `getDatas`：按 [ticker,date] 索引 range 查询 → 返回新数组（防外部改）。
  - `addPerformanceReports`：按 report_date 去重（读到已知 set 过滤）。
  - 原子性：单事务（IDB transaction 覆盖多 put + stocks 更新）。
- 打开：`openDB(name, version)` Promise；`store` 工厂返回「就绪后可用」的对象——初始化时序见 §3。

### FileStore（RN，expo-file-system）

- 目录 `documentDirectory/soa-store/`，按 ticker 分文件：`<ticker>.json`（stocks+bars+reports 合并）或分类文件——设计决策：**按 ticker 单文件**（`{stock, bars, reports}`）+ `meta.json`。理由：RN 文件系统读整文件快、无事务 API；单 ticker 文件粒度使写入原子化（writeAsStringAsync 替换整文件）。
- 语义同上（增量去重、全量替换、返回副本）。
- 写入时机：每次 mutator 后全量重写该 ticker 文件（数据量 ≤ 数万 bars/股，JSON 序列化可接受；加防抖可选——先不做，保持简单）。
- 内存缓存：文件后端内存 Map 与 InMemoryStore 同构，加载时从文件 hydrate，mutator 双写（内存 + 文件）→ 读路径零 IO。

## 3. 初始化时序（App 启动链）

现状：`App.tsx:68-86` useEffect 并行 loadDemoData/loadSettings → setDataVersion。改造：

1. `store` 工厂返回 `StoreLike & { ready(): Promise<void> }`（或 App 显式 `await store.ready()`）。
2. App useEffect 先 `await store.ready()` 再 loadDemoData/loadSettings。
3. `loadDemoData` 仅当空库（无 stocks 且无 bars）时载入 demo；有持久数据则跳过。

## 4. 兼容性

- `StoreLike` 接口零改动；`InMemoryStore` 保留（probe 测试/降级路径仍用 Store SQLite）。
- RN 无 expo-sqlite 新增依赖（用 expo-file-system 现有依赖）。
- 浏览器 Web Worker/IDB 兼容：IndexedDB 所有现代浏览器支持。

## 5. 测试

- **IdbStore**：`fake-indexeddb`（devDependency，vitest node 环境）——单测覆盖 addDatas 去重/replaceDatas 空输入/getDatas 新数组/meta/事务。
- **FileStore**：临时目录（`fs.mkdtemp` + mock expo-file-system 或真实文件路径抽象——设计：FileStore 构造接受 baseDir 注入，测试传 os.tmpdir 子目录）。
- **接线**：`runner.test` 或现有 store-gates 扩展——web 平台选择 IdbStore。
- 浏览器实测（验收）：采集 → 刷新 → 数据保留 + 同日跳过。

## 6. 风险

- RN 端无法在本环境实测（无模拟器）——FileStore 以单测 + 类型检查覆盖，注明待真机验证。
- IDB 事务异步：mutator 变 async（StoreLike 方法签名当前是同步）→ **契约冲突**：StoreLike 同步签名，IDB 天然异步。设计决策见 §7。

## 7. 关键决策：StoreLike 同步 vs 异步（必读）

`StoreLike` 全部方法为**同步**（store.ts:41-64）；IndexedDB 是异步 API。选项：

- **A. StoreLike 改为 async**：全业务层（pipeline/webCollect/DataScreen/events/committee）await——改动面大（~20 消费点 + 测试），且 RN FileStore 内存缓存可同步读，纯同步后端被拖累。
- **B. IdbStore 内部同步化（blocking）**：不可行——IDB 无同步 API。
- **C. IdbStore 维护内存镜像 + 后台持久化**：同步读内存、mutator 同步更新内存 + fire-and-forget 写 IDB（队列串行化保证顺序）。读取 100% 同步；写异步落盘（崩溃丢最近写入，可接受——采集后立即 replaceDatas，重启前已落盘）。**推荐 C**——StoreLike 零改动、业务层零改动、语义对齐（读路径与 InMemoryStore 一致；写路径最终一致）。
- **D. web 用 OPFS/FileSystemSyncAccessHandle**：同步 API 但兼容性/复杂度高，不选。

**决策：C**。IdbStore = InMemoryStore 语义 + 写穿透队列（Promise 链串行 put；ready() await 初始 hydrate 完成）。

## 8. 实现分片（1 个实现子代理 + 验证）

| 分片 | 内容 |
|---|---|
| impl | store-idb.ts + store-file.ts + runner.ts 接线 + App 初始化链 + 测试 |
| verify | vitest + tsc + 浏览器实测（刷新持久化 + freshness 跨会话） |
