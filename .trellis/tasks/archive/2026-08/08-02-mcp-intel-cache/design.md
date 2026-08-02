# Design：TDX MCP 情报结果缓存

## 1. 背景与约束

- `get_market_intel` 每次实时查 MCP（实时行情/资金流向/概念板块），
  无缓存——非交易时段重复分析纯浪费网络往返。
- 用户确认：**缓存最近一次查询结果，收盘后到次日开盘前直接用缓存**。
- 依赖：`utils/market_time.is_trading_time`（08-02-market-hours-util，
  已实现提交 `14571f4`）——非交易时段 → 用缓存。
- 约束：展示/LLM 语义零变化（缓存省网络，不改变文本格式）；无 key /
  MCP 失败降级路径不变；akshare 完全不涉及。

## 2. 数据流

```
get_market_intel(ticker)
  ├─ 无 TDX_API_KEY → 占位文本（不读写缓存）           [现状不变]
  ├─ 非交易时段 + 缓存命中 → 返回缓存文本（零网络）     [新增]
  ├─ 交易时段 或 缓存缺失 → 实时查询                    [现状]
  │     └─ 查询成功 → 写缓存（原子写）                  [新增]
  └─ 查询失败 → 占位文本（不写缓存，不静默用旧缓存——
       盘中必须新鲜，宁可降级）
```

## 3. 组件设计

### 3.1 缓存存储：`core/llms/tools/mcp_intel_cache.py`（新模块）

- 路径：`DEFAULT_PARQUET_ROOT / "mcp_intel" / f"ticker={ticker}" / "data.json"`
  （与既有 parquet 缓存同树；`DEFAULT_PARQUET_ROOT` 锚定仓库根，
  gitignored——`data/` 已在 .gitignore）。
- JSON 内容：
  ```json
  {"fetched_at": "2026-08-02T20:15:00+08:00", "text": "【实时市场情报】\n..."}
  ```
  `fetched_at` = 查询时间（北京时间 ISO，`datetime.now(ZoneInfo(
  "Asia/Shanghai")).isoformat()`）；`text` = 查询结果文本（get_market_intel
  现有输出形态）。
- 模块级纯函数：
  - `_cache_path(cache_root, ticker) -> Path`
  - `read_cache(cache_root, ticker) -> str | None`：缺失/损坏/JSON 解析
    失败/text 非空字符串校验失败 → None（回退实时查询，不 raise）。
  - `write_cache(cache_root, ticker, text) -> bool`：**原子写**（临时文件
    + `os.replace`，进程崩溃不留半文件）；失败 → False（不影响主流程）。
- 签名带 `cache_root` 参数（默认 `DEFAULT_PARQUET_ROOT`）——测试注入
  临时目录（house style 无 mock 框架）。

### 3.2 `get_market_intel` 改造

```python
def get_market_intel(ticker: str) -> str:
    """按目标股票查询实时行情/资金流向/所属概念板块，返回中文摘要文本。

    缓存（08-02-mcp-intel-cache）：非交易时段（is_trading_time False）
    优先读缓存（收盘后到次日开盘前行情不变）；交易时段实时查询。
    """
    from utils.market_time import is_trading_time
    from core.llms.tools.mcp_intel_cache import read_cache, write_cache

    api_key = os.getenv("TDX_API_KEY", "")
    if not api_key:
        return _FALLBACK_TEXT

    if not is_trading_time():
        cached = read_cache(DEFAULT_PARQUET_ROOT, ticker)
        if cached is not None:
            return cached

    # 交易时段（或缓存缺失）：实时查询（现状逻辑）
    try:
        client = TdxMcpClient(api_key=api_key)
        result = client.query(...)
        ...
        text = "【实时市场情报】\n" + "\n".join(lines)
    except Exception:
        return f"（通达信 MCP 查询异常，跳过{ticker}的实时情报）"

    write_cache(DEFAULT_PARQUET_ROOT, ticker, text)
    return text
```

- 内部重构：把"查询 + 拼文本"提为模块级 `_query_mcp(ticker, api_key) ->
  str`（不 raise，失败返回降级占位）——让"实时查询"与"缓存判定"清晰
  分离，测试可注入/计数。
- `DEFAULT_PARQUET_ROOT` 从 `data_source.chinese_mainland.tdx.tdx_source`
  import（既有一致锚点）。
- **注意**：`is_trading_time` 与 `TdxMcpClient` 都在函数内 import（模块
  级副作用约定：无 key 环境不付出 tdx/vendor 加载成本——现有
  get_market_intel 已在函数内 import TdxMcpClient）。

### 3.3 失败语义（关键决策）

- **非交易时段 + 缓存缺失** → 实时查询（首次分析），成功写缓存。
- **交易时段** → 不读缓存；查询失败 → 降级占位（**不**静默用旧缓存——
  盘中数据必须新鲜）。
- 无 key → 不读写缓存（不产生缓存文件）。

## 4. 测试设计

新 `test/core/llms/tools/test_mcp_intel_cache.py`：

- `read_cache` / `write_cache` 往返（临时目录，tmp_path 或手工
  tempfile——house style 无 fixture，用 pytest tmp_path 是 pytest
  内建不算 mock）。
- 损坏 JSON / 空 text / 缺失 → read 返回 None。
- 原子写：write 后文件存在且内容正确。
- `get_market_intel` 缓存行为（注入 cache_root + 计数包装
  `_query_mcp`——monkeypatch 模块函数）：
  - 非交易时段 + 缓存存在 → 返回缓存文本，`_query_mcp` 零调用。
  - 非交易时段 + 无缓存 → 查询一次 + 写缓存（缓存文件出现）。
  - 交易时段 → 查询（缓存存在也查询），成功写缓存。
  - 无 TDX_API_KEY → 占位，无缓存文件（临时目录空）。
- `is_trading_time` 注入：测试内 monkeypatch
  `core.llms.tools.get_market_intel.is_trading_time`（函数内 import 的
  名字在调用时解析——monkeypatch 模块属性需 patch
  `get_market_intel.is_trading_time`？函数内 import 每次重新绑定模块
  全局——**patch `utils.market_time.is_trading_time` 才有效**（函数内
  import 的是模块属性）。实测确认 patch 目标后写测试。
- 既有 `test_get_market_intel.py`（无 key 降级）保持绿——需检查其
  是否依赖函数内 import 行为，必要时补环境清理（显式清 TDX_API_KEY
  已有先例）。

## 5. 兼容性与风险

- **风险 1：函数内 import 与 monkeypatch 目标**——测试 patch
  `utils.market_time.is_trading_time`（模块属性，函数内 import 每次
  解析到它）；同理 `_query_mcp` 计数需 patch 模块全局名
  （`get_market_intel._query_mcp`——模块级定义则可 patch）。
- **风险 2：缓存文件累积**——每 ticker 一个 JSON，几十 KB，无清理
  策略（可接受；gitignored）。
- **风险 3：跨交易日缓存陈旧**——周五收盘缓存，周一开盘前使用（行情
  未变，正确）；周一开盘后交易时段自动实时查（不读缓存）→ 写入新
  缓存。无 TTL 设计即正确（时段判定承担新鲜度职责）。
- **风险 4：DEFAULT_PARQUET_ROOT 导入链**——mcp_intel_cache 从
  tdx_source import 常量会触发 tdx_source 模块级 ensure_vendor_on_path
  + vendor import（tdx_client）。放函数内 import 或直接从
  `utils.constants` 拿锚点？`DEFAULT_PARQUET_ROOT = REPO_ROOT / "data" /
  "tdx_cache"`——**用 `utils.constants.REPO_ROOT` 本地推导**，避免
  无 key 环境加载 vendor。设计定：mcp_intel_cache 模块顶部
  `from utils.constants import REPO_ROOT`（轻依赖）。
- **不回退**：展示文本格式、无 key 路径、失败降级、UI 渲染全部不变。

## 6. 边界

- 不做：缓存 TTL/过期清理、多进程写锁（Streamlit 单会话分析）、
  MCP 原始 rows 缓存（只缓存最终文本）、交易时段配置化。
