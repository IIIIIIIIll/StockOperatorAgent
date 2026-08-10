# M0-D3：xdxr 数据源 + qfq 前复权验证

**结论：xdxr 数据源定案 = node-tdx-market `CommandType.Gbbq`(15) + 移植
pytdx opcode(data 段)。TS qfq 移植与 Python `adjust.py` 输出逐字节一致。**

## xdxr 数据源（opcode 移植）

- node-tdx-market **内置** `CommandType.Gbbq = 15`（除权除息），只是没公开方法。
- `TdxClient.sendCommand` 是公开方法（`client.d.ts:58`）→ 继承调用，无需 fork。
- **data 段**（pytdx `GetXdXrInfo.setParams` 命令号后的负载）：
  `count(u16 LE=1) + market(u8) + code(6 ascii)` —— 初版漏 count 返回 0 条，
  补上后 **67/67 条事件与 Python oracle（项目 fetch_xdxr）完全一致**。
- 响应解析（pytdx `parseResponse` 移植）：跳过 9 字节 → `num(u16)` →
  每条 29 字节：`market+code(7) + skip(1) + zipday(u32 YYYYMMDD) + category(1) + payload(16)`；
  `category==1`：`fenhong/peigujia/songzhuangu/peigu` 四个 **float32 LE**；
  `11/12`：`suogu`；`13/14`：`xingquanjia/fenshu`；其余股本变化 4×u32（qfq 不消费，M1 处理）。
- 单位：fenhong/songzhuangu/peigu = **每10股**，peigujia = 元/股（与 Python 侧一致）。

实测（600036，2026-08-09）：
```
2024-07-11 fenhong=19.719999  | 2025-07-11 fenhong=20.0
2026-01-16 fenhong=10.13     | 2026-07-10 fenhong=10.03   （与 Python 逐条一致）
```

## qfq 前复权（TS 移植 vs Python oracle）

- `qfq.mjs` 逐字节移植 `adjust.py`：事件新→旧遍历、因子累乘后应用、
  prev_close 用未复权收盘快照、`ratio_vol<=0` 跳过成交量调整、复权后重算
  振幅/涨跌幅/涨跌额、成交量舍回整手。
- 对比：600036 全量日K（5835 根原始 bar）+ 67 条 xdxr → 复权后最近 **750 根**，
  close+volume 与 Python `mapping + adjust` 链路输出 **逐行 IDENTICAL**
  （含 2025-07-11（42.14）、2026-01-16、2026-07-10（36.88）除权跳变区间）。

## 影响

- D3 决策点关闭：**xdxr 走 opcode 移植**（挂 node-tdx-market 扩展类），
  不需要 HTTP 除权源；qfq 算法等价移植，M1 直接复用。
- 待 M1：股本变化类事件（category≠1）的 get_volume 浮点近似解析
  （qfq 不消费，overview 流通股本部分需要）。
