---
description: 存储契约与持久化(StoreLike 11 方法、四族实现、写穿队列、上次分析缓存、meta 键单源、runner 启动链)
paths:
  - src/store.ts
  - src/store-idb.ts
  - src/store-file.ts
  - src/store-memory.ts
  - src/store-node.ts
  - src/lastRun.ts
  - src/metaKeys.ts
  - app/lib/runner.ts
  - app/lib/settingsStore.ts
---

# 存储与持久化(08-14-ts-persistence)

## StoreLike 同步契约(src/store.ts)

业务层只依赖 `StoreLike` 接口面(**11 个同步方法**):

```ts
export interface StoreLike {
  close(): void;
  getStock(ticker): StockRecord | null;
  putStock(record): void;
  addDatas(ticker, bars): number;                 // 拒绝 date <= lastDataUpdate
  addPerformanceReports(ticker, reports): number; // report_date 去重,单事务
  updateOverview(ticker, overview, stamp): void;
  getDatas(ticker): DailyBar[];                   // 每次返回新数组
  replaceDatas(ticker, bars): number;             // 全量替换(web 采集 IPO 全量语义)
  getPerformanceReports(ticker): PerformanceReport[];
  getMeta(key): string | null;
  setMeta(key, value): void;
}
```

实现侧语义:addDatas 拒旧 + 升序去重、addPerformanceReports 按 report_date
去重、getDatas/getPerformanceReports 返回副本(勿持引用)。**Store 值 import
会把 better-sqlite3 拖进 web/RN bundle**——src/app 消费方必须
`import type { StoreLike }`(architecture 契约 3 强制,测试除外)。

## 四族实现与写穿队列

- `Store`(better-sqlite3,WAL)——Node 唯一实现;`store-idb.ts` IdbStore(web
  生产 IndexedDB)、`store-file.ts` FileStore(RN expo-file-system)、
  `store-memory.ts` InMemoryStore(测试/回退;语义对齐 Store)。
- **写穿队列**:同步改内存 → 串行 Promise 链落盘;mutator 同步方法内不 await。
- **freshness 跨会话生效**:gates.ts `dailyFresh`/`reportsFresh` 读持久化的
  `lastDataUpdate`/最新 `report_date` → 同日跳过日K / 同季跳过 F10 的判定
  跨重启成立(非仅当次会话)。App 启动链 `await storeReady()`(IndexedDB 打开
  + hydrate / 文件读回)后 `loadDemoData()`(仅空库载入 demo,有跨会话持久化
  数据则跳过)。

## 上次分析缓存(08-16-cache-last-run)

`src/lastRun.ts` 纯函数 `saveLastRun`/`loadLastRun`:最近一次成功分析的
`FinalReport`(done 事件完整结果 + ISO 完成时间 + `real|demo` 运行模式)写入
meta 键 `soa:last-run`(JSON 串,对齐 `soa:llm-config` 前缀惯例;**仅 done 写,
error 不写** → 旧缓存保留)。App 启动链 `loadLastRun` 命中 → 播种各报告
Tab/最终决策/采集数据 ticker 与股票信息/角色 chips(经理角色按非空
`final_decision` 置 done——经理报告只进 `final_decision` 字段不在 opinions);
未命中/损坏 JSON → 静默降级 demo 路径。恢复内容带时间+模式标记("已显示上次
分析结果"),防误当实时新分析;四平台共用同一 meta 面。

## 常量/键名单源(08-16-audit-remediation)

meta 键与模板集中在 `src/metaKeys.ts`(`DEMO_F10_KEY`/`f10Key`/`capitalKey`/
`DEMO_TICKER`;LAST_RUN_KEY 仍属 lastRun.ts 单点,不重复导出)。禁止裸字面量
meta 键与 '600036' 硬编码(architecture 契约 5)。

## Node 侧接线

- `src/store-node.ts` —— 唯一 node:fs 豁免(**凡进 metro 图的文件禁 node:fs**,
  静态/动态都禁;适配器经注入传入,architecture 契约 1)。
- `runner.setStore()` 注入点(`export let store` ESM live binding);
  settingsStore node 分支经 `_fs` 注入(nodeSettingsFileSystem)。接线示范
  `tools/desktop-probe.mts`。
- 桌面 store 走**快照镜像 + 写穿串行队列**(`storeInit` 全量快照一次 hydrate,
  11 个同步方法读本地镜像,mutator 按序 invoke `store-op`;
  `FileStore.listStocks()/listMetaKeys()` 具体类方法供快照枚举)——详见
  [desktop-ci.md](./desktop-ci.md)。
- 采集 freshness 门(`gates.ts` dailyFresh/reportsFresh + resolveSkipGates,
  部分 fresh 不整体短路)见 [tdx-data.md](./tdx-data.md)。
