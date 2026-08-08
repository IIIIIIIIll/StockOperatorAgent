"""多空交易员与投资经理查询插值测试（08-08-billions-api-integration，
Step 4 补接线，离线）。

信息面分析报告为**条件段**（ANALYST 开 → 追加进查询；关 → 空串）——
关键契约（AC1）：key 缺失时查询文本必须与改动前**逐字节一致**（不能
多出任何换行/空格）。基线字符串由改动前代码实跑抓取（repr 固化，
2026-08-08，固定种子值），任何意外空白变化都会被字节级断言钉死。

house style 无 mock 框架——记录型 _FakeLLM 捕获查询（对齐
test/core/test_committee_enrichment.py 的 _FakeLLM 模式）。
"""

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, ChatResult

from agents.chinese_mainland.bullish_trader import BullishTrader
from agents.chinese_mainland.bearish_trader import BearishTrader
from agents.chinese_mainland.investment_manager import InvestmentManager

_CONFIG = {"configurable": {"thread_id": "1"}}

# 改动前基线（repr 固化，2026-08-08 实跑抓取）。种子值：
# 基本面摘要 / 趋势摘要 / 指标摘要 / 多头观点正文 / 空头观点正文
_BULL_BEAR_BASELINE = (
    "\n        现在请基于以下信息，给出你对股票代码000001的看法：\n"
    "        基本面报告: \n\n"
    "        基本面摘要\n"
    "        \n\n"
    "        趋势报告: \n\n"
    "        趋势摘要\n"
    "        \n\n"
    "        技术指标分析报告: \n\n"
    "        指标摘要\n"
    "        \n\n"
    "        "
)

_MANAGER_BASELINE = (
    "\n        现在请基于以下信息，给出你对股票代码000001的最终投资建议：\n"
    "        基本面报告: \n\n"
    "        基本面摘要\n"
    "        \n\n"
    "        趋势报告: \n\n"
    "        趋势摘要\n"
    "        \n\n"
    "        技术指标分析报告: \n\n"
    "        指标摘要\n"
    "        \n\n"
    "        多头观点: \n\n"
    "        多头观点正文\n"
    "        \n\n"
    "        空头观点: \n\n"
    "        空头观点正文\n"
    "        \n\n"
    "        "
)

_STATE = {
    "target_stock_ticker": "000001",
    "fundamental_analysis": "基本面摘要",
    "trend_analysis": "趋势摘要",
    "technical_indicator_analysis": "指标摘要",
    "bullish_opinions": [AIMessage(content="多头观点正文")],
    "bearish_opinions": [AIMessage(content="空头观点正文")],
}


class _FakeLLM(BaseChatModel):
    """记录格式化后的消息并返回固定 AIMessage——隔离节点与 live LLM。

    走真实构造路径（prompt|llm 链）；_generate 收到的末条消息即 agent
    拼装的查询（对齐 test_committee_enrichment._FakeLLM 模式）。
    """

    last_messages: list | None = None

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        self.last_messages = messages
        return ChatResult(generations=[ChatGeneration(message=AIMessage(content="OK"))])

    @property
    def _llm_type(self):
        return "fake"


class TestBullishTraderQuery:

    def _query(self, state):
        fake = _FakeLLM()
        BullishTrader(fake, _CONFIG).bullish_trader(state)
        return fake.last_messages[-1].content

    def test_missing_key_byte_identical_to_baseline(self):
        # AC1：key 缺失（ANALYST 关）→ 查询与改动前逐字节一致
        assert self._query(dict(_STATE)) == _BULL_BEAR_BASELINE

    def test_info_section_appended_when_present(self):
        # 开 → 信息面段在技术指标报告之后追加（查询结尾）
        query = self._query({**_STATE, "information_analysis": "信息面报告内容"})
        assert "信息面分析报告: " in query
        assert "信息面报告内容" in query
        assert query.find("信息面分析报告") > query.find("指标摘要")
        assert query.endswith("信息面报告内容\n        ")


class TestBearishTraderQuery:

    def _query(self, state):
        fake = _FakeLLM()
        BearishTrader(fake, _CONFIG).bearish_trader(state)
        return fake.last_messages[-1].content

    def test_missing_key_byte_identical_to_baseline(self):
        # AC1：key 缺失（ANALYST 关）→ 查询与改动前逐字节一致
        assert self._query(dict(_STATE)) == _BULL_BEAR_BASELINE

    def test_info_section_appended_when_present(self):
        query = self._query({**_STATE, "information_analysis": "信息面报告内容"})
        assert "信息面分析报告: " in query
        assert "信息面报告内容" in query
        assert query.find("信息面分析报告") > query.find("指标摘要")
        assert query.endswith("信息面报告内容\n        ")


class TestInvestmentManagerQuery:

    def _query(self, state):
        fake = _FakeLLM()
        InvestmentManager(fake, _CONFIG).investment_manager(state)
        return fake.last_messages[-1].content

    def test_missing_key_byte_identical_to_baseline(self):
        # AC1：key 缺失（ANALYST 关）→ 查询与改动前逐字节一致
        assert self._query(dict(_STATE)) == _MANAGER_BASELINE

    def test_info_section_between_indicator_and_bull(self):
        # 开 → 信息面段在技术指标报告与多头观点之间（对齐 4 入边顺序）
        query = self._query({**_STATE, "information_analysis": "信息面报告内容"})
        assert "信息面分析报告: " in query
        assert "信息面报告内容" in query
        assert query.find("指标摘要") < query.find("信息面分析报告") < query.find("多头观点正文")
