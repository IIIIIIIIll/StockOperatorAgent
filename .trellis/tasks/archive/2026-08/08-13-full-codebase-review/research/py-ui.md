# PyUi 审查报告

> 分片：Python Streamlit UI（core/ui/display.py、data_markdown.py、charts.py、theme.py、.streamlit/config.toml）
> 审查方式：纯只读代码审查（未运行测试/linter/应用）；spec 对照 `.trellis/spec/core/{index,ui,ui-data-tab,ui-theme}.md`；跨文件引用经 grep/read 核实（role_registry、progress、investment_committee、stock_output_formatter、env_file、runtime_config、tdx_source、test/e2e mock、test/core/ui）。

## 审阅覆盖

|文件|行数|结论|
|---|---|---|
|core/ui/display.py|527|有发现（2 条 INFO：report_tabs 重复实现、数据 Tab 块无错误守护；与 charts 崩溃联动见 charts 发现）|
|core/ui/data_markdown.py|384|无发现（parse-once 契约、marker 语义、N/A→None 归一均符合 spec；唯一风险点传导至 charts 消费端）|
|core/ui/charts.py|202|有发现（1 条 WARNING：candlestick/volume 对 N/A OHLC 缺 dropna → _direction TypeError；1 条 INFO：0.00% 判涨着红）|
|core/ui/theme.py|122|无发现（PALETTE 与 config.toml 逐值一致；Template 注入无 $ 冲突、无 <style> 标签、媒体查询符合 spec）|
|.streamlit/config.toml|28|无发现（[theme]/[theme.light]/[theme.dark] 与 spec 及 theme.py PALETTE 一致；无 [server] 段——ui-theme.md 未要求，不构成偏离）|

交叉核验（非本片文件，仅用于契约验证）：core/role_registry.py（ROLES/report_roles/enabled_roles）、core/llms/progress.py（ProgressBridge）、core/investment_committee.py（build_stock_information）、core/stock_output_formatter.py（日K/业绩文本形态、N/A 渲染）、utils/env_file.py（UPDATE_WHITELIST 8 键）、utils/runtime_config.py（覆盖层键表）、data_source/chinese_mainland/tdx/tdx_source.py（is_bj_ticker）、test/e2e/{mock_app,mock_committee,conftest,test_smoke,test_interaction,test_billions_tab,test_settings_panel}.py、test/core/ui/{test_display,test_charts,test_data_markdown,test_theme}.py。

## 发现

### [WARNING] candlestick/volume 图表对 N/A 开收盘价缺 dropna，_direction 比较 None 抛 TypeError，且落在无守护的数据 Tab 块

- **位置**: `core/ui/charts.py:67`（`_direction`）、`charts.py:82`（candlestick_chart 调 _direction）、`charts.py:113`（volume_chart 调 _direction）；崩溃面 `core/ui/display.py:433-445`（`with data_tab:` 块在第一个 try/except 之外）
- **问题**: `_rows_from_sections`（data_markdown.py:321-344）把日K行中 `N/A` / 不可解析值统一归一为 `None`（spec 明示 "N/A→None，失败→None 不炸"，且 `test_data_markdown.py::TestParseDailyRows::test_na_values_become_none` 用真实行形态 `"Date: 2026-07-29, Open: N/A, Close: 11.00, High: 11.05, Low: N/A, ..."` 钉死该契约，断言 `rows[0]["Open"] is None`）。而 `candlestick_chart` / `volume_chart` 在 `_direction(rows)` 中对**全部行**执行 Python 比较 `r["Close"] >= r["Open"]`——任一行的 Open 或 Close 为 `None` 即抛 `TypeError: '>=' not supported between instances of 'float' and 'NoneType'`。同模块的 `close_line_chart`（:129-132 dropna Close）、`change_percent_chart`（:147-149 dropna Change Percent）、`financial_charts`（:169-170 dropna 各指标）全部防御性 dropna 后才画图，唯 candlestick/volume 两处既不做 dropna、又是全模块仅有的 Python 级数值比较——模式不一致。崩溃发生在 `display.write_ui` 的 `with data_tab:` 渲染块（display.py:433-445），该块**不在** `build_stock_information` 的 try/except（display.py:419-431）内、也不在事件循环 try/except 内——异常直接冒泡出 write_ui，Streamlit 红屏裸 traceback，正违反 ui.md 错误守护规范（"不裸 traceback 红屏"）与 ui-data-tab.md 的 "失败→None 不炸 / 图表跳过该点" 契约。触发面：真实 TDX 路径 spec 已承认恒有 NaN 字段（历史首行振幅/涨跌幅等）；停牌日/上市首日/akshare 旧路径数据缺失时开收盘价完全可能落 N/A。
- **证据**:
  ```python
  # charts.py:65-67
  def _direction(rows, key="Close"):
      """涨跌标注（A 股约定）：Close ≥ Open → 涨，否则跌。"""
      return ["涨" if r[key] >= r["Open"] else "跌" for r in rows]
  # charts.py:81-82（candlestick_chart）
  df = pd.DataFrame(rows)
  df["Direction"] = _direction(rows)
  # charts.py:112-113（volume_chart）
  df = pd.DataFrame(rows)
  df["Direction"] = _direction(rows)
  # data_markdown.py:332-336（行构造：缺键/解析失败 → None）
  row = {date_key: pairs[date_key]}
  for key in keys[1:]:
      row[key] = _to_number(pairs.get(key, "N/A"))
  ```
- **建议**: 两图先按 OHLC 必需键 dropna 再算方向，与同模块 close/change_percent/financial 三图一致：
  ```python
  df = pd.DataFrame(rows).dropna(subset=["Open", "Close", "High", "Low"])
  if df.empty:
      return None
  df["Direction"] = _direction(df.to_dict("records"))
  ```
  volume_chart 至少 dropna(subset=["Open", "Close"])；并补一条 N/A OHLC 行的图表面向测试（现 test_charts.py 只测了 close_line_chart 的 all-N/A 跳过，未测 candlestick/volume）。
- **spec 对照**: 违反 ui-data-tab.md「数值经 _to_number 归一（…N/A→None，失败→None **不炸**）」「空数据不画空图」与 ui.md「UI 层错误守护——不裸 traceback 红屏」的契约精神。

### [INFO] display.report_tabs() 重复实现 role_registry.report_roles() 的过滤谓词

- **位置**: `core/ui/display.py:44-50`
- **问题**: 08-09-role-registry 的立意是「名册单一事实源收敛到 core/role_registry.py，不再多处手工同步」，且 `report_roles()` 的 docstring 自称「UI 渲染契约的权威列举」。但 `display.report_tabs()` 没有调用它，而是把同一过滤谓词（`state_key is not None and tab_title is not None`）内联重写了一遍。当前行为与 `report_roles()` 完全等价（谓词逐字相同），无功能问题；风险是将来谓词演进（如未来某角色 `tab_title` 可空但需占位 Tab）时两处不同步。
- **证据**:
  ```python
  # display.py:44-50
  def report_tabs():
      """报告 Tab 契约（08-09-role-registry 注册表驱动）：…"""
      return tuple(
          (r.state_key, r.tab_title)
          for r in enabled_roles()
          if r.state_key is not None and r.tab_title is not None
      )
  # role_registry.py report_roles()
  """报告类角色（有 State key + Tab 标题）——UI 渲染契约的权威列举。…"""
  return tuple(r for r in selected if r.state_key is not None and r.tab_title is not None)
  ```
- **建议**: 改为消费注册表权威列举，去掉内联谓词：
  ```python
  def report_tabs():
      return tuple((r.state_key, r.tab_title) for r in report_roles())
  ```
  （`report_roles` 需从 `core.role_registry` 导入。）
- **spec 对照**: 偏离 ui.md「08-09-role-registry：名册单一事实源收敛到 core/role_registry.py」的实现意图（行为一致，仅维护性）。

### [INFO] change_percent_chart 将 0.00% 平盘归为「涨」着红（v >= 0）

- **位置**: `core/ui/charts.py:150`
- **问题**: 涨跌幅柱的涨跌判定 `v >= 0` 把 0.00% 平盘日判为「涨」渲染红色；docstring 与 spec 均为「正值红（涨）、负值绿（跌）」——0 既非正也非负，A 股约定平盘中性色。seed fixture（fixture_002027.txt 首行 `Change Percent: 0.00%`）真实存在 0.00% 行，渲染成红柱。视觉语义轻微偏差，不涉及数据错误。
- **证据**:
  ```python
  # charts.py:150
  df["Sign"] = ["涨" if v >= 0 else "跌" for v in df["Change Percent"]]
  ```
- **建议**: 改为严格正值判涨：`["涨" if v > 0 else "跌" for v in df["Change Percent"]]`（如需平盘中性色，则给 domain 增加第三档）。
- **spec 对照**: 轻微偏离 ui-data-tab.md「正值红（涨）、负值绿（跌）」。

## spec 符合性结论

- **display.py**：REPORT_TABS 契约（report_tabs() 顺序 = 注册表 ROLES 顺序 = st.tabs 创建顺序，数据 Tab 插入不影响相对顺序）✓；观点 expander 轮次渲染（OPINION_REPORT_KEYS 派生、counts 轮次计数、n==1 展开）✓；数据 Tab（parse-once：parse_stock_info → iter_data_charts + render_sections，图前表后）✓；模块全局 committee/build_stock_information 供 mock 替换 ✓；build_stock_information 与事件循环双 try/except 守护 ✓（唯数据 Tab 渲染块未守护——与 charts WARNING 联动）；设置面板 4 分区、8 开关 + 3 上限、持久化 8 白名单键、密码不留值、_llm_configured 三键门控在面板之后 ✓；set_page_config 首个 st 调用 ✓。薄渲染层：无新增业务逻辑 ✓（唯一重复点是 report_tabs 内联谓词，INFO）。
- **data_markdown.py**：parse-once 契约（iter_sections 唯一分节实现，_rows_from_sections 从已分节 lines 推导，无二次迭代）✓；marker 语义（英文 daily/financial、中文【】通用识别、新段一行注册）✓；三种 token 形态解析与降级占位透传 ✓；列向表/扁平表判定（keysets 用**有序** tuple 比较——键序不一致自动降级扁平表，无表头错位风险）✓；日期升序（ISO 字符串可排序，TDX 路径 date 为 datetime.date、period 为 ISO 串，均已核实）✓；N/A→None 契约符合 spec（其副作用在 charts 消费端，见 WARNING）。
- **charts.py**：纯函数模块无 Streamlit import ✓；涨跌语义色与财务三线色 ✓；ordinal/名义日期轴离散编码（避免假空隙）✓；高度下限 260/320 ✓；iter_data_charts 消费 ParsedStockInfo、空数据空迭代 ✓；唯 N/A OHLC 崩溃缺口（WARNING）与 0.00% 着色（INFO）。
- **theme.py**：PALETTE 亮暗双色板与 config.toml 逐值一致（#D32F2F/#FFFFFF/#F6F7F8/#31333F/0.5rem vs #EF5350/#0E1117/#262730/#FAFAFA/0.5rem）✓；Template($) 注入无 % 冲突、CSS 无 <style> 标签、媒体查询偏好色块 ✓。
- **config.toml**：符合 ui-theme.md（base/light/dark 分表、baseRadius、font）；无 [server] 段——spec 未要求，非偏离。
- **e2e mock 契约**：display 与 FakeGraph 7 key + 双观点轮次、[role="tab"] 渐进渲染、7/8 Tab 条件化断言全部对得上；mock_app 替换模块全局（display.committee / display.build_stock_information）的机制成立（write_ui 调用时按全局名解析）。

## 发现统计

- CRITICAL: 0
- WARNING: 1（charts.py N/A OHLC → TypeError，数据 Tab 无守护红屏）
- INFO: 2（report_tabs 重复谓词；0.00% 判涨）
