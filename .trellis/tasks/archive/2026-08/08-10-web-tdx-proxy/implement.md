# Web 版 TDX 采集修复 — 实施计划

## 步骤 1 — F10 市场码修正(src/tdx/f10Client.ts)

- 加 `export function f10MarketFor(ticker: string): number`:`inferExchange`
  SZ=0/SH=1 直接返回(import 自 node-tdx-market)。
- `getCompanyInfoCategory/Content` 调用方(探针/proxy)改用该函数。

## 步骤 2 — 共享接线层(src/webCollect.ts,新文件)

- `CollectedPayload { ticker, name, bars, snapshot, f10Text }`、
  `WebCollectResult { f10Text, snapshot, name }`。
- `applyCollectedToStore(store, payload)`:
  `putStock({ticker, name: name ?? ticker, overview: null, ...})` →
  `addDatas(ticker, bars)` → `setMeta('f10:'+ticker, f10Text)`(非空时)。
- `collectViaProxy(ticker, base)`:fetch `${base}/tdx-collect?ticker=…`;
  不可达/非 ok → 抛带原因 Error。

## 步骤 3 — server 采集端点(ts/app/server.mjs)

- 静态 import `TdxClient`(node-tdx-market)+ `collectAll`(../../src/tdx/
  quoteClient.ts)+ `getCompanyInfoCategory/Content` + `f10MarketFor`
  (../../src/tdx/f10Client.ts)。
- `GET /tdx-collect`:`^\d{6}$` 校验 → 并发互斥(429)→ 45s 超时兜底 →
  连接 → F10 财务分析节 + collectAll(meta 用 no-op)→ finally disconnect →
  JSON 回包;catch → 502 `{error}`。

## 步骤 4 — App 接线

- `ts/app/lib/runner.ts`:加 `export async function collectForWeb(ticker)`
  → `collectViaProxy(ticker, location.origin)` + `applyCollectedToStore`,
  返回 WebCollectResult。
- `ts/app/App.tsx start()`:web 平台先 `await collectForWeb(code)`,失败 →
  `setError` + return;成功 → `runner.run(code, { llm, f10Text, snapshot,
  name, today })`(替换全局 demo:f10)。
- `ts/app/package.json`:`web`/`serve` 脚本加 `--experimental-strip-types`。

## 步骤 5 — 测试(test/webCollect.test.ts)

- `applyCollectedToStore`:InMemoryStore + 假 payload → bars/name/f10 meta/
  返回值断言。
- `collectViaProxy`:mock fetch ok → 解析;mock 5xx/不可达 → throw 断言。
- `f10MarketFor`:002027 → 0、600036 → 1、300xxx → 0。

## 步骤 6 — 验收

- `npm run web` 起服(curl 002027/600036 两票:bars 非空、f10Text 非空、
  snapshot 非空)。
- 浏览器(无三键 → stub LLM):002027 分析 → 采集数据 Tab 真数据 + 观点
  非空。
- `ts/` tsc + vitest 全绿;`ts/app` typecheck 干净。
- AC1-AC6 逐条核;汇报给用户 review。
