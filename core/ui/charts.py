"""采集数据 → altair 图表（08-06-ui-data-charts）。

输入是 data_markdown.parse_daily_rows / parse_financial_rows 的结构化
行；输出 altair Chart spec。纯函数、无 Streamlit import——altair spec
构造不渲染、无浏览器，离线测试断言（house style）。

**主题适配**：背景/文字/坐标轴交给 st.altair_chart 默认 streamlit
theme（随激活主题亮暗自动切换）；mark 颜色由 spec 定死，选双主题可读
色并经 validate_palette.js 验证（亮/暗两模式均 PASS，CVD ΔE≥8）：
涨跌对 #E03131 / #0B9464（A 股约定红涨绿跌，语义色），财务线三色
#E03131 / #2563EB / #D97706。

**日期轴**：Date / Report Date 用 ordinal（N）编码——交易日/报告期在
时间轴上不等距（周末休市），ordinal 不产生假空隙。
"""

import altair as alt
import pandas as pd

from core.ui import data_markdown

# 涨跌语义色（A 股约定红涨绿跌；validate_palette 双模式 PASS，ΔE 8.0）
UP_COLOR = "#E03131"
DOWN_COLOR = "#0B9464"

# 财务折线色（净利润/销售毛利率/每股收益；trio 全项 PASS）
_FINANCIAL_LINES = (
    ("Net Profit", "净利润", "#E03131"),
    ("Sales gross margin percent", "销售毛利率", "#2563EB"),
    ("EPS", "每股收益", "#D97706"),
)

# 日K 图表高（px）；副图高（成交量/收盘价/涨跌幅/财务）。
# **高度下限（2026-08-06 实测踩坑）**：顶部涨跌图例 + 旋转 45° 日期标签 +
# 双轴标题的镀铬区约 170px——svg 高 <200px 时绘图区 ≤30px，140px 时直接
# ≤0 → vega 渲染出 0 高 mark（柱子全塌成 2px、y 轴无刻度，浏览器实测
# path d='...v0...'）。副图保持 260 以上；K线 320。
_KLINE_HEIGHT = 320
_VOLUME_HEIGHT = 260


def _styled(chart, height):
    """统一样式：透明背景（theme 管表面色）、发丝网格、固定高。

    streamlit theme 提供轴/文字/表面色，这里只收网格为低透明度发丝线
    （dataviz marks-and-anatomy：网格 recessive）并去掉视图描边。
    **不设 width**：宽度由 st.altair_chart(use_container_width=True)
    注入（实测 `width="container"` 与 use_container_width 叠加无益）。
    **height 有下限**（见 _VOLUME_HEIGHT 注释）：镀铬区 ~170px，过矮
    视图塌缩成 0 高 mark——改高度前先浏览器实测。
    """
    return (chart
            .configure(background="transparent",
                       view=alt.ViewConfig(stroke=None),
                       axis=alt.AxisConfig(grid=True, gridOpacity=0.15,
                                           labelFontSize=11, titleFontSize=12))
            .properties(height=height))


def _direction(rows, key="Close"):
    """涨跌标注（A 股约定）：Close ≥ Open → 涨，否则跌。"""
    return ["涨" if r[key] >= r["Open"] else "跌" for r in rows]


def candlestick_chart(rows) -> alt.Chart | None:
    """K线：rule 影线（High-Low）+ bar 实体（Open-Close），红涨绿跌。

    涨跌两色为语义色（bar 实体 + 影线同色），带图例（≥2 系列必须，
    dataviz）；tooltip 悬浮带日期/开收高低/涨跌幅。
    **y 轴 zero=False**（2026-08-06 用户反馈"留白太多"）：零基比例下
    价格 10~11 画在 0~12.5 轴上,蜡烛只占底部 ~15%、上方 85% 空白;
    zero=False + 共享 y 轴 → 域 [min Low, max High] 铺满绘图区。
    """
    if not rows:
        return None
    df = pd.DataFrame(rows)
    df["Direction"] = _direction(rows)
    color = alt.Color(
        "Direction:N",
        scale=alt.Scale(domain=["涨", "跌"], range=[UP_COLOR, DOWN_COLOR]),
        legend=alt.Legend(title="涨跌", orient="top"),
    )
    tooltip = [alt.Tooltip("Date:N", title="日期"),
               alt.Tooltip("Open:Q", title="开盘", format=".2f"),
               alt.Tooltip("Close:Q", title="收盘", format=".2f"),
               alt.Tooltip("High:Q", title="最高", format=".2f"),
               alt.Tooltip("Low:Q", title="最低", format=".2f"),
               alt.Tooltip("Change Percent:Q", title="涨跌幅", format=".2f")]
    price_scale = alt.Scale(zero=False)
    base = alt.Chart(df).encode(x=alt.X("Date:N", title="日期", axis=alt.Axis(labelAngle=-45)))
    wick = base.mark_rule().encode(
        y=alt.Y("Low:Q", title="价格", scale=price_scale),
        y2=alt.Y2("High:Q"),
        color=color, tooltip=tooltip)
    body = base.mark_bar().encode(
        y=alt.Y("Open:Q", title="价格", scale=price_scale),
        y2=alt.Y2("Close:Q"),
        color=color, tooltip=tooltip)
    # 两图层共享同一价格 y 轴(Low/High/Open/Close 合并域,影线与实体对齐)
    return _styled((wick + body).resolve_scale(y="shared"), _KLINE_HEIGHT)


def volume_chart(rows) -> alt.Chart | None:
    """成交量柱（按涨跌同色）；y 轴标题不带单位（lots 单位以表格为准）。"""
    if not rows:
        return None
    df = pd.DataFrame(rows)
    df["Direction"] = _direction(rows)
    return _styled(
        alt.Chart(df).mark_bar().encode(
            x=alt.X("Date:N", title="日期", axis=alt.Axis(labelAngle=-45)),
            y=alt.Y("Volume:Q", title="成交量"),
            color=alt.Color("Direction:N",
                            scale=alt.Scale(domain=["涨", "跌"],
                                            range=[UP_COLOR, DOWN_COLOR]),
                            legend=alt.Legend(title="涨跌", orient="top")),
            tooltip=[alt.Tooltip("Date:N", title="日期"),
                     alt.Tooltip("Volume:Q", title="成交量", format=",.0f")]),
        _VOLUME_HEIGHT)


def close_line_chart(rows) -> alt.Chart | None:
    """收盘价趋势线（单系列：标题即图例，不画图例框——dataviz）。"""
    if not rows:
        return None
    df = pd.DataFrame(rows).dropna(subset=["Close"])
    if df.empty:
        return None
    return _styled(
        alt.Chart(df).mark_line(strokeWidth=2).encode(
            x=alt.X("Date:N", title="日期", axis=alt.Axis(labelAngle=-45)),
            y=alt.Y("Close:Q", title="收盘价"),
            color=alt.value(UP_COLOR),
            tooltip=[alt.Tooltip("Date:N", title="日期"),
                     alt.Tooltip("Close:Q", title="收盘价", format=".2f")]),
        _VOLUME_HEIGHT)


def change_percent_chart(rows) -> alt.Chart | None:
    """涨跌幅柱：正值红（涨）、负值绿（跌），带图例。"""
    if not rows:
        return None
    df = pd.DataFrame(rows).dropna(subset=["Change Percent"])
    if df.empty:
        return None
    df["Sign"] = ["涨" if v >= 0 else "跌" for v in df["Change Percent"]]
    return _styled(
        alt.Chart(df).mark_bar().encode(
            x=alt.X("Date:N", title="日期", axis=alt.Axis(labelAngle=-45)),
            y=alt.Y("Change Percent:Q", title="涨跌幅（%）"),
            color=alt.Color("Sign:N",
                            scale=alt.Scale(domain=["涨", "跌"],
                                            range=[UP_COLOR, DOWN_COLOR]),
                            legend=alt.Legend(title="涨跌", orient="top")),
            tooltip=[alt.Tooltip("Date:N", title="日期"),
                     alt.Tooltip("Change Percent:Q", title="涨跌幅", format=".2f")]),
        _VOLUME_HEIGHT)


def financial_charts(rows) -> list:
    """业绩节 → 净利润/销售毛利率/每股收益折线（单系列各自成图，单位
    不同不混轴——dataviz 单轴原则）；某指标全 N/A → 跳过该图。"""
    charts = []
    for key, label, color in _FINANCIAL_LINES:
        df = pd.DataFrame(rows).dropna(subset=[key]) if rows else pd.DataFrame()
        if df.empty:
            continue
        charts.append((
            label,
            _styled(
                alt.Chart(df).mark_line(strokeWidth=2).encode(
                    x=alt.X("Report Date:N", title="报告期"),
                    y=alt.Y(f"{key}:Q", title=label),
                    color=alt.value(color),
                    tooltip=[alt.Tooltip("Report Date:N", title="报告期"),
                             alt.Tooltip(f"{key}:Q", title=label, format=".2f")]),
                _VOLUME_HEIGHT)))
    return charts


def iter_data_charts(stock_info: str):
    """stock_info 文本 → [(标题, altair.Chart), ...]（display 顺序渲染）。

    解析空（无日K/无业绩节）→ 空迭代，display 不画空图不打扰。标题即
    st.subheader 文案；图表顺序：K线 → 成交量 → 收盘价 → 涨跌幅 →
    财务折线（净利润/毛利率/每股收益）。
    """
    daily = data_markdown.parse_daily_rows(stock_info)
    if daily:
        yield "K线", candlestick_chart(daily)
        yield "成交量", volume_chart(daily)
        yield "收盘价", close_line_chart(daily)
        yield "涨跌幅", change_percent_chart(daily)
    for label, chart in financial_charts(data_markdown.parse_financial_rows(stock_info)):
        yield label, chart
