# A股交易时段/交易日判定工具——market hours util（离线优先）

## Goal

MCP 情报缓存任务（08-02-mcp-intel-cache）需要判定"当前是否在 A 股
交易时段"（收盘后到次日开盘前用缓存）。本任务提供该判定工具，**离线
优先**——不引入网络依赖（akshare 已降级、网络受限）。

研究结论（2026-08-02）：pytdx（TDX）无交易日历/市场状态接口；**akshare
完全弃用**（用户确认——不引入其网络交易日历接口）；**ZODB 日K 的
`stock.get_datas()[-1].date` 是零网络推断最近交易日的可靠来源**（已有
数据）。

## Requirements

### R1（核心判定：`is_trading_time`）

- 新模块（建议 `utils/market_time.py`，与 time_helper 同级）：
  - `is_trading_time(now: datetime | None = None) -> bool` — 北京时间
    工作日的 **9:30–11:30 / 13:00–15:00** 返回 True，其余（午休、
    收盘后、开盘前、周末、节假日）False。
  - `now=None` 用 `datetime.now(ZoneInfo("Asia/Shanghai"))`（与
    time_helper.asia_today 同时区约定）。
  - **工作日近似**：`get_last_business_day` 语义（跳过周末）——节假日
    （国庆/春节等）无日历可查时归入"非交易时段"（判定 False → 用缓存，
    恰好是想要的行为）。**完全不引用 akshare**（用户确认弃用）。

### R2（交易日推断：`latest_trading_day`）

- `latest_trading_day(stock) -> date | None`（或等价签名）：从
  `stock.get_datas()[-1].date` 取最近交易日（日K 数据已在 ZODB，零
  网络）。无数据 → None。
- 用途：验证缓存新鲜度（缓存日期 vs 最近交易日是否同一"交易周期"）、
  供 MCP 缓存任务判断"缓存是否仍有效"。

### R3（可测试性）

- 纯函数（注入 now / stock），离线测试固定时间点：盘中/午休/收盘后/
  开盘前/周末各时段断言。house style 无 mock 框架——传参数注入。

### R4（既有行为不变）

- `utils/time_helper.py` 不动（asia_today / get_last_business_day 保留）；
  新模块复用它们，不复制逻辑。
- 不影响任何既有调用方（纯新增模块）。

## Acceptance Criteria

- [ ] `is_trading_time` 北京时间固定时刻：工作日 9:31 → True、11:29 →
      True、11:31 → False（午休）、14:59 → True、15:01 → False、
      8:59 → False（开盘前）、20:00 → False（收盘后）；周六任意时刻 →
      False
- [ ] `now` 参数注入（datetime 带时区或不带均可，内部转北京时间）
- [ ] `latest_trading_day` 从日K 末根 bar 取日期；无数据 → None
- [ ] 新模块测试全绿；全量回归 0 新增失败（基线 0F/196P/20S）
- [ ] time_helper / 既有调用方零改动

## Notes

- Lightweight task：PRD-only（新模块 + 新测试，无跨层改动）。
- 下游：08-02-mcp-intel-cache 依赖本任务的 `is_trading_time`（MCP 缓存
  判定"非交易时段用缓存"）。依赖写在 mcp-intel-cache 的 prd 里。
- 边界：无节假日历——节假日判定为 False（非交易时段）是**可接受的
  保守行为**（缓存比实时好，数据在休市日不变）。
- 不做：引入 akshare（任何接口）、交易日历持久化、交易时段配置化
  （9:30/15:00 常量即可，改动成本低）。
