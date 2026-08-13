# py-tests 审查报告

> 分片：Python 测试套件（60 文件全量）｜审查方式：纯只读（未运行任何测试/工具）
> 对照 spec：`.trellis/spec/testing.md`、`guides/index.md`、各 layer spec Tests 段、`ui-e2e.md`、`core/ui.md`、`data_source/index.md`、`data_storage/index.md`

## 审阅覆盖

|文件|行数|结论|
|---|---|---|
|test/agents/test_agent_base.py|256|无发现（离线假 LLM 注入，partials/bind_tools/complete_* 契约完整）|
|test/agents/test_expert_agents.py|124|无发现（ROLES 工厂 + 路由短语 + 零 bind_tools 断言）|
|test/agents/test_information_analyst.py|405|无发现（预抓参数/降级/回退路径全覆盖，env 隔离三件套）|
|test/agents/test_query_baselines.py|142|无发现（字节级基线契约，repr 固化）|
|test/core/data_acquisition/test_data_acquisition.py|91|无发现（7 skip 符合 spec deprecated 清单；test_acquire_stock_data 保留合理）|
|test/core/data_acquisition/test_data_acquisition_tdx.py|644|有发现（WARNING-3，INFO-3）|
|test/core/data_acquisition/test_data_correctness_fixes.py|134|无发现（离线合成，列名契约 + 参数化）|
|test/core/data_acquisition/test_fetch_scope.py|124|无发现（_FakeSrc 计数，缓存/失败语义钉死）|
|test/core/llms/test_llm_factory.py|74|无发现（三键校验/URL 格式/reasoning_effort）|
|test/core/llms/test_progress.py|50|无发现（bridge 事件通道纯行为）|
|test/core/llms/test_retry.py|77|无发现（重试分类：429/5xx 重试、400 不重试）|
|test/core/llms/test_tool_loop.py|140|无发现（消息序列/轮数截断/未知工具降级）|
|test/core/llms/tools/test_extra_indicators.py|120|无发现（参数化边界表，公式手算对照）|
|test/core/llms/tools/test_get_company_info.py|40|无发现（BJ 错误信息/None 降级，属性交换注入）|
|test/core/llms/tools/test_get_financial_indicators.py|57|有发现（WARNING-1、WARNING-2）|
|test/core/llms/tools/test_get_market_intel.py|34|有发现（INFO-1）|
|test/core/llms/tools/test_get_trend_indicators.py|30|有发现（WARNING-4、INFO 注：N/A 计数契约）|
|test/core/llms/tools/test_mcp_intel_cache.py|214|无发现（读写/损坏/原子写/开关三态/缓存门，monkeypatch 离线）|
|test/core/llms/tools/test_web_search.py|124|无发现（开关三态 + 覆盖层 + 降级占位）|
|test/core/stock_formatter/test_stock_output_formatter.py|100|无发现（live 冒烟 + 离线 NaN→N/A golden）|
|test/core/test_billions_fin_db.py|244|无发现（开关/降级/注入段拼接/进度门）|
|test/core/test_billions_tools.py|541|无发现（三工厂矩阵 + 上限 + committee 绑定，env 快照恢复）|
|test/core/test_committee_enrichment.py|123|无发现（enrichment 唯一组装点 + manager 插值 [-1].content）|
|test/core/test_role_registry.py|288|无发现（**双向断言**：State⊇注册表 + 注册表==State；图形状/谓词真值表）|
|test/core/ui/test_charts.py|168|无发现（altair spec 结构断言，红涨绿跌/无 streamlit import）|
|test/core/ui/test_data_markdown.py|324|无发现（表格结构/分节/降级透传/parse-once 等价）|
|test/core/ui/test_display.py|503|有发现（INFO-5；report_tabs 顺序/开关矩阵/收集器覆盖充分）|
|test/core/ui/test_theme.py|123|无发现（调色板/媒体查询/config.toml 一致性/tomllib）|
|test/data_source/test_akshare.py|92|无发现（**整文件 skip**，deprecated live 处理符合 spec）|
|test/data_source/test_akshare_source_fixes.py|36|无发现（自然日窗口公式 + 合成日历验证，离线）|
|test/data_source/test_billions_client.py|342|无发现（4 端点请求构造/超时档位/错误归一化/懒加载）|
|test/data_source/test_f10_parser.py|190|有发现（WARNING-1 两处）|
|test/data_source/test_tdx_cache_read.py|83|无发现（临时 parquet 根，命中路径离线）|
|test/data_source/test_tdx_mapping.py|275|无发现（12 列序/首行 NaN/换手率/qfq golden 全覆盖）|
|test/data_source/test_tdx_name_index.py|66|有发现（INFO-2）|
|test/data_source/test_tdx_overview.py|262|无发现（22 列序/派生计算 golden/live 不可达跳过）|
|test/data_source/test_tdx_reports.py|263|有发现（WARNING-1 一处；QoQ 跨期/季度补齐覆盖好）|
|test/data_source/test_tdx_screener.py|32|无发现（live 冒烟，符合 spec）|
|test/data_source/test_tdx_source.py|98|无发现（live 冒烟 + 单例只构造一次）|
|test/data_storage/test_ZODBStorage.py|161|无发现（单例复用/表驱动 need_update/并发首调；**陈旧构造已修复**，见 INFO-6）|
|test/data_structure/test_ChinaStock.py|201|无发现（批量 mutator/commit 参数/去重语义；**陈旧构造已修复**，见 INFO-6）|
|test/data_structure/test_row_constructors.py|259|无发现（**from_row KeyError** 双向/重排免疫/NaN 语义/双射断言）|
|test/e2e/conftest.py|395|无发现（双服务器/零调用审计/截图/端口可覆盖）|
|test/e2e/mock_app.py|78|无发现（模块全局替换 + 自检标记，生产零改动）|
|test/e2e/mock_committee.py|121|无发现（FakeGraph 三批 superstep 镜像真实图）|
|test/e2e/test_billions_tab.py|85|无发现（8 tab 布局/信息面 Tab 渲染）|
|test/e2e/test_interaction.py|118|无发现（图表 svg/表格计数/expander 轮次）|
|test/e2e/test_invalid_input.py|29|有发现（INFO-4）|
|test/e2e/test_settings_panel.py|219|无发现（分区/password 不回显/toggle 7↔8 Tab/保存隔离 tmp）|
|test/e2e/test_smoke.py|52|无发现（标题/表单/8 tab 顺序）|
|test/e2e/test_theme_e2e.py|51|无发现（colorScheme 仿真切换）|
|test/integration/test_basic_graph.py|752|无发现（**整文件 skip**，符合 spec deprecated 清单）|
|test/integration/test_graph_parallel.py|531|有发现（INFO-3；reducer/join/revise/桥接覆盖充分）|
|test/integration/test_investment_committee.py|36|无发现（**整文件 skip**，符合 spec）|
|test/utils/test_billions_config.py|355|无发现（开关矩阵/能力闸/覆盖层优先/env 隔离三件套）|
|test/utils/test_constants_paths.py|62|无发现（路径锚定 + subprocess CWD 隔离）|
|test/utils/test_env_file.py|372|无发现（白名单/原子性/tmp 清理/os.environ 同步）|
|test/utils/test_market_time.py|73|无发现（盘中/午休/收盘边界/时区转换/纯函数注入）|
|test/utils/test_runtime_config.py|204|无发现（覆盖层语义/值归一/非法丢弃/env 隔离）|
|test/utils/test_time_helper.py|39|无发现（固定日期断言 + 子进程 TZ 隔离）|

## 发现

### [WARNING] 硬编码开发者绝对路径 `/home/tan/StockOperatorAgent/...`（3 文件 4 处）
- **位置**: `test/core/llms/tools/test_get_financial_indicators.py:16`；`test/data_source/test_f10_parser.py:130,180`；`test/data_source/test_tdx_reports.py:258`
- **问题**: 缓存路径写死开发者本机绝对路径，绕过仓库的锚定约定（`utils/constants.py` 的 `REPO_ROOT`、`tdx_source.DEFAULT_PARQUET_ROOT`——test_constants_paths.py 专门用 subprocess 钉死"任意 CWD 三处路径都锚定仓库根"，此处却反向硬编码）。换机器/换目录后这些用例全部**静默 skip**（`os.path.exists` 检查 → `pytest.skip`），既不自报失败也不提示覆盖丢失。
- **证据**: `_RAW_CACHE = "/home/tan/StockOperatorAgent/data/tdx_cache/company_info_raw"`（test_get_financial_indicators.py:16）；`raw_path = ("/home/tan/StockOperatorAgent/data/tdx_cache/company_info_raw/ts_code=000001.SZ/data.parquet")`（test_tdx_reports.py:258-259）
- **建议**: 改用 `REPO_ROOT / "data" / "tdx_cache" / "company_info_raw"` 派生（与 `DEFAULT_PARQUET_ROOT` 同源），保证路径跨机器成立。
- **spec 对照**: 违反 testing.md「路径锚定」验收精神（prd 08-02-fix-env-robustness 明确三处路径不随 CWD/机器漂移）。

### [WARNING] golden 值绑定可刷新本地缓存内容，缓存刷新即无改动 FAIL
- **位置**: `test/core/llms/tools/test_get_financial_indicators.py:35`
- **问题**: `_require_cache`（:21）只检查缓存**存在性**不检查内容；`get_financial_indicators("600519")` 解析 `company_info_raw` 缓存文本的**最新报告期**。该缓存由 TdxSource F10 抓取链路按季刷新（新季度数据入库即覆盖文本）——同一台机器上缓存刷新后 `营业毛利率: 89.76%` 必然不再是当期值，断言**无代码改动即 FAIL**（存在性检查还会让它"看起来有数据可测"）。与 WARNING-1 叠加：缓存存在但内容过旧/过新都不可复现。
- **证据**: `assert "营业毛利率: 89.76%" in out  # 实测 golden 值`（:35）
- **建议**: 结构断言（指标名齐全 + 数值为有限正数 + 百分号格式），或从固化种子文件读取期望值（对齐 e2e `fixture_002027.txt` 快照做法），不依赖机器本地缓存内容。
- **spec 对照**: 违反 testing.md「断言可观察行为而非实现细节/跨运行确定性」精神（缓存是 gitignored 可变工件）。

### [WARNING] `last_data_update == get_last_business_day(asia_today())` 断言在 A 股节假日不成立
- **位置**: `test/core/data_acquisition/test_data_acquisition_tdx.py:137,153`
- **问题**: 实现侧 `last_data_update` = 实际最后一根 bar 的日期（`ChinaStock.add_datas` 取末行 date，见 test_ChinaStock 的 `last_data_update == datetime.date(2024,1,4)` 语义）；断言侧 `get_last_business_day` 只跳过周末、**不建模市场节假日**。国庆/春节等假期期间（今天是工作日但 A 股休市）TDX 最后一根 bar 停在节前交易日 → `last_data_update`（节前）≠ `get_last_business_day(今天)`（今天）→ 断言失败。每年约 2-3 周窗口内全量回归必红（live 数据驱动）。
- **证据**: `assert stock.last_data_update == get_last_business_day(asia_today())`（:137，同样 :153）
- **建议**: 断言放宽为 `last_data_update <= get_last_business_day(asia_today())` 且 ≥ 节前最近交易日；或注入固定"今天"日期使测试与日历解耦。
- **spec 对照**: 偏离 testing.md「跨运行确定性」——同一日历不同星期结果翻转。

### [WARNING] test_get_trend_indicators live 播种断言缺"不可达跳过"守卫
- **位置**: `test/core/llms/tools/test_get_trend_indicators.py:22`
- **问题**: 同族 live 测试（test_tdx_overview.py / test_tdx_reports.py）对 TDX 不可达统一用 `if df is None: pytest.skip(...)` 守卫；本用例在种子缺失时 `assert da.acquire_historical_data_tdx("000001") is True`——TDX 不可达（本任务 PRD 明示"本网络受限环境"）或干净机器（无 DB 无缓存）时**硬失败而非 skip**，与同族约定不一致，全量回归被环境拖红。
- **证据**: `assert da.acquire_historical_data_tdx("000001") is True`（:22，注释自称"尝试播种"）
- **建议**: 播种失败按 acquire 返回值 `pytest.skip("TDX unreachable...")`，与 test_tdx_overview/reports 的不可达语义对齐。
- **spec 对照**: 偏离 tdx.md/testing.md「TDX 可达执行，不可达跳过」约定（testing.md 明列该文件为"指标输出结构"用例，未注明可失败）。

### [INFO] `test_placeholder_does_not_break_enrichment` 的 `or` 断言近乎恒真
- **位置**: `test/core/llms/tools/test_get_market_intel.py:31`
- **问题**: `assert "实时市场情报" not in enriched or "未配置 TDX_API_KEY" in enriched`——若实现回归为返回空串，第一分支 `"实时市场情报" not in enriched` 为 True，测试仍绿。真正的降级契约已由 `test_no_key_returns_placeholder`（`text == _FALLBACK_TEXT` 精确相等）钉死，本用例实际只验证"可拼接不 raise"。
- **证据**: `assert "实时市场情报" not in enriched or "未配置 TDX_API_KEY" in enriched`
- **建议**: 改为 `assert enriched.endswith(_FALLBACK_TEXT)` 精确断言拼接契约。
- **spec 对照**: 无 spec 冲突（弱断言）。

### [INFO] test_tdx_name_index 不恢复模块级 `_NAME_INDEX` 状态
- **位置**: `test/data_source/test_tdx_name_index.py:37-39`
- **问题**: `_reset()` 清空索引后用例把 `_NAME_INDEX_LOADED` 留在 True、索引只含合成 2 条目（000001→平安银行 / 600000→浦发银行）。当前无害（合成名称恰好等于真实名称，且后续用例不查名称），但同进程后续任何 `get_stock_name` 对**其他** ticker 会静默回退 ticker——若未来用例依赖名称索引（如 build_overview 实时查名）会隐性失测。house style 惯例（test_display 等）是 try/finally 保存恢复。
- **证据**: `tdx_mod._NAME_INDEX.clear(); tdx_mod._NAME_INDEX_LOADED = False`（:38-39）
- **建议**: 用例末尾保存恢复 `_NAME_INDEX` / `_NAME_INDEX_LOADED`。
- **spec 对照**: 偏离 testing.md 环境隔离精神（跨用例确定性）。

### [INFO] 时序断言（墙钟阈值）在负载环境可能抖动
- **位置**: `test/integration/test_graph_parallel.py:238`（`elapsed < 9.5`）；`test/core/data_acquisition/test_data_acquisition_tdx.py:324`（`elapsed >= 0.6`）
- **问题**: 两个用例刻意用墙钟证明并行/串行语义（8s 并行 vs 16s 串行、0.8s 串行 vs 0.4s 并行，margin 尚宽），属文档化设计；但共享 CI/GC/CPU 竞争下仍有误报风险（前者是上界、后者是下界，方向相反恰好互补）。
- **建议**: 保持现状亦可；如遇抖动，可将 2s sleep 加大以拉开 margin。
- **spec 对照**: 符合（testing.md 记录时序断言为刻意设计）。

### [INFO] test_invalid_input 的 docstring 声称"CALL_COUNT 不变"但无对应断言
- **位置**: `test/e2e/test_invalid_input.py:4-5`
- **问题**: docstring 声称"无效输入路径不触达 mock 图——不构造图（服务器日志审计中 CALL_COUNT 不变）"，但用例本身不读 CALL_COUNT；conftest 审计只要求 **≥1**（session 级），无法证明无效输入未构造图。声称与实现不符（若无效输入路径 bug 导致构造了图，本用例与审计都照常绿）。
- **建议**: 用例内记录提交前后 `CALL_COUNT`（读服务器日志或加断言入口），或删除该声称。
- **spec 对照**: 无 spec 冲突（文档与断言不一致）。

### [INFO] 陈旧构造确认（任务指定项）：`ChinaStock('dummy')` 单参数构造已修复、全仓零残留
- **位置**: `test/data_structure/test_ChinaStock.py:31` 起；`test/data_storage/test_ZODBStorage.py:37` 起
- **问题**: 无。全仓 grep `ChinaStock(<单参数>)` 零匹配；两文件均为三参数构造 `ChinaStock("测试", "000001", _make_overview("000001"))`（22 字段 StockOverview），与 `ChinaStock.__init__(name, ticker, overview)` 签名一致。`test/utils/test_market_time.py:40` 用 `ChinaStock("dummy", "999998", None)` 三参数 + 显式 None overview，合法（overview 无默认值但显式传 None 不触发 TypeError）。testing.md 2026-08-02 修复记录（"ChinaStock('dummy') TypeError 修复：三参数构造 + 完整 ChinaStockData 字段"）与现状相符。
- **建议**: 无需动作；标注为"已核实修复"。
- **spec 对照**: 符合 testing.md 修复记录。

### [INFO] test_display / test_theme 的源码字符串断言对空白与重命名敏感
- **位置**: `test/core/ui/test_display.py:186`（`assert "[DATA_TAB_TITLE] + [title for _, title in _report_tabs]" in source`）、`test_theme.py:113` 等
- **问题**: 多处 `inspect.getsource` + 子串/`ast` 断言钉 display.write_ui 接线——属文档化 house style（Streamlit 副作用不 mock），但字符串字面断言对格式化（black 重排、变量改名）脆弱；改写代码时需同步改测试。属设计取舍，仅提示。
- **建议**: 维持现状（契约价值大于脆弱性），或收敛到 `ast` 结构断言。
- **spec 对照**: 符合 ui-theme.md「ast 测试钉死」约定。

## spec 符合性结论

- **整体符合**：60 文件与 testing.md / ui-e2e.md / data_source / data_storage / data_structure / core 各 Tests 段高度一致——deprecated skip 清单（test_akshare 整文件、test_data_acquisition 7 方法、integration 2 文件）、e2e mock 零调用审计、亿信 env 隔离三件套、dummy ticker 约定、跨运行前置条件显式化、role_registry 双向锁死、from_row KeyError 响亮失败契约、commit 计数（单事务链）、display REPORT_TABS 顺序契约、reducer/messages 通道形状——均被钉死且设计质量高。
- **主要偏离**：① 3 个文件硬编码开发者绝对路径（违反路径锚定约定）；② golden 值绑定可刷新缓存（同机刷新即 FAIL）；③ live 用例对 A 股节假日/不可达环境的失败模式不一致（同族 skip 守卫未全覆盖）；④ 少量弱断言/文档与断言不符（INFO 级）。
- **已知陈旧测试结论**：任务指定核对的 `ChinaStock('dummy')` 单参数构造在 test_ChinaStock.py / test_ZODBStorage.py 中**已不存在**（2026-08-02 修复，全仓 grep 验证零残留），标注为已确认修复，无新增发现。
