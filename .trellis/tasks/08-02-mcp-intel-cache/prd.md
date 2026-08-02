# TDX MCP 情报结果缓存——非交易时段用缓存

## Goal

`get_market_intel`（core/llms/tools/get_market_intel.py）每次分析都实时
查询 TDX MCP 服务（实时行情/资金流向/概念板块），无任何缓存——网络往返
数秒、重复分析重复查。用户确认：**缓存最近一次查询结果，收盘后到次日
开盘前直接用缓存**（非交易时段行情不变，实时查是浪费）。

**依赖**：08-02-market-hours-util 的 `is_trading_time`（判定交易时段）——
本任务在其之后实现，用其判定"非交易时段 → 用缓存"。

## Requirements

### R1（缓存存储）

- 按 ticker 缓存最近一次 MCP 查询结果：JSON 文件落
  `data/tdx_cache/mcp_intel/ticker=<T>/data.json`（与既有 parquet 缓存
  同树 `DEFAULT_PARQUET_ROOT`，gitignored）。
- 内容：查询时间戳（北京时间 ISO）+ 结果文本（`get_market_intel` 现有
  输出：`【实时市场情报】` 段头 + 每行 `字段: 值` 的纯文本——缓存**结果
  文本**而非原始 rows，展示/LLM 语义不变）。
- 读：文件缺失/损坏/空 → 视为无缓存（回退实时查询）。写：查询成功后
  原子写（临时文件 + rename），失败不影响主流程（不 raise）。

### R2（判定与数据流）

```python
def get_market_intel(ticker):
    api_key = os.getenv("TDX_API_KEY", "")
    if not api_key:
        return _FALLBACK_TEXT            # 无 key 不变（不缓存）
    if not is_trading_time():
        cached = _read_cache(ticker)     # 非交易时段 → 优先缓存
        if cached is not None:
            return cached["text"]
    # 交易时段（或缓存缺失）：实时查询
    result = _query_mcp(ticker)          # 现状逻辑
    _write_cache(ticker, result)         # 成功才写
    return result
```

- **非交易时段且无缓存** → 仍实时查询（首次/缓存被清），查询成功写缓存
  ——首查不受时段限制。
- **交易时段** → 实时查询（不读缓存）；失败 → 现有降级占位文本不变
  （不静默用旧缓存——盘中数据必须新鲜，宁可降级）。
- 无 `TDX_API_KEY` → 现有降级路径，不读写缓存。

### R3（可测试性）

- 缓存读写为模块级纯函数（`_read_cache(ticker)` / `_write_cache(ticker,
  text)` 或等价），可注入缓存根路径（测试用临时目录，house style 无
  mock 框架）。
- `is_trading_time` 经函数注入或模块级导入调用——测试断言"非交易时段
  读缓存不查询 / 交易时段查询不读缓存"（计数包装 TdxMcpClient 或注入
  fetcher）。
- 缓存内容含时间戳；`_read_cache` 校验时间戳可解析、text 非空。

### R4（既有行为不变）

- 无 key / MCP 失败降级占位文本、`【实时市场情报】` 段头格式、UI 采集
  数据 Tab 渲染（data_markdown 透传键值行）均不变——缓存只是省网络
  往返，展示语义零变化。
- `build_stock_information` 组装点不动（get_market_intel 内部改）。

## Acceptance Criteria

- [ ] 非交易时段：有缓存 → 返回缓存文本（不触发 TdxMcpClient 查询）
- [ ] 非交易时段：无缓存 → 实时查询并写缓存
- [ ] 交易时段：实时查询（不读缓存），成功写缓存；失败 → 占位文本
- [ ] 无 TDX_API_KEY：降级文本，不读写缓存文件
- [ ] 缓存 JSON 含时间戳 + 文本；损坏/空 → 视为无缓存回退实时
- [ ] 缓存文件落 `data/tdx_cache/mcp_intel/ticker=<T>/data.json`
      （gitignored）
- [ ] 新增测试全绿（临时目录缓存 + 注入 fetcher 计数）；既有
      test_get_market_intel 测试保持绿（无 key 降级路径不变）
- [ ] 全量回归 0 新增失败（基线 0F/196P/20S + market-hours-util 用例）

## Notes

- Lightweight task：PRD-only？**否**——涉及缓存层 + 时间判定接线 +
  数据流改造，写 design.md + implement.md（设计要点：注入点、原子写、
  时段判定的失败语义）。
- 依赖 08-02-market-hours-util（`is_trading_time`）：其完成后本任务
  才能接线；实现顺序 = market-hours-util → 本任务。
- 不做：缓存过期策略（非交易时段永远用缓存，无 TTL——行情休市不变）、
  交易时段配置化、MCP 原始 rows 缓存（只缓存最终文本）、多进程并发写
  防护（Streamlit 单会话分析，风险低）。
