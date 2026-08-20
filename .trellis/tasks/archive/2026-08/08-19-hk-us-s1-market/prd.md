# S1 市场模型与时间门 (hk-us-s1-market)

## 目标

新建 `src/market.ts`：`type Market = 'cn'|'hk'|'us'`；`MarketInfo { market, label, timeZone, currency, lotSize, promptRules }`；`detectMarket(input): Market|null`；`normalizeTicker(input): {market, ticker}|null`；`hkSymbolCandidates(input): string[]`。改造 `src/gates.ts`：新增 `marketToday(market)`；`asiaToday()` 委托 `marketToday('cn')`（输出逐字节不变）；`resolveSkipGates(store, ticker, opts?, market='cn')` 用 `marketToday(market)` 判 dailyFresh，hk/us 恒 `skipF10=false`。

## 规则（决策已定，照抄）

- CN：`/^\d{6}$/` 且非 4/8 开头（北交所语义保留）→ ticker 原样。
- HK：`/^\d{1,5}$/`；`hkSymbolCandidates`：≤4 位 → 左补零 4 位唯一候选；5 位且首 0 → [4 位形式（去一前导零）, 5 位原样]；5 位非 0 首 → 5 位唯一。（`00700`→[`0700.HK`,`00700.HK`]；`09988`→[`0988.HK`,`09988.HK`]；`700`→[`0700.HK`]）
- US：`/^[A-Za-z][A-Za-z0-9.-]{0,9}$/` 大写。
- `marketInfo`：cn `{label:'沪深A股', timeZone:'Asia/Shanghai', currency:'CNY', lotSize:100}`；hk `{label:'港股', timeZone:'Asia/Hong_Kong', currency:'HKD', lotSize:null}`；us `{label:'美股', timeZone:'America/New_York', currency:'USD', lotSize:null}`。`promptRules` 字段留空串占位（S4 填充，本切片只声明类型与空值）。

## 依赖

无。后续 S2/S3/S4 均依赖本切片（`src/market.ts` 导出）。

## 文件所有权（本切片独占）

`src/market.ts`(新)、`src/gates.ts`、`test/market.test.ts`(新)、`test/gates.test.ts`(增补)。禁止触碰其它文件。

## 验收

- `npm test -- test/market.test.ts test/gates.test.ts` 全绿。用例覆盖：detect/normalize 全表（`600036`→cn、`430047`→null(北交所)、`700`/`00700`/`09988`/`3690`→hk 候选序、`aapl`/`BRK.B`/`BF-B`→us、`123`→null、`1234567`→null）；`marketToday` 三时区（固定时间戳注入）；`resolveSkipGates` market 分支（hk 同日 skipDaily、skipF10 恒 false）。
- `npm run typecheck` 通过。
- 既有 `test/gates.test.ts` 用例零改动全绿（asiaToday 行为不变）。
