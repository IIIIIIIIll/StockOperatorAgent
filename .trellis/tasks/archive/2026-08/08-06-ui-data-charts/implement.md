# 执行计划:数据采集 Tab 图表可视化

## 实施前置(gates)

- [ ] 全局搜既有图表/altair 代码:`grep -rn "altair\|st.line_chart\|st.bar_chart\|st.altair_chart" core/ test/`(确认无重复实现)。
- [ ] 确认无 `streamlit run main.py` 在跑(回归互斥)。

## 实施步骤(顺序执行)

1. **data_markdown.py 重构 + 解析函数**
   - 抽出 `iter_sections(stock_info)`(分节迭代器,marker 语义与现状一致);`to_markdown_tables` 改为消费它(输出逐字节不变,既有 16 用例兜底)。
   - 新增 `_to_number(value)` helper(复用 `_is_numberish` 后缀剥离,float,失败→None)。
   - 新增 `parse_daily_rows` / `parse_financial_rows`(复用 `_pairs`;日期升序;无节→[])。
2. **charts.py(新模块,纯函数)**
   - 色板常量:涨 `#E03131` / 跌 `#0E9F6E`(候选,浏览器实测调)。
   - `candlestick_chart` / `volume_chart` / `close_line_chart` / `change_percent_chart` / `financial_charts` + `iter_data_charts`。
   - 统一:background transparent、中文 y 轴标题、tooltip、空输入→None/[]。
3. **display.py 接线**
   - 数据 Tab:markdown 表格后 `for title, chart in charts.iter_data_charts(...)` → subheader + `st.altair_chart(use_container_width=True)`;空 → 跳过。
4. **测试**
   - `test_data_markdown.py` 增 `TestParseDailyRows`/`TestParseFinancialRows`(含乱序输入→升序、N/A、无节)。
   - 新 `test/core/ui/test_charts.py`(altair spec 断言:marks/encoding/红绿/顺序;无 streamlit import)。
   - `test_display.py` 增接线 ast 测试(数据 Tab 调 st.altair_chart)。
5. **离线验证**:`python3 -m pytest test/core/ui/ -q`(全绿)。
6. **浏览器实测**(用户验收):亮/暗两主题下图表可读、红涨绿跌、缩放/悬浮;不可读 → 调色板重验。
7. **全量回归**:确认无 streamlit 进程后 `python3 -m pytest -q`(门槛 0 新增失败;共享 DB 脏 → 连跑两遍)。
8. **spec 更新**:core/index.md UI 段增补:data_markdown 分节/解析纯函数契约、charts.py 契约(输入 parse_* 输出、红涨绿跌、streamlit chart theme 管背景、MA 记为后续增强)。
9. **提交 + 收尾**(本次走完 3.5):
   - `feat(ui): 采集数据 Tab 图表可视化(K线红涨绿跌/成交量/财务折线)`(代码+测试)
   - `docs(spec): core UI 段增补图表契约`
   - `chore(task): 08-06-ui-data-charts 任务工件`
   - `add_session.py` 记 journal + `task.py archive` 归档(commit message 遵循 house style,均带 Co-Authored-By)。

## 验证命令清单

| 命令 | 期望 |
|---|---|
| `grep -rn "altair" core/ test/` | 仅 charts.py/display.py/测试 |
| `python3 -m pytest test/core/ui/ -q` | 全绿(离线秒级) |
| `python3 -m pytest -q` | 0 新增失败(先停 streamlit) |
| `streamlit run main.py` | 浏览器验收(步骤 6) |

## 回滚点

- 每步独立可回滚;最终回滚 = 删 charts.py/test_charts.py、还原 display.py、`git revert` data_markdown 重构 commit。无数据风险。
- 提交前若浏览器实测发现红绿/暗色可读性问题 → 停在第 6 步调色重测,不带着未验收的样式提交。
