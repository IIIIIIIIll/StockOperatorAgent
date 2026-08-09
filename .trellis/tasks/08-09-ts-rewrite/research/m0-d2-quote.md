# M0-D2：getQuote 验证结论

**结论：node-tdx-market `getQuote` 无 bug——0.2.1 实测报错源于探针传参错误
（库签名期望 `string | string[]`，探针误传对象）。快照字段与 Python 链路逐字段一致。**

## 证据

1. **报错根因**：`dist/protocol/types.js:83-85` `parseCode()` 调
   `addPrefix(fullCode)` 后 `.slice(0,2)`；传对象 → `addPrefix` 返回原对象 →
   `normalized.slice is not a function`。签名（`client.d.ts:64`）：
   `getQuote(codes: string | string[]): Promise<QuoteData[]>`。
2. **正确调用实测**（`getQuote('sh600036')`，真实服务器）：

   ```json
   { "price": 38.8, "open": 38.9, "high": 39.1, "low": 38.48,
     "lastClose": 38.97, "volume": 779647, "amount": 3022675712,
     "bid1": { "price": 38800, "volume": 1095 }, "ask1": { "price": 38810, "volume": 43 } }
   ```

   与同日 K 线（08-07）自洽（close 38.8 = 快照 price）。
3. **Python oracle**（项目 TDX 链路 `get_tdx_source().fetch_snapshot('600036')`）：
   `open 38.9 / high 39.1 / low 38.48 / price 38.8` —— **逐字段一致**。

## 单位与对齐

| 字段 | node-tdx-market | 单位 | Python 侧 |
|---|---|---|---|
| price/open/high/low/lastClose | 厘（÷1000 得元） | 元 | 元（直接相等） |
| volume/totalVolume | 手（int） | 手 | 一致 |
| amount | 元（decodeVolume 千元 ×1000） | 元 | 待对齐（概览不消费，低优先） |
| bid/ask | 厘 + 手 | — | pytdx bid1/ask1 + vol 同语义 |

## 附带建议（非阻塞）

`parseCode` 对非字符串入参抛晦涩错误——可提 upstream issue 要求类型校验，
但不影响使用（TS 侧签名已约束）。

## 影响

- D2 决策点关闭：**无 fork/patch 需要**，按签名调用即可。
- 快照数据可用于 overview 构建（最新价/涨跌幅派生），与 Python 对齐。
