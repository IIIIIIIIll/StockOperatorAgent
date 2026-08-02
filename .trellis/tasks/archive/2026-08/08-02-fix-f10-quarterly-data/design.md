# Design：F10 季度数据修复（vendor 零改动）

## 1. 背景与约束

- 根因：vendor `parse_finance_indicators`（`tdx_company_info.py:95`）遇
  第二个日期头行 `break`——F10 页面表 2（含季度）整体丢弃。
- 硬约束：VENDOR.md——vendor 子树零改动（更新=重新拷贝上游）；严禁
  静默分叉。修复全部在非 vendor 层。
- 好消息：`company_info_raw` parquet 缓存了**完整四张表 raw 文本**
  （`data/tdx_cache/company_info_raw/ts_code=<TS>/data.parquet` 的
  `text` 列）——重灌/修复**零网络**，纯离线。

## 2. 数据流现状与目标

```
现状（丢季度）:
  TdxSource.fetch_company_finance (vendor 解析, 6期)
      → reports.build_reports → compose_reports → ZODB

目标（含季度）:
  raw 文本 (company_info_raw 缓存, 完整四表)
      → 新解析器 (非 vendor, 合并表1+表2, 9期)
      → compose_reports (零改动, 输入 schema 一致)
      → ZODB
  raw 缺失 → 回退 vendor 解析 df (6期, 可用不阻断)
```

## 3. 组件设计

### 3.1 新解析器：`data_source/chinese_mainland/tdx/f10_parser.py`（新文件）

- `parse_finance_indicators_all_tables(text: str) -> pd.DataFrame`
  - 输出列：`metric / period / value_raw / value_num`（**无 ts_code 列**
    ——compose_reports 只消费 metric/period/value_num 三列，见 §3.3 验证；
    ts_code 由调用方/上游概念持有，解析器不关心）。
  - 逻辑：找 `【主要财务指标】` 起始（无 → 空 DataFrame）→ 块延伸到
    下一个 `\n【` → 遍历块内含 `｜` 的行：
    - 日期头行（≥2 个 `YYYY-MM-DD` cell）：**首个设 periods，后续的
      子表不 break——按行号切换为"换表"标记**（关键改动）。
    - 数据行：metric = 首 cell，values = 其余 cell 按当前 periods
      zip——（metric, period, value）三元组全部收进 records。
  - 去重：同 (metric, period) 多行 → 后写覆盖（表 2 与表 1 同值，
    取哪个都行；`dict` 以 (metric, period) 为键）。
  - 数值归一：复用 vendor 语义（`亿`/`万` 后缀 → ×1e8/×1e4；`-`/`--`/
    `—`/`null`/空 → NaN；不可解析 → NaN）——**自实现 ~20 行**，不
    import vendor 内部函数（vendor 升级不破坏）。
  - 子表边界：表 1 与表 2 之间无【】分节标记（同块内连续两张表），
    靠"新的日期头行"识别；表 2 后出现的下一节（如【盈利能力指标】）
    由 `\n【` 截断天然排除（vendor 同款块截断）。
- 纯函数、无 I/O——离线测试喂真实 raw 文本切片。

### 3.2 raw 文本读取：`TdxSource.fetch_company_finance_raw`

- `tdx_source.py`（非 vendor，可改）新增方法：
  `fetch_company_finance_raw(ticker: str) -> str | None`
  - 读 `parquet_root / company_info_raw / ts_code=<TS> / data.parquet`
    的 `text` 列（ts_code 映射复用 `market_code_to_ts_code`——vendor
    模块 import 已有先例：tdx_source 已封装 vendor downloader）。
  - 文件缺失/空/损坏/列缺失 → `None`（不 raise，error-handling 约定）。
  - **只读缓存，不触发网络**——与 download_company_finance（拉取+
    写缓存）分离，重灌零网络。

### 3.3 `reports.build_reports` 改造（唯一消费者）

```python
def build_reports(ticker, _scope=None):
    src = TdxSource()
    name = src.get_stock_name(ticker)

    # 首选：raw 文本 → 新解析器（含季度）
    raw = src.fetch_company_finance_raw(ticker)
    if not raw:
        # 首次无缓存：确保拉取（写 raw），scope 去重不重复拉
        fetcher = _scope or src
        try:
            fetcher.fetch_company_finance(ticker)
        except Exception:
            pass  # 降级链继续
        raw = src.fetch_company_finance_raw(ticker)
    if raw:
        try:
            f10_df = parse_finance_indicators_all_tables(raw)
            reports = compose_reports(ticker, name, f10_df)
            if reports is not None:
                return reports
        except Exception:
            logger.warning(...)  # 解析失败 → 回退

    # 回退：vendor 解析 df（无季度，可用不阻断）
    fetcher = _scope or src
    try:
        f10_df = fetcher.fetch_company_finance(ticker)
    except Exception:
        logger.warning(...)
        return None
    if f10_df is None or f10_df.empty:
        logger.warning(...)
        return None
    return compose_reports(ticker, name, f10_df)
```

- 语义：raw 路径失败任何环节 → 回退 vendor 路径（现状行为不变）。
- `compose_reports` 零改动：其 `f10_df` 只依赖 `metric/period/value_num`
  三列（`sub = f10_df[f10_df["metric"].isin(known)]`，`dropna(period)`，
  pivot 按 period）——新解析器输出直接消费；ts_code 列不在依赖里。
- `_qoq_series` 零改动：输入多了季度 period 后 88–93 天相邻校验自然
  通过（2025-03-31→06-30→09-30→12-31 间隔 91/92/92 天）。

### 3.4 overview 不动

- `overview.py` 走 `fetch_company_finance`（vendor df）→
  `latest_period_value` 取最大 period——最新期仍是 2026-03-31，不受
  新增季度影响。**overview 保持 vendor 路径**（它只需要最新期，
  不需要季度；vendor 6 期已够）。

### 3.5 存量重灌：`scripts/backfill_f10_quarters.py`（新脚本）

- 遍历 `company_info_raw/*/data.parquet` 的 ts_code → 反解 ticker
  （ts_code `XXXXXX.SH/.SZ` → 6 位码）→ 对每只股票：
  `build_reports(ticker)`（现在走 raw 解析，含季度）→ 若返回非 None →
  批量更新 ZODB：`add_performance_reports`（report_date 字符串去重，
  合并新季度、保留已有期）→ `put_stock` → commit。
- **绕过 freshness 门**：直接调 reports 层 + storage 写入，不走
  `acquire_performance_report_tdx`（其门会跳过）。
- 幂等：report_date 去重（add_performance_reports 既有语义）——
  重跑安全。
- 默认全量重灌（脚本无参跑全部缓存股票）；可加 `--ticker 000001`
  限定单只（设计实现时定，PRD 验收用 000001）。
- 无 raw 缓存的股票 → 跳过（不触发网络；要联网补的股票走正常分析
  路径，下次分析自动走新解析器）。

## 4. 测试设计

- `test/data_source/test_tdx_reports.py` 新增（或新文件
  `test_f10_parser.py`）：
  - 真实 raw 文本切片（从 `data/tdx_cache/company_info_raw/` 取
    000001 完整 text）→ `parse_finance_indicators_all_tables` 产出
    9 期（2021-2025 年报 + 2025-03-31/06-30/09-30 + 2026-03-31），
    (metric, period) 去重。
  - 合成文本：只有表 1（无第二日期头）→ 正常 6 期；表 2 与表 1
    同 (metric, period) 数值不同 → 去重取其一；`亿/万` 归一；
    `-` → NaN；无【主要财务指标】→ 空。
  - `compose_reports` 含季度输入 → QoQ 正确（2025 Q2 vs Q1 环比值）、
    跨年位置（2024-12-31→2025-03-31 间隔 91 天 → 也有环比——注意
    环比对跨年是"合法"的，验证数值）。
  - `build_reports` raw 路径/回退路径（注入假 fetcher 或 monkeypatch
    fetch_company_finance_raw 返回 None → 走 vendor 回退）。
  - 重灌脚本：对 000001 跑 → ZODB 出现 20250331/20250630/20250930；
    再跑一遍 → 幂等（期数不翻倍）。
- 既有测试不动：`test_tdx_reports.py` 现有 golden（6 期）若因真实
  缓存变化失败 → 更新为新 9 期 golden。

## 5. 兼容性与风险

- **风险 1：raw 缓存不存在**（从未拉过的股票）→ 回退 vendor 6 期
  （现状），下次成功拉取后自动含季度。可接受。
- **风险 2：表 2 对某些股票不存在**（页面只有一张表）→ 解析器自然
  产出 6 期，与现状一致。已实测 4 股均有表 2。
- **风险 3：表 2 与表 1 同 (metric, period) 值不同**（口径漂移）→
  去重取后写（表 2 后出现）。实测同值；若不同，表 2 与表 1 都是
  累计口径、以表 2 为准合理。
- **风险 4：QoQ 对跨年边界**：2024-12-31 → 2025-03-31 间隔 91 天，
  _qoq_series 会算环比（此前 6 期无此相邻对，行为新增）——这是
  季度齐全后的正确扩展，测试钉死。
- **不回退**：vendor 零改动；overview 零改动；compose_reports 零
  改动；FetchScope 零改动（raw 读取绕过 scope 直读缓存——raw 是
  本地 parquet 读取，无网络无去重需求；_scope 语义不受影响）。

## 6. 边界

- 表 3/4（【盈利能力指标】节 `财务指标(%)`）不解析——vendor 也不
  解析，非本任务范围。
- akshare 业绩报表路径（deprecated）不动。
- UI 不改（采集数据 Tab 自动显示更多行——数据驱动）。
