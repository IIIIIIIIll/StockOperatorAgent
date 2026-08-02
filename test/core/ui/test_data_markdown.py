"""08-02-ui-data-markdown-tables：采集数据 → markdown 表格的纯函数测试。

to_markdown_tables 是展示端转换器（LLM 上下文零改动）：喂合成文本
（镜像三个生产者的真实格式——overview/日K/业绩/指标/情报，见 PRD
Notes 实测形态）断言输出 markdown 结构：分节标题、表格表头（中文
标签）、行数、降级占位透传、分隔线丢弃、未知 key 原样。Streamlit
副作用不 mock（house style，与 TestDisplayIncrementalRender 同约定）。
"""

from core.ui import data_markdown as dm


# --- 合成输入（镜像真实生产者的输出格式） ---

_OVERVIEW_LINES = [
    "-----------",
    "Stock: 平安银行 (000001)",
    "Latest price: 11.11",
    "Dynamic PE: 5.20",
    "Pb: 0.55",
    "Momentum: 3.25%",
]


def _daily_line(date):
    # format_stock_output 日K 行：8 个 'Key: value' 对（前导两空格）
    return (f"  Date: {date}, Open: 11.00, Close: 11.11, High: 11.20, "
            f"Low: 10.98, Change Percent: 1.23%, Volume: 123456.00lots, "
            f"Turnover Rate: 1.20%")


def _daily_sample(n=60):
    lines = _OVERVIEW_LINES + ["Last 60 days prices:"]
    lines += [_daily_line(f"2026-07-{30 - i % 30:02d}") for i in range(n)]
    return "\n".join(lines) + "\n-----------\n"


def _report_line(date):
    # format_stock_output 业绩行：3 个 'Key: value' + 6 个 'label 数值'（无冒号）
    return (f"  Report Date: {date}, EPS: 0.50, Net Profit: 1000.00, "
            f"Net Profit YoY percent 1.23, Net Profit QoQ percent -0.50, "
            f"Net worth per share 2.10, Return on Equity percent 3.33, "
            f"Cash flow per share 0.42, Sales gross margin percent 15.00")


def _financial_sample(n=20):
    lines = _OVERVIEW_LINES + ["Last 60 days prices:"] + [
        _daily_line("2026-07-30") for _ in range(3)
    ] + ["Last 20 financial abstracts:"] + [
        _report_line(f"202603{31 - i % 28:02d}") for i in range(n)
    ]
    return "\n".join(lines) + "\n-----------\n"


_INDICATORS_SAMPLE = (
    "【技术指标（2026-07-30 收盘）】\n"
    "MA5/10/20/60: MA5=1.00, MA10=2.00, MA20=3.00, MA60=4.00\n"
    "EMA5/10/20/60: EMA5=1.10, EMA10=2.10, EMA20=3.10, EMA60=4.10\n"
    "MACD: DIF=0.05, DEA=0.03, MACD=0.02\n"
    "RSI6/12/24: RSI6=60.00, RSI12=55.00, RSI24=50.00\n"
    "KDJ: K=70.00, D=65.00, J=80.00\n"
    "BOLL: BOLL_UP=12.00, BOLL_MB=11.00, BOLL_DN=10.00\n"
    "ATR: ATR=0.30\n"
    "量比/VOL_MA5: VOL_RATIO=1.50, VOL_MA5=100000.00\n"
    "换手率: TURNOVER_RATE=1.20"
)

_INTEL_SAMPLE = "【实时市场情报】\n名称: 平安银行, 最新价: 11.11, 涨跌幅: +1.23%"


class TestToMarkdownTables:

    def test_overview_two_column_table(self):
        out = dm.to_markdown_tables("\n".join(_OVERVIEW_LINES))
        assert "**股票概览**" in out
        assert "| 指标 | 数值 |" in out
        assert "| 股票名称 | 平安银行 (000001) |" in out
        assert "| 最新价 | 11.11 |" in out
        assert "| 动态市盈率 | 5.20 |" in out
        assert "| 市净率 | 0.55 |" in out
        assert "| 动量 | 3.25% |" in out

    def test_daily_bars_8_column_table(self):
        out = dm.to_markdown_tables(_daily_sample(60))
        header = "| 日期 | 开盘价 | 收盘价 | 最高价 | 最低价 | 涨跌幅 | 成交量 | 换手率 |"
        assert header in out
        rows = [l for l in out.splitlines() if l.startswith("| 2026-07-")]
        assert len(rows) == 60

    def test_financial_9_column_table(self):
        out = dm.to_markdown_tables(_financial_sample(20))
        header = ("| 报告日期 | 每股收益 | 净利润 | 净利润同比 | 净利润环比 | "
                  "每股净资产 | 净资产收益率 | 每股现金流 | 销售毛利率 |")
        assert header in out
        rows = [l for l in out.splitlines() if l.startswith("| 202603")]
        assert len(rows) == 20

    def test_indicators_expanded_pairs(self):
        """指标行 'label: K=V, K=V' 融合 token → 递归展开为指标|数值对。"""
        out = dm.to_markdown_tables(_INDICATORS_SAMPLE)
        assert "**技术指标（2026-07-30 收盘）**" in out
        assert "| 指标 | 数值 |" in out
        assert "| MA5 | 1.00 |" in out
        assert "| MA60 | 4.00 |" in out
        assert "| 量比 | 1.50 |" in out
        assert "| 换手率 | 1.20 |" in out

    def test_intel_rows_two_column_table(self):
        """情报行 'k: v, k: v' → 字段|数值表（键集合不一致走扁平表）。"""
        out = dm.to_markdown_tables(_INTEL_SAMPLE)
        assert "**实时市场情报**" in out
        assert "| 指标 | 数值 |" in out
        assert "| 名称 | 平安银行 |" in out
        assert "| 最新价 | 11.11 |" in out

    def test_profitability_section_own_table(self):
        """盈利能力指标段（08-02-f10-financial-indicator-sections）：独立成节
        （`【盈利能力指标（日期）】` marker），不混入技术指标节。"""
        text = (
            "【技术指标（2026-07-31 收盘）】\n"
            "MA5/10/20/60: MA5=1.00, MA10=2.00, MA20=3.00, MA60=4.00\n"
            "【盈利能力指标（2026-03-31）】\n"
            "营业毛利率: 89.76%\n"
            "营业净利率: 52.22%\n"
            "营业利润率: 69.63%"
        )
        out = dm.to_markdown_tables(text)
        # 独立节标题（去【】保留日期），且出现在技术指标节表格之后
        assert "**盈利能力指标（2026-03-31）**" in out
        assert out.find("**盈利能力指标（2026-03-31）**") > out.find("**技术指标")
        # 指标行渲染进盈利能力节自己的表格
        profit_block = out.split("**盈利能力指标（2026-03-31）**")[1]
        assert "| 营业毛利率 | 89.76% |" in profit_block
        # 技术指标节表格不含盈利能力行
        tech_block = out.split("**盈利能力指标（2026-03-31）**")[0]
        assert "营业毛利率" not in tech_block

    def test_placeholder_lines_passthrough(self):
        """降级占位文本（无键值形态）原样透传——不吞降级信息。"""
        text = ("（无 000001 的行情数据，跳过技术指标）\n"
                "（未配置 TDX_API_KEY，跳过实时市场情报）")
        out = dm.to_markdown_tables(text)
        assert "（无 000001 的行情数据，跳过技术指标）" in out
        assert "（未配置 TDX_API_KEY，跳过实时市场情报）" in out
        assert "|" not in out  # 不产生伪表格

    def test_separators_dropped(self):
        out = dm.to_markdown_tables(_daily_sample(3))
        assert "-----------" not in out

    def test_unknown_key_passes_through(self):
        out = dm.to_markdown_tables("CustomField: xyz")
        assert "| CustomField | xyz |" in out

    def test_na_value_kept(self):
        """业绩行 N/A 值（fmt_number 的 NaN 渲染）保留原样。"""
        line = "Report Date: 20260331, EPS: N/A, Net Profit: 1000.00, Net Profit YoY percent N/A"
        out = dm.to_markdown_tables(line)
        assert "| 每股收益 | N/A |" in out
        assert "| 净利润同比 | N/A |" in out

    def test_empty_input(self):
        assert dm.to_markdown_tables("") == ""
        assert dm.to_markdown_tables("\n-----------\n") == ""
