# py-llms 审查报告

审查分片：Python LLM 层 + 工具集（core/llms/，18 文件全量逐行审阅）。
纯只读审查：未运行测试/linter/网络调用；跨文件引用（调用点、常量、导入）经 read/grep 核实。

## 审阅覆盖

|文件|行数|结论|
|---|---|---|
|core/llms/llm_factory.py|49|无发现|
|core/llms/retry.py|65|无发现|
|core/llms/prompt.py|229|无发现|
|core/llms/progress.py|70|无发现|
|core/llms/tool_loop.py|94|有发现（INFO×1）|
|core/llms/tools/_capped.py|41|无发现|
|core/llms/tools/_items.py|29|有发现（INFO×1）|
|core/llms/tools/billions_fetch.py|89|无发现|
|core/llms/tools/billions_fin_db.py|74|有发现（WARNING×1）|
|core/llms/tools/billions_search.py|133|无发现|
|core/llms/tools/billions_twitter.py|126|无发现|
|core/llms/tools/extra_indicators.py|93|无发现|
|core/llms/tools/get_company_info.py|20|无发现|
|core/llms/tools/get_financial_indicators.py|53|无发现|
|core/llms/tools/get_market_intel.py|104|无发现|
|core/llms/tools/get_trend_indicators.py|101|无发现|
|core/llms/tools/mcp_intel_cache.py|67|无发现|
|core/llms/tools/web_search.py|128|有发现（INFO×1）|

审阅辅助核实的跨文件引用（非本分片文件，仅用于契约核对）：`utils/runtime_config.py`（env_disabled/env_int/runtime_bool/runtime_int 语义）、`utils/billions_config.py`（billions_enabled/billions_cap_switch/billions_max_calls 优先级）、`data_source/chinese_mainland/billions/client.py`（BillionsClient 契约）、`agents/base.py`（AgentNode 链构造/MessagesPlaceholder/invoke_with_tools 调用点）、`core/investment_committee.py`（图装配 tools 绑定）、`agents/chinese_mainland/information_analyst.py`（_format_item/_format_tweet 复用与预抓）、`data_source/chinese_mainland/tdx/f10_parser.py`（metric 列恒为 str）、vendor `scripts/data_pipeline/indicators/trend.py`/`volatility.py`（calc_ema/calc_atr 全长度对齐）、`test/core/llms/tools/test_mcp_intel_cache.py`（失败文本写缓存为测试钉死行为）、`.trellis/tasks/archive/2026-08/08-08-billions-api-integration/research/billions-api.md`（result[].status 语义）。

## 发现

### [WARNING] _format_results 在 try/except 之外，违背"绝不 raise"契约

- **位置**: core/llms/tools/billions_fin_db.py:60-73（try 只包 `_client.fin_db(...)`；`text = _format_results(data)` 在 except 之后、try 之外）
- **问题**: 模块 docstring 与 tools spec 均约定"失败（BillionsApiError/**任何异常**/无有效结果）→ 占位文本，**绝不 raise**（AC4）"。但 `_format_results` 的调用在 try/except 之外，且其内部 `"\n\n".join(parts)` 假定 `result[].content` 恒为 str：若上游返回 content 为 list/dict（truthy 通过 `item.get("content")` 检查），`parts.append(item["content"])` 后 `join` 抛 TypeError，异常直接逃出 `get_billions_financial_intel`。其调用点 `core/investment_committee.py` 的 `build_stock_information`（`billions_text = _billions_intel(target_ticker)`，无 try）会整链上抛——单次 fin_db 上游数据形态偏离即可打崩整次分析。同类工具（billions_search/twitter 的 `_summarize_results`）的格式化都在 `capped_call` 的 try 内，本处是唯一把格式化放 try 外的消费点，与本仓库既有降级风格不一致。
- **证据**:
  ```python
  try:
      data = _client.fin_db(_build_question(ticker))
  except Exception as exc:
      logger.warning("亿信 fin-db 查询失败（{}）: {}", ticker, exc)
      return f"（亿信金融数据库查询失败，跳过{ticker}的财务问数）"
  text = _format_results(data)   # ← try 之外
  ```
  ```python
  if isinstance(item, dict) and item.get("content"):
      parts.append(item["content"])
  ...
  return _SECTION_TITLE + "\n" + "\n\n".join(parts)
  ```
- **建议**: 把 `_format_results(data)` 移入 try 块（或对 content 做 `isinstance(content, str)` 校验后再拼接），保持"任何异常 → 占位文本"契约。
- **spec 对照**: 违反 tools.md「亿信工具…失败 logger.warning + 占位文本不 raise」与 data_source spec「错误归一化…消费方 catch → 占位文本」；与本文件 docstring AC4「绝不 raise」直接冲突。

### [INFO] web_search 工具 docstring 声称"脏条目跳过"，但非 dict 条目会 AttributeError 逃逸且发生在 try 外

- **位置**: core/llms/tools/web_search.py:83-101（`_summarize_results` 循环）与 :126（`return _summarize_results(results)` 在 try/except 之外，try 只包 `search(query)`）
- **问题**: `_summarize_results` docstring 约定"脏条目（无标题/链接/摘要）跳过"，但实现只跳过**字段缺失的 dict 条目**：`item.get("title", "")` 对非 dict 条目（或 `json.loads` 顶层解析为 dict/非 list）直接抛 AttributeError。由于该函数在 `web_search` 的 try/except 之外，异常逃出工具，只能靠下游兜底（tool_loop 通用 except → "（联网搜索失败：'str' object has no attribute 'get'）"；信息面分析师 `_web_search_section` 同款）——图不中断但错误文案误导（数据形态问题被报成搜索失败），且每次逃逸都会多打一条 `logger.warning`。
- **证据**:
  ```python
  def _summarize_results(results: list) -> str:
      ...
      for item in results:
          title = item.get("title", "")   # 非 dict → AttributeError
  ```
  ```python
  try:
      results = search(query)
  except Exception as exc:
      logger.warning("Web search failed: {}", exc)
      return f"（联网搜索失败：{exc}）"
  return _summarize_results(results)      # ← try 之外
  ```
- **建议**: 循环内加 `if not isinstance(item, dict): continue`（与本仓库 `_items.collect_content_items` 的容错风格一致），或将 `_summarize_results` 并入 try 块。
- **spec 对照**: 轻微偏离 tools.md「web_search…查询失败/空结果 → 占位文本不 raise」的意图；与 `_items.py` 的"非 dict 脏条目跳过"契约不一致。

### [INFO] tool_loop 对全部工具统一使用"联网搜索"进度文案与失败占位

- **位置**: core/llms/tool_loop.py:61（`safe_progress(progress_updater, "正在联网搜索。。。")`）、:77（`content = f"（联网搜索失败：{exc}）"`）、:79（"联网搜索完成。。。"）
- **问题**: 工具循环的进度文案与失败占位对所有工具（web_search + 亿信三件套）一视同仁。亿信 fetch/search/twitter 轮次会向用户展示"正在联网搜索。。。"，工具异常占位也统一为"（联网搜索失败：...）"——亿信工具实为"亿信检索/全文抓取失败"。当前可观测影响有限（亿信工具异常被 `capped_call` 吞掉，实际能走到 :77 的只有 web_search），但文案对模型与用户均具误导性，且未来新增工具会放大该偏差。
- **证据**: `tool_loop.py:61` `safe_progress(progress_updater, "正在联网搜索。。。")`（无工具名区分）；`:77` `content = f"（联网搜索失败：{exc}）"`。
- **建议**: 按 `call["name"]` 区分文案（如非 web_search 工具用中性"正在调用工具。。。"），或失败占位含工具名。
- **spec 对照**: 与 tools.md「亿信工具失败占位文本措辞各异、逐字保留」的精神不一致（亿信工具的**自身**占位是"（亿信检索失败：...）"，但 tool_loop 层统一为联网搜索措辞）。

### [INFO] _items.py docstring 声称"status 失败已被 client 归一化"，与 client 实际实现不符

- **位置**: core/llms/tools/_items.py:4-5（docstring）与 data_source/chinese_mainland/billions/client.py:111（`data.get("success") is False`）
- **问题**: `_items.py` docstring 断言"status 失败已被 client 归一化为 BillionsApiError，result 恒为成功条目"，但 `BillionsClient._post` 只检查**顶层** `success is False`，从不检查 `result[].status`；消费方（`collect_content_items`、`billions_fin_db._format_results`）也不按条目 status 过滤。文档/实现漂移：目前可观测行为靠"失败条目无 content → 自然跳过"兜底（graceful），但若上游在 `status:"failed"` 的条目里附带 content/error 文本，该内容会被当作正常结果上屏进 LLM 上下文。data_source spec 明示"成败看 success + result[].status"，实现只归一化了一半。
- **证据**: `client.py:111` `if not isinstance(data, dict) or data.get("success") is False:`（无 result[].status 遍历）；`_items.py:4-5` "status 失败已被 client 归一化为 BillionsApiError"。
- **建议**: 二选一——client `_post` 增加 `result[].status` 失败归一化（对齐 spec 语义），或修正 `_items.py`/工具 docstring 表述并让消费方显式跳过 `status` 非成功条目。
- **spec 对照**: 偏离 data_source spec「业务语义：HTTP 200 仅表示已处理，成败看 success + result[].status」。

## spec 符合性结论

整体符合：llm_factory（R5 三键强校验、seed=114514、reasoning_effort 可选、无 extra_body）、retry（429/5xx/连接/超时指数退避 3 次 1s 起上限 8s、业务错误直抛、耗尽 reraise 原异常）、prompt（全部 system prompt 归属 prompt.py，agents/ 内无散落角色提示，中文风格与防编造指示齐备）、tool_loop（15 轮上限、tool_calls 按 name 分发、未知工具/异常占位不 raise、轮数耗尽收尾轮、空 tools 单轮直调）、亿信三工具（开关关返 None、capped_call 骨架、上限默认 3/2/3、占位措辞逐字保留、client 契约 success/超时档位/不重试 429 均核实无误）、progress（safe_progress 线程守卫、ProgressBridge、push_report hasattr 守卫）、mcp_intel_cache（缓存语义与测试钉死行为一致，失败文本写缓存为**有意且被测试固定的行为**，不报）、get_company_info（唯一 raise 点，BJ 前置中文拦截）、extra_indicators（vendor 零改动、ATR=0 除零置 NaN、全长度对齐核实）均符合。

偏离清单：上述 1 个 WARNING（fin_db 格式化在 try 外，违反"绝不 raise"契约）+ 3 个 INFO（web_search 非 dict 容错、tool_loop 工具文案统一化、_items/client 的 status 归一化文档漂移）。无 CRITICAL。
