"""F10 盈利能力指标工具：把【盈利能力指标】分节转成最新报告期的中文摘要。

数据链：F10 raw 缓存（company_info_raw parquet，零网络）→
f10_parser.parse_indicator_section（非 vendor 解析器，年报表+季度表全部
并入）→ 最新报告期每指标一行中文摘要，供 agent 阅读。

约定（对齐 error-handling spec）：失败不 raise，返回占位文本（图可继续）——
raw 缓存缺失 / 解析失败 / 无该分节均降级。与 get_trend_indicators /
get_market_intel 同构：工具在函数内 import（无模块级副作用，无 key /
无缓存环境不炸）。

指标集（08-02-f10-financial-indicator-sections 实测）：非银行股 6 项通用
（营业毛利率/营业净利率/营业利润率/成本费用利润率/总资产报酬率/加权净资产
收益率），银行股另有特有项（净息差/净利差/成本收入比等）——跟随解析，该节
有就显示、没有就不显示（不硬编码通用集）。
"""

from __future__ import annotations

INDICATOR_SECTION = '【盈利能力指标】'


def get_financial_indicators(ticker: str) -> str:
    """返回目标股票最新报告期的盈利能力指标摘要文本（百分数）。

    降级（不 raise）：raw 缓存缺失 / 解析失败 / 无该分节 → 占位文本
    （与 get_trend_indicators 的"（无 ... 跳过）"风格一致）。
    """
    from data_source.chinese_mainland.tdx.f10_parser import parse_indicator_section
    from data_source.chinese_mainland.tdx.tdx_source import get_tdx_source
    from utils.formatting import fmt_number

    src = get_tdx_source()
    raw = src.fetch_company_finance_raw(ticker)
    if not raw:
        return f"（无 {ticker} 的盈利能力指标，跳过）"
    df = parse_indicator_section(raw, INDICATOR_SECTION)
    if df.empty:
        return f"（无 {ticker} 的盈利能力指标，跳过）"

    # 最新报告期：period 'YYYY-MM-DD' 字符串，字典序即时间序（与
    # overview.latest_period_value 同口径）
    latest = df["period"].max()
    sub = df[df["period"] == latest]
    # 只输出有数值的指标（value_num notna）：F10 页面长指标名折行会产生
    # 残缺名/无值行（000001 的 '手续费及佣金净收入占营'/'业收入比'），
    # N/A 行对 agent 是噪声——摘要语义：给 LLM 只给有数据的指标。
    sub = sub[sub["value_num"].notna()]
    lines = [f"【盈利能力指标（{latest}）】"]
    # 保持 F10 原始指标顺序（财务语义相关分组），不排序
    for metric in sub["metric"].tolist():
        lines.append(f"{metric}: {fmt_number(sub.loc[sub['metric'] == metric, 'value_num'].iloc[0], 2)}%")
    return "\n".join(lines)
