"""build_stock_information（图前 enrichment 唯一组装点）与 investment_manager
查询插值测试。

prd（08-02-fix-dead-code-cleanup）验收：
- 修复 1：display 流程的 stock_information 含技术指标与实时情报段；无 key
  降级路径（TDX_API_KEY 缺失 → 情报降级占位文本）正常。
- 修复 5/6：investment_manager 查询插值的是观点正文（[-1].content），
  无 [HumanMessage(...)] 列表元数据、无 '$' 前缀残留。

假 LLM 模式（testing.md 允许的隔离法）：记录 query 并返回固定 AIMessage，
不触网——与 deprecated 的 test_basic_graph（live LLM）解耦。
"""

import os

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, ChatResult

from agents.chinese_mainland.investment_manager import InvestmentManager
from core.investment_committee import build_stock_information

# 亿信全部 env（08-08-billions-api-integration，Step 5，check 追加项）：
# 本测试是离线测试，开发者配置 BILLIONS_API_KEY 后 build_stock_information
# 会走 get_billions_financial_intel 真实亿信网络调用（fin_db 超时 120s）
# ——每次运行前全部清除（对齐 test_billions_config._with_env 语义）
_BILLIONS_ENV_KEYS = [
    "BILLIONS_API_KEY",
    "BILLIONS_DISABLED",
    "BILLIONS_FINDB_DISABLED",
    "BILLIONS_SEARCH_DISABLED",
    "BILLIONS_TWITTER_DISABLED",
    "BILLIONS_FETCH_DISABLED",
    "BILLIONS_ANALYST_DISABLED",
    "BILLIONS_FINDB_MAX_CALLS",
    "BILLIONS_SEARCH_MAX_CALLS",
    "BILLIONS_TWITTER_MAX_CALLS",
    "BILLIONS_FETCH_MAX_CALLS",
    "BILLIONS_ANALYST_MAX_CALLS",
]


class TestBuildStockInformation:

    def test_contains_technical_indicators_and_market_intel(self):
        # 无 TDX_API_KEY 降级路径（与开发者本机 key 解耦）：实时情报为占位文本
        saved = os.environ.pop("TDX_API_KEY", None)
        # 亿信（Step 5）：清除全部 BILLIONS_* env——无 key → 第 5 段空串，
        # 本"离线"测试不触发真实亿信网络调用（AC1 无 key 零行为变化）
        saved_billions = {key: os.environ.pop(key, None) for key in _BILLIONS_ENV_KEYS}
        try:
            text = build_stock_information("002714")
            # 技术指标段（002714 有行情数据 → 指标摘要；无数据时占位文本同样含"技术指标"）
            assert "技术指标" in text
            # 无 key 降级：情报段为"未配置 TDX_API_KEY"占位，不 raise、不阻断
            assert "未配置 TDX_API_KEY" in text
            # 拼接顺序：技术指标 → 财务指标 → 实时情报
            # （get_stock_info → 技术指标 → 财务指标 → 实时情报，
            # 08-02-f10-financial-indicator-sections 加第四段）
            assert text.find("未配置 TDX_API_KEY") > text.find("技术指标")
            # 盈利能力指标段在技术指标之后、实时情报之前（002714 raw 缓存
            # 缺失 → 占位文本，同样含"盈利能力指标"字样；不 raise 不阻断）
            assert "盈利能力指标" in text
            assert text.find("盈利能力指标") > text.find("技术指标")
            assert text.find("未配置 TDX_API_KEY") > text.find("盈利能力指标")
            # 亿信段（Step 5）：无 BILLIONS_API_KEY → 空串不出现（失败占位
            # 文本也含"亿信"字样——任一出现都说明触发了真实调用）
            assert "亿信" not in text
        finally:
            if saved is not None:
                os.environ["TDX_API_KEY"] = saved
            for key, value in saved_billions.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value


class _FakeLLM(BaseChatModel):
    """记录格式化后的消息并返回固定 AIMessage——隔离 agent 节点与 live LLM。

    走真实构造路径（InvestmentManager(fake, config) 的 prompt|llm 链要求
    llm 是 Runnable，BaseChatModel（pydantic 模型）子类满足；记录字段需
    声明为 pydantic field）；_generate 收到的末条消息即 agent 拼装的
    query（含系统提示词）。
    """

    last_messages: list | None = None

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        self.last_messages = messages
        return ChatResult(generations=[ChatGeneration(message=AIMessage(content="最终投资建议：买入 000001"))])

    @property
    def _llm_type(self):
        return "fake"


class TestInvestmentManagerQuery:

    def _make_manager(self):
        fake = _FakeLLM()
        manager = InvestmentManager(fake, {"configurable": {"thread_id": "1"}})
        return manager, fake

    def test_query_contains_opinion_content_not_metadata(self):
        """修复 5/6 验收：插值 [-1].content 正文，无 HumanMessage 元数据、无 '$'。"""
        manager, fake = self._make_manager()
        result = manager.investment_manager({
            "target_stock_ticker": "000001",
            "fundamental_analysis": "基本面摘要",
            "trend_analysis": "趋势摘要",
            "technical_indicator_analysis": "指标摘要",
            "bullish_opinions": [AIMessage(content="多头观点正文")],
            "bearish_opinions": [AIMessage(content="空头观点正文")],
        })
        query_text = fake.last_messages[-1].content
        assert "多头观点正文" in query_text
        assert "空头观点正文" in query_text
        assert "指标摘要" in query_text  # 08-08-technical-indicator-analyst：第三份报告
        assert "HumanMessage" not in query_text  # 无列表 repr 元数据
        assert "$" not in query_text  # ${state[...]} 字面残留已清理
        assert result["final_decision"] == "最终投资建议：买入 000001"
