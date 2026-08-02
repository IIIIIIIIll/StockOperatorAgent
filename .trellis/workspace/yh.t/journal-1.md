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

## 2026-08-02 — akshare 升级（task 08-02-akshare-upgrade）

- 升级 akshare 1.18.25 → 1.18.81（落后 56 版本）。**升级前源码级对比**（pip
  download 新版 whl 解包 grep 列定义）确认 4 个使用中接口列序零变化：
  `stock_zh_a_hist` / `stock_*_a_spot_em` / `stock_yjbb_em` /
  `stock_individual_info_em` —— 升级零风险。
- **重大发现（既有疑点，未修）**：akshare 源码显示 `stock_zh_a_hist` 的
  "股票代码"列在**末尾**（日期,开盘,收盘,最高,最低,成交量,成交额,振幅,涨跌幅,
  涨跌额,换手率,股票代码），`stock_*_a_spot_em` 第 2 列是 "_" 占位——与位置
  构造假设（ticker 第 2 位）不匹配。本环境东财端点不可达无法实测；用户环境若
  真错位会有数据错乱。待"数据获取流程梳理"任务在可通网络下实测后统一修复。
  注意：TDX 路径的 mapping.py 12 列序与 ChinaStockData 字段对齐，不受影响。
- 回归：29F/32P 与升级前完全一致，零新增失败（test_acquire_historical_data_failed
  偶发翻转，ZODB 状态依赖）。pip check 无 akshare 相关冲突。
- 测试环境耦合修复：test_get_market_intel 的降级断言显式清 TDX_API_KEY
  （开发者配置 key 后测试曾误挂）。
- 后续任务：数据获取流程梳理（实测 akshare 输出列序 → 修复位置映射 → TDX/akshare
  分工重构）。


## Session 1: TDX 覆盖个股概览与业绩报告，主流程纯 TDX

**Date**: 2026-08-02
**Task**: TDX 覆盖个股概览与业绩报告，主流程纯 TDX
**Branch**: `master`

### Summary

M1 概览层（overview.py 22 列序 + get_stock_name 名称索引，离线 golden + live 全绿）；M2 业绩层（reports.py F10 pivot 15 列序 + QoQ 自算）；M3 流程重构（ensure_stock / acquire_performance_report_tdx / get_stock_data 纯 TDX 无 akshare 回退）。实现中修正 design 三处契约：22 列无 [1:] 切片、_NAME_INDEX 用 (market,code) 键、15 列含 ticker。akshare/qwen 及 DeepSeek live 测试标记 deprecated（全量回归 20+ 分钟挂起 → 8F/59P/20S 3.5 分钟，8F 全为既有环境性失败）。README + 5 个 spec 更新。一并归档 akshare-upgrade / deepseek-llm / tdx-quant-integration 三个已完成任务。

### Git Commits

| Hash | Message |
|------|---------|
| `62cc2db` | (see git log) |

### Status

[OK] **Completed**


## Session 2: 根治 ZODB 锁泄漏与已知测试失败（全量 8F → 0F）

**Date**: 2026-08-02
**Task**: 根治 ZODB 锁泄漏与已知测试失败（全量 8F → 0F）
**Branch**: `master`

### Summary

根治性修复：ZODBStorage.__del__ 锁泄漏（transaction.abort() + try/except，实测 ZODB 6.0.1）；test_ZODBStorage 改用进程级单例（同进程单连接契约）；ChinaStock 三参数构造 + 完整 ChinaStockData 字段 + 递增 date（datetime vs date 不可比隐藏坑）；test_exist_* 断言语义契约化（未构建→None + _seed_stock 自包含）；test_need_update 基准与实现一致；test_storage 改专用 ticker；杂项（类名/重复定义/time_helper 断言）。全量 8F/59P/20S → 0F/67P/20S，2.6 分钟，无 traceback 噪音。另完成 gm（MyQuant）数据源调研：3.0.177 为完整 cp313 包，set_token 通过，缺掘金终端 live 待 Windows 侧确认。

### Git Commits

| Hash | Message |
|------|---------|
| `295ef48` | (see git log) |

### Status

[OK] **Completed**


## Session 3: 修复代码库审计发现的 27 项问题（4 子任务树，全量 112P/0F）

**Date**: 2026-08-02
**Task**: 修复代码库审计发现的 27 项问题（4 子任务树，全量 112P/0F）
**Branch**: `master`

### Summary

双代理全库审计 27 项（3 高/10 中/14 低）按父任务+4 子任务树修复并全部归档：① 数据正确性（key 检查只认 DEEPSEEK、120 根永久缺口全量回填、yjbb 列名映射例外、asia_today 时区统一、拉未来报告期、date==datetime 恒假）；② TDX 派生（fmt_number 无 nan 渲染、industry 空串、adjust 因子污染+int64 舍入、QoQ 相邻、ytd 首日、名称索引重试、BJ 拒绝）；③ 环境稳健（REPO_ROOT 锚定三路径、security_list 读缓存实现、daily 文档真相）；④ 死代码清理（enrichment 接入真实流程 build_stock_information、update_overview 槽位、akshare 块标注+惰性 import、prompt 插值/残留、单例线程锁、UI 守护）。测试 67P→112P（+45 用例），全量 112P/20S/0F 2.5 分钟，8 个 spec 同步，deprecated 20 skip 零改动。另有 gm（MyQuant）SDK 3.0.177 装好待 Windows 终端连通后验证。

### Git Commits

| Hash | Message |
|------|---------|
| `98cb3c6` | (see git log) |
| `885e727` | (see git log) |
| `963db53` | (see git log) |
| `ce29d47` | (see git log) |

### Status

[OK] **Completed**


## Session 4: 业绩报告 freshness 门（ZODB 优先免重复拉 F10）

**Date**: 2026-08-02
**Task**: 业绩报告 freshness 门（ZODB 优先免重复拉 F10）
**Branch**: `master`

### Summary

acquire_performance_report_tdx 加 ZODB 优先 freshness 门：最新 report_date 命中最近季度末（_latest_past_quarter_end）即跳过远端 F10（debug+True），披露滞后语义保持（未披露继续拉、入库去重）。_fetch_reports 注入点实现无 mock 测试（计数包装证明门命中零网络）。+4 用例，全量 116P/20S/0F。

### Git Commits

| Hash | Message |
|------|---------|
| `f26a85c` | (see git log) |

### Status

[OK] **Completed**
