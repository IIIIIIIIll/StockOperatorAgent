# Journal - yh.t (Part 1)

> AI development session journal
> Started: 2026-08-02

---

## 2026-08-02 — Spec bootstrap (task 08-02-spec-bootstrap)

Bootstrapped `.trellis/spec/` from the codebase via the trellis-spec-bootstrap skill:

- **Deleted** `backend/` template layer (5 placeholder files — the project has no backend/frontend split).
- **Created** 5 package layers with `index.md` each: `agents/`, `core/`, `data_source/`, `data_structure/`, `data_storage/` — all carry `paths:` frontmatter for path-scoped injection (verified via `spec_match.match_specs_for_file`).
- **Created** root cross-cutting files: `index.md` (nav), `architecture.md`, `logging.md`, `error-handling.md`, `testing.md`.
- **Rewrote** both guides (`cross-layer-thinking-guide.md`, `code-reuse-thinking-guide.md`) — they were Trellis-internal boilerplate (JSONL events, docs.json, platform templates) with zero project content; now describe real boundaries (akshare DataFrame → positional dataclass → ZODB commit → state string → LLM prompt → UI) and real reuse patterns (agent template, `time_helper`, `constants`).
- **Key non-obvious findings** recorded in specs: positional `*list(row.values())[1:]` column-order coupling; `transaction.commit()` after every ZODB mutation; `bullish_opinions` typed `list` but fed strings (add_messages reducer wraps them — `display.py` reads `[-1].content`); `'%Y%m%d'` report-date string format across the data chain; stale tests `ChinaStock('dummy')`; dead `openpyxl.styles.builtins.output` import; `fetch_stcok_data.py` filename typo (kept).
- Verified: no placeholders, no broken links, layers discovered by `get_context.py --mode packages`, task artifacts validated, product source untouched.

## 2026-08-02 — Spec-system operating knowledge (task 08-02-spec-system-knowledge)

Captured how the spec system itself operates into `.trellis/spec/spec-system.md`:
- Frontmatter contract: first line must be `---`; `name`/`description`/`paths:` keys; malformed `paths:` (scalar where list expected) disables routing for the whole file (warn + skip in `spec_match.py`).
- Glob grammar: repo-relative, `*` per segment, `**` any depth, trailing `/` = `/**`.
- Injection caps from `.trellis/config.yaml`: 9400 chars/file, 9500/event, 2700s refresh; editing a spec re-injects it.
- Discovery: every spec subdir except `guides` is a layer; SessionStart lists `guides/index.md` + each layer's `index.md`; root-level specs need `paths:` + index links (not in SessionStart).
- Code-spec vs guide decision rule; verification commands for spec edits.
- `spec-system.md` self-routes via `paths: .trellis/spec/**` — verified live when the injection hook fired on write. `index.md` now links it from "How Specs Reach You".



## 2026-08-02 — tdx_quant 集成（task 08-02-tdx-quant-integration）

将 https://github.com/henrylin99/tdx_quant 集成进 StockOperatorAgent（M1→M2→M3 三个里程碑，用户批准的方案）：

- **vendor 机制**：上游无打包文件（无 pyproject/setup.py），按 vendor 快照引入（commit b95d8e9，55 文件 → `data_source/chinese_mainland/tdx/vendor/`），`tdx_source.py` 模块级 `ensure_vendor_on_path()` 插入 sys.path 使上游绝对导入 `scripts.*` 原样可用，零改动；VENDOR.md 记录 commit 与更新流程。依赖仅新增 `pytdx==1.72`。
- **M1 历史行情主路径**：`TdxSource` 薄包装（8 个 fetch_*，raw DataFrame out）；`mapping.to_akshare_hist_schema` 输出与 akshare `stock_zh_a_hist` 完全一致的 12 列序 → 既有 `ChinaStockData(*list(row.values()))` 位置构造零改动；`adjust.qfq_adjust` 前复权。**实测发现的非显然知识**：pytdx xdxr 的 `fenhong/songzhuangu/peigu` 是**每10股单位**（比亚迪 002594 事件 39.74/20.0 = 10转20派39.74元，除 10 才对）；qfq 因子**先累乘再应用**（事件日 bar 是基准，事件前 bar 乘更新后因子）；复权后需重算振幅/涨跌幅/涨跌额（除权跳空消除）。akshare qfq 黄金对照因本环境东方财富端点不可达改用除息日价格跳空实证（6/12 除息跳空 0.3 元 ↔ 0.36 元/股 ✓）。
- **DataAcquisition**：`acquire_historical_data_tdx`（新鲜度优先 + 布尔协议 + 三个异常捕获点：finance_capital/xdxr 降级、daily 失败 → False），`get_stock_data` TDX 优先/akshare 兜底。
- **M2**：`get_trend_indicators`（ZODB 日K → vendored compute_all 通达信口径指标摘要）；screener 离线冒烟通过。
- **M3**：`get_market_intel`（TDX MCP，无 TDX_API_KEY 降级文本）+ `make_investment_decision` 图前 enrichment（stock_information 拼接），State/图/agent 模式零改动。
- **根因修复（非计划内，spec 声称与代码不符）**：ZODBStorage spec 称"module-level singleton"但代码没有——FileStorage flock 不可重入，本环境（ZODB 6.2 + Py3.13）`__del__` 偶发无法关连接导致同进程第二个实例 LockError。落地 `get_zodb_storage()` 进程级懒单例，DataAcquisition 改用它。
- **测试**：23 个新测试（离线 mapping/qfq golden、live smoke、布尔协议、无 key 降级），全量 28 过（基线 3）/ 29 环境性失败（零新增）。stocks BTree 补种使测试自包含。
- **spec 更新**：data_source（TdxSource/vendor/mapping/qfq 约定）、core（TDX 路径 + enrichment）、data_storage（单例修正）、error-handling（包装源异常捕获点）、agents（新工具）、testing（TDX 测试 + 基线）。

## 2026-08-02 — tdx_quant 集成（task 08-02-tdx-quant-integration）收尾

- 全量回归：28 passed / 29 failed（均为环境性：缺 DASHSCOPE_API_KEY、akshare 网络不可达、`ChinaStock('dummy')` 已知损坏），归一化 diff 零新增。
- 提交：chore(tdx): integrate tdx_quant pytdx data pipeline

## 2026-08-02 — DeepSeek LLM 默认启用（task 08-02-deepseek-llm）

- 新增 `core/llms/deepseek/deepseek_api.py`：DeepSeekApi(ChatOpenAI)，默认模型
  `deepseek-v4-flash`（`DEEPSEEK_MODEL` 可切 `deepseek-v4-pro`）、base_url
  https://api.deepseek.com、`DEEPSEEK_API_KEY`；**不传 enable_search**（DashScope
  私有参数，DeepSeek 不支持——投资经理 prompt 的联网搜索指示在默认路径失效）。
- `investment_committee.py` 图装配改用 `DeepSeekApi()`；QwenApi 保留可切（改一行）。
- `display.py` key 检查兼容 `DEEPSEEK_API_KEY` 或 `DASHSCOPE_API_KEY` 任一存在。
- 无 key 时构造即抛 OpenAIError（与 QwenApi 同构，UI 层负责提示）。
- 用户提供真实 key（sk-55ea…）写入本地 .env（gitignored，不入库），live 实测
  `deepseek-v4-flash` 响应正常。
- 测试：`test/core/llms/deepseek/test_deepseek_api.py` 4 个离线用例（默认模型/
  覆盖/无 key 抛错/无私有参数）；全量 32 过（基线 28 + 4）/ 29 环境性失败不变。
