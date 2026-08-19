---
description: TDX 采集链(quoteClient/xdxr/f10Client/adjust/deviceCollect)、qfq 前复权、freshness 门控、F10 模型
paths:
  - src/tdx/quoteClient.ts
  - src/tdx/xdxr.ts
  - src/tdx/f10Client.ts
  - src/tdx/deviceCollect.ts
  - src/adjust.ts
  - src/collector.ts
  - src/webCollect.ts
  - src/gates.ts
  - src/f10.ts
  - app/lib/collectorSelection.ts
  - app/lib/deviceBridge.ts
---

# TDX 数据采集、前复权与门控

## qfq 前复权(src/tdx/quoteClient.ts + src/adjust.ts)

`collectAll` 内 `fetchXdxrEvents` → `applyQfq`(失败降级 raw bars 不阻断)。
日期契约:**store 侧 YYYY-MM-DD**;`qfqAdjust` 输入为 YYYYMMDD,接线层双向
转换(转换先例 test/live.integration.test.ts)。

## xdxr 除权除息(src/tdx/xdxr.ts)

- `parseXdxrResponse(body)` — pytdx GetXdXrInfo data 段解析:count 在 offset
  9(读 UInt16LE),29 字节/行,body <11 → 空。category 1 除权除息
  (fenhong/peigujia/songzhuangu/peigu)、11/12 扩缩股(suogu)、13/14 送权证
  (fenshu/xingquanjia);`XDXR_CATEGORY_NAMES` 14 类中文名映射
  (1 除权除息/11 扩缩股/13 送认购权证/14 送认沽权证…)。
- `getXdxrInfo(client, market, code)` — 继承 TdxClient,用公开 sendCommand 发
  Gbbq 命令;`toXdxrEventLike(r)` → qfqAdjust 输入事件(tradeDate YYYYMMDD)。

## F10 公司资料(src/tdx/f10Client.ts)

- node-tdx-market 内置 `CommandType.CompanyCategory`(719)/`CompanyContent`
  (720);协议布局见 research/m0-d4-f10.md。
- `f10MarketFor(ticker)` = `inferExchange`(SZ=0/SH=1)——探针早期硬编码 1(沪)
  只对 6xxxxx 正确,深市 002027/300xxx 需 0。
- 响应解析:`parseCategoryResponse`(152 字节/行:name 64 + filename 80 +
  start/length 各 4,GBK 截断于首个 0 字节)、`parseContentResponse`
  (length@10);GBK 一律 iconv-lite 解码(**禁 TextDecoder**——Hermes 不支持
  gbk,见 [rn-runtime.md](./rn-runtime.md))。
- F10 记录模型在 `src/f10.ts`(F10Record);消费方:overview 22 列、财务趋势、
  业绩卡片。设备端采集 `src/tdx/deviceCollect.ts`(真机 TCP,经 deviceBridge
  注入;DEVICE_TDX_HOSTS 走 EXPO_PUBLIC_* 直读白名单)。

## 采集抽象与平台边界(08-16-audit-remediation)

- `MarketCollector` 可调用契约 `(ticker, opts?) => Promise<WebCollectResult>`
  (src/collector.ts);真机模块经 `app/lib/deviceBridge.ts` 桥(静态 re-export
  src/tdx/deviceCollect),平台选择在 `app/lib/collectorSelection.ts`
  (**src 不反向依赖 app**)。
- **metro 动态 import 边界(实证)**:metro 把跨项目根(app/)的相对动态 import
  specifier 运行时重写为根相对路径 → Android 解析失败;动态 import 目标必须
  位于 metro 项目根内。web bundle 只含惰性 chunk 引用,不含 node-tdx-market/
  TCP 链(生产 export grep 实证)。
- web 端经同源代理 `/tdx-collect` 采集(45s 超时锁语义见
  [events-streaming.md](./events-streaming.md))。

## freshness 门控(08-14-phaseout-c C8)

`gates.ts` `dailyFresh`(lastDataUpdate == 北京时间今天 → 同日已采集)与
`reportsFresh`(最新 report_date == 最近已过季度末 → 同季已入库)经
`freshnessGates` 判定,依据 store 现有数据(不新增持久化字段);共享实现
`resolveSkipGates`(web/device 双实现不再逐行重复)。`runner.collectForWeb`
按源传 `skipDaily`/`skipF10` → `/tdx-collect` 查询参数(仅 '1' 生效,缺省不带
参数 = 全量)→ proxies.cjs 按源跳过(仍拉快照/名称/股本结构节)。

- **部分 fresh 不整体短路**;跳过返回现有数据**不置空**(applyCollectedToStore
  保留既有日K/lastDataUpdate,同季跳过 F10 时以缓存 `f10:${ticker}` meta 文本
  顶替,盈利能力块不降级占位);跨日/跨季首次 → 全量路径不变。
- 采集 freshness 依赖持久化 lastDataUpdate/report_date → 跨会话生效(见
  [stores.md](./stores.md))。
