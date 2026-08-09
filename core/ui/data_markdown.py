"""采集数据 → markdown 表格（08-02-ui-data-markdown-tables）与图表数据
解析（08-06-ui-data-charts）。

把 build_stock_information 拼好的定宽文本（overview 单行 + 60 根日K +
20 条业绩 + 技术指标 + 实时情报）转换为带表格的 markdown，供「采集数据」
Tab 渲染；并导出结构化行（parse_daily_rows / parse_financial_rows）供
charts.py 画图。纯函数、无 Streamlit/无 I/O——离线测试喂合成输入（house
style，与 iter_report_items 同约定）。

**约束**：stock_information 同时是 LLM 上下文（build_stock_information
唯一组装点，display 与 make_investment_decision 共用）——本模块只改
展示端，源头文本零改动。

**parse-once 边界（08-09-structured-enrichment-sections）**：
`parse_stock_info(text)` 是**唯一解析入口**——iter_sections 一次产出
全部节，daily/financial 行由 `_rows_from_sections` 从已分节的 lines 推导
（不对 text 二次迭代）。display 采集 Tab 消费其产物：图表走
`charts.iter_data_charts(parsed)`、表格走 `render_sections(parsed.sections)`
——都不再接触原始文本。`iter_sections` / `parse_daily_rows` /
`parse_financial_rows` / `to_markdown_tables` 公共签名与输出不变（内部
重构共用 `_rows_from_sections` / `render_sections`，既有测试全绿即等价
证明）。

分节逻辑集中在 iter_sections（to_markdown_tables 与 parse_* 共用同一
迭代器，marker 语义单一实现，不双份）。新段 = 生产者输出文本（含
marker 行）+ `_SECTION_TITLES` 注册标题**一行**——`_marker_section`
通用识别，`render_sections` 通用表格自动渲染（表格零代码；图表需显式
映射）。

格式认知（2026-08-02 实测三个生产者的输出）：
- 行内 token 由 ', ' 分隔，三种键值形态：'Key: value'（概览/日K/业绩/
  情报）、'Key=value'（指标段内 K=V 对）、'label value'（业绩段 YoY/
  QoQ 等无冒号标签 + 数值后缀）。
- 指标行 'label: K=V, K=V' 的 label 与首个 K=V 融合在同一 token——value
  含 '=' 时递归展开（丢弃 label，保留 K=V 对）。
- 降级占位文本（'（无 ... 跳过技术指标）' 等）无键值形态 → 原样透传
  （不吞降级信息）。
- 同节**多行且键集合一致** → 列向表（首行键为表头，日K/业绩多行场景）；
  单行或键集合不一致 → 两列扁平表（指标 | 数值，每对一行，概览/指标/
  情报单行场景）。键经 KEY_LABELS 转中文，未知键原样。
"""

import re
from dataclasses import dataclass

# 已知字段 key → 中文标签；未登记的 key 原样透传（不炸不丢）。
# 技术指标标识符类（MA5/RSI6/BOLL_UP 等）显式登记为原文——避免误以为
# 漏映射，也挡住将来可能的改名。
KEY_LABELS = {
    # 概览（format_stock_output 前 5 行）
    "Stock": "股票名称",
    "Latest price": "最新价",
    "Dynamic PE": "动态市盈率",
    "Pb": "市净率",
    "Momentum": "动量",
    # 日K 行（8 键）
    "Date": "日期",
    "Open": "开盘价",
    "Close": "收盘价",
    "High": "最高价",
    "Low": "最低价",
    "Change Percent": "涨跌幅",
    "Volume": "成交量",
    "Turnover Rate": "换手率",
    # 业绩行（9 键）
    "Report Date": "报告日期",
    "EPS": "每股收益",
    "Net Profit": "净利润",
    "Net Profit YoY percent": "净利润同比",
    "Net Profit QoQ percent": "净利润环比",
    "Net worth per share": "每股净资产",
    "Return on Equity percent": "净资产收益率",
    "Cash flow per share": "每股现金流",
    "Sales gross margin percent": "销售毛利率",
    # 技术指标（标识符类保持原文）
    "MA5": "MA5", "MA10": "MA10", "MA20": "MA20", "MA60": "MA60",
    "EMA5": "EMA5", "EMA10": "EMA10", "EMA20": "EMA20", "EMA60": "EMA60",
    "DIF": "DIF", "DEA": "DEA", "MACD": "MACD",
    "RSI6": "RSI6", "RSI12": "RSI12", "RSI24": "RSI24",
    "K": "K", "D": "D", "J": "J",
    "BOLL_UP": "BOLL_UP", "BOLL_MB": "BOLL_MB", "BOLL_DN": "BOLL_DN",
    "ATR": "ATR",
    "VOL_RATIO": "量比", "VOL_MA5": "5日均量", "TURNOVER_RATE": "换手率",
}

# 节标记行 → 节标题（strip 后精确匹配）
_SECTION_TITLES = {
    "overview": "股票概览",
    "daily": "近 60 日行情",
    "financial": "近 20 期财务摘要",
    "intel": "实时市场情报",
    # 08-02-f10-financial-indicator-sections：盈利能力指标段（get_financial_
    # indicators 输出，与【技术指标（...）】同形态）——独立成节渲染，不混入
    # 技术指标节。后续新增指标段（偿债/发展能力）各加一个 marker 即可。
    "profitability": "盈利能力指标",
    # 08-08-billions-api-integration：亿信 fin-db 前置段（get_billions_
    # financial_intel 输出，标题【亿信金融数据库】+ 上游 Markdown 表格）
    # ——独立成节渲染，不并入情报节。content 是 Markdown 表格（'| 指标 |
    # 数值 |' 形态，无 'Key: value' 对）→ 全部走 passthrough 原样透传。
    "billions": "亿信金融数据库",
}


@dataclass(frozen=True)
class ParsedStockInfo:
    """解析一次的结构化采集段（08-09-structured-enrichment-sections）。

    display 采集 Tab 的消费形态：sections 交 render_sections 渲染表格，
    daily_rows / financial_rows 交 charts.iter_data_charts 画图——都不再
    接触原始文本。sections 是 iter_sections 输出；行与 parse_daily_rows /
    parse_financial_rows 输出同构（同一 _rows_from_sections 推导）。
    """

    sections: tuple = ()
    daily_rows: tuple = ()
    financial_rows: tuple = ()


def _marker_section(line: str):
    """'【标题】' 或 '【标题（日期）】' marker 行 → (sid, title)；未注册 → None。

    通用新段注册（08-09-structured-enrichment-sections）：标题前缀命中
    `_SECTION_TITLES` 值 → 新节（sid = 键，title = 标题去【】原样）——
    新段 = 生产者 marker 行 + `_SECTION_TITLES` 注册**一行**，表格零代码。
    指标类节（技术指标/盈利能力指标）前缀特判（日期随标题保留，且不查
    `_SECTION_TITLES`——其 sid indicators 不入注册表）。未知 marker →
    None（归当前节，与 08-02 行为一致）。
    """
    if not (line.startswith("【") and line.endswith("】")):
        return None
    inner = line[1:-1]
    prefix = inner.split("（")[0]
    if prefix in ("技术指标", "盈利能力指标"):
        return ("indicators" if "技术" in line else "profitability", inner)
    for sid, title in _SECTION_TITLES.items():
        if prefix == title:
            return (sid, title)
    return None


def _is_numberish(value: str) -> bool:
    """'label value' 形态的数值判定：数值 / 带 % / lots 后缀 / N/A。"""
    s = value.strip()
    for suffix in ("%", "lots"):
        if s.endswith(suffix):
            s = s[:-len(suffix)]
    if s.upper() == "N/A":
        return True
    return bool(re.fullmatch(r"[+-]?\d+(\.\d+)?", s))


def _parse_token(token: str):
    """单个 token → (key, value)；无键值形态 → None。

    三种形态：'Key: value'、'Key=value'、'label 数值/N/A'（业绩段
    无冒号标签——rpartition 空格取数值后缀，仅数值才算键值，挡住
    降级占位文本被误拆）。
    """
    t = token.strip()
    if not t:
        return None
    if ":" in t:
        key, _, value = t.partition(":")
    elif "=" in t:
        key, _, value = t.partition("=")
    else:
        key, _, value = t.rpartition(" ")
        if not key or not _is_numberish(value):
            return None
    key, value = key.strip(), value.strip()
    return (key, value) if key and value else None


def _pairs(line: str):
    """一行 → [(key, value), ...]；无键值形态 → None（降级占位透传）。

    容忍部分 token 不可解析（如值内含逗号的情报行）——可解析的保留、
    不可解析的跳过；整行无对才判非数据行。指标行 'label: K=V' 融合
    token：value 含 '=' 时递归展开（丢弃 label，保留 K=V 对）。
    """
    pairs = []
    for token in line.split(", "):
        pair = _parse_token(token)
        if pair is None:
            continue
        key, value = pair
        if "=" in value:
            pairs.extend(_pairs(value))
        else:
            pairs.append(pair)
    return pairs or None


def _render_table(rows) -> str:
    """[(key, value), ...] 行集合 → markdown 表格字符串。

    所有行键集合一致 → 列向表（首行键为表头，键经 KEY_LABELS 转中文）；
    否则 → 两列扁平表（指标 | 数值，每对一行）。
    """
    def label(key):
        return KEY_LABELS.get(key, key)

    keysets = {tuple(k for k, _ in row) for row in rows}
    if len(rows) > 1 and len(keysets) == 1:
        keys = tuple(k for k, _ in rows[0])
        header = "| " + " | ".join(label(k) for k in keys) + " |"
        sep = "| " + " | ".join("---" for _ in keys) + " |"
        body = ["| " + " | ".join(v for _, v in row) + " |" for row in rows]
        return "\n".join([header, sep, *body])
    header = "| 指标 | 数值 |"
    sep = "| --- | --- |"
    body = [f"| {label(k)} | {v} |" for row in rows for k, v in row]
    return "\n".join([header, sep, *body])


def iter_sections(stock_info: str):
    """分节迭代器（08-06-ui-data-charts 抽出）：yield (section_id, title, lines)。

    section_id: overview / daily / financial / indicators / profitability /
    intel / billions / 新注册段；title: 展示标题（指标类节去【】保留日期）；
    lines: 节内原始行（strip 后，含降级占位文本）。marker 语义与 08-02
    版本逐一等价——to_markdown_tables 与 parse_daily_rows /
    parse_financial_rows 共用同一实现，不双份分节逻辑。

    marker：----------- 与空行丢弃；'Last 60 days prices:' / 'Last 20
    financial abstracts:' 起日K/业绩节；其余 marker 统一走
    `_marker_section` 通用识别（08-09-structured-enrichment-sections）：
    '【技术指标（...）】' / '【盈利能力指标（...）】' 起指标节
    （08-02-f10-financial-indicator-sections：独立成节，否则指标行混进
    技术指标表）；'【实时市场情报】' 起情报节；'【亿信金融数据库】' 起
    亿信问数节（08-08-billions-api-integration：fin-db 上游 Markdown
    表格，独立成节不并入情报节）；`_SECTION_TITLES` 新注册标题 → 新节。
    其余行归属当前节（首个非 marker 行隐式起 overview 节）。
    """
    section = None  # (section_id, title, lines)
    for raw_line in stock_info.splitlines():
        line = raw_line.strip()
        if not line or line == "-----------":
            continue
        if line in ("Last 60 days prices:", "Last 20 financial abstracts:"):
            if section:
                yield section
            sid = "financial" if "financial" in line else "daily"
            section = (sid, _SECTION_TITLES[sid], [])
            continue
        marker = _marker_section(line)
        if marker is not None:
            if section:
                yield section
            section = (marker[0], marker[1], [])
            continue
        if section is None:
            section = ("overview", _SECTION_TITLES["overview"], [])
        section[2].append(line)
    if section:
        yield section


def render_sections(sections) -> str:
    """已分节 sections → markdown（加粗分节标题 + 表格 + 占位透传）。

    to_markdown_tables 的渲染半（08-09-structured-enrichment-sections
    抽出）：display 用 `render_sections(parsed.sections)` 零重复解析；
    每节内键值行聚成表格（_pairs），非键值行（降级占位）原样透传。
    新段内容为 'Key: value' 形态 → 通用表格自动渲染（_pairs/_render_table
    零改动）。
    """
    blocks = []
    for _sid, title, lines in sections:
        blocks.append(f"**{title}**")
        rows, passthrough = [], []
        for line in lines:
            pairs = _pairs(line)
            if pairs:
                rows.append(pairs)
            else:
                passthrough.append(line)
        if rows:
            blocks.append(_render_table(rows))
        blocks.extend(passthrough)
    return "\n\n".join(blocks)


def to_markdown_tables(stock_info: str) -> str:
    """stock_information 文本 → markdown（加粗分节标题 + 表格 + 占位透传）。

    公共签名与输出不变（08-09 重构为 parse-once 的渲染半——分节一次
    iter_sections，渲染走 render_sections）；text 入口保留（既有测试 /
    e2e 种子 fixture）。分节见 iter_sections。
    """
    return render_sections(tuple(iter_sections(stock_info)))


def _to_number(value: str):
    """'1.23%' / '123456.00lots' / 'N/A' → float(1.23 / 123456.0 / None)。

    复用 _is_numberish 的后缀剥离（% / lots / N/A），剥离后 float；
    解析失败（异常形态）→ None（图表跳过该点，不炸）。
    """
    s = value.strip()
    for suffix in ("%", "lots"):
        if s.endswith(suffix):
            s = s[:-len(suffix)]
    if s.upper() == "N/A":
        return None
    try:
        return float(s)
    except ValueError:
        return None


# 日K / 业绩节的行键序（图表解析契约；表格渲染 KEY_LABELS 独立演进）
_DAILY_KEYS = ("Date", "Open", "Close", "High", "Low",
               "Change Percent", "Volume", "Turnover Rate")
_FINANCIAL_KEYS = ("Report Date", "EPS", "Net Profit",
                   "Net Profit YoY percent", "Net Profit QoQ percent",
                   "Net worth per share", "Return on Equity percent",
                   "Cash flow per share", "Sales gross margin percent")


def _rows_from_sections(sections, sid: str, date_key: str, keys: tuple) -> list:
    """已分节 sections → 结构化行（08-09 parse-once 内部推导，**不再对
    text 二次迭代**）。

    每行复用 _pairs（兼容 'Open:' 无空格等真实格式）；date_key 保留原始
    字符串，其余键数值归一（_to_number：去 %/lots 后缀、N/A→None）；
    按 date_key **升序**（源头顺序取决于 storage，图表统一旧→新）；无
    对应节或行无 date_key → []。parse_daily_rows / parse_financial_rows
    与 parse_stock_info 共用同一实现（行结构同构）。
    """
    rows = []
    for section_id, _title, lines in sections:
        if section_id != sid:
            continue
        for line in lines:
            pairs = {k: v for k, v in (_pairs(line) or [])}
            if not pairs.get(date_key):
                continue
            row = {date_key: pairs[date_key]}
            for key in keys[1:]:
                row[key] = _to_number(pairs.get(key, "N/A"))
            rows.append(row)
    rows.sort(key=lambda r: r[date_key])
    return rows


def parse_stock_info(stock_info: str) -> ParsedStockInfo:
    """文本 → ParsedStockInfo（**解析一次**，08-09 结构化边界）。

    iter_sections 一次产出全部节；daily/financial 由 _rows_from_sections
    从已分节的 lines 推导——不再对 text 二次迭代。display 采集 Tab 消费
    本函数产物（图表/表格都不再接触原始文本）。空/占位文本 → sections
    空元组（daily/financial 相应为空，图表空迭代、表格仅占位透传）。
    """
    sections = tuple(iter_sections(stock_info))
    return ParsedStockInfo(
        sections=sections,
        daily_rows=tuple(_rows_from_sections(sections, "daily", "Date", _DAILY_KEYS)),
        financial_rows=tuple(_rows_from_sections(
            sections, "financial", "Report Date", _FINANCIAL_KEYS)),
    )


def parse_daily_rows(stock_info: str) -> list:
    """日K节 → 结构化行（08-06-ui-data-charts）。

    公共签名与输出不变（08-09 重构为 parse-once 推导：
    `_rows_from_sections(tuple(iter_sections(text)), ...)`）。每行复用
    _pairs（兼容 'Open:' 无空格等真实格式）；Date 保留原始字符串，其余
    7 键数值归一（_to_number：去 %/lots 后缀、N/A→None）；按 Date 升序
    （源头顺序取决于 storage，图表统一旧→新）；无日K节或行无 Date → []。
    """
    return _rows_from_sections(tuple(iter_sections(stock_info)),
                               "daily", "Date", _DAILY_KEYS)


def parse_financial_rows(stock_info: str) -> list:
    """业绩节 → 结构化行（08-06-ui-data-charts）；Report Date 升序；
    数值归一同 parse_daily_rows；无业绩节 → []。

    公共签名与输出不变（08-09 重构为 parse-once 推导，同 parse_daily_rows）。
    """
    return _rows_from_sections(tuple(iter_sections(stock_info)),
                               "financial", "Report Date", _FINANCIAL_KEYS)
