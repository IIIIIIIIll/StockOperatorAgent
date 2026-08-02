# Implement：TDX MCP 情报结果缓存

## 执行顺序

### 1. 新模块 `core/llms/tools/mcp_intel_cache.py`

- `_cache_path(cache_root, ticker)`、`read_cache`（缺失/损坏 → None 不
  raise）、`write_cache`（原子写：临时文件 + os.replace）。
- 路径根：`utils.constants.REPO_ROOT / "data" / "tdx_cache"`（避免
  import tdx_source 触发 vendor 加载）。
- JSON：`{"fetched_at": ISO, "text": str}`。

### 2. `get_market_intel.py` 改造

- 提取 `_query_mcp(ticker, api_key) -> str`（查询 + 拼文本 + 降级占位，
  不 raise）。
- 主函数加缓存分支：无 key → 现状；非交易时段 → read_cache 命中返回；
  实时查询 → 成功 write_cache。
- 函数内 import `is_trading_time`（utils.market_time）+ cache 函数 +
  `REPO_ROOT` 推导的缓存根。

### 3. 测试 `test/core/llms/tools/test_mcp_intel_cache.py`

- read/write 往返、损坏 JSON、空 text、缺失（pytest tmp_path）。
- get_market_intel 缓存行为：monkeypatch `utils.market_time.is_trading_time`
  + 计数包装 `_query_mcp`（注意：函数内 import 的 patch 目标是模块
  属性——先实测确认）。
- 无 key 路径：临时目录无缓存文件。

### 4. 验证与收尾

- 全量回归（先确认无 streamlit 在跑）。
- spec 更新：core/index.md（get_market_intel 缓存约定）+ testing.md
  基线。
- journal + commit + 归档。

## 验证命令

```bash
python -m pytest test/core/llms/tools/test_mcp_intel_cache.py -v
python -m pytest test/core/llms/tools/test_get_market_intel.py -v   # 既有降级测试
python -m pytest   # 全量（确认无 app 在跑）
```

## 评审门

- [ ] 非交易时段 + 缓存 → 零查询（计数包装断言）
- [ ] 非交易时段 + 无缓存 → 查询 + 写缓存
- [ ] 交易时段 → 查询不读缓存，成功写缓存
- [ ] 无 key → 无缓存文件
- [ ] read 损坏/空/缺失 → None 回退
- [ ] 既有 test_get_market_intel 绿；全量 0F/196P/20S +9（market_time）+新用例

## 回滚点

- 新模块独立提交；get_market_intel 改造可 revert 单文件。
