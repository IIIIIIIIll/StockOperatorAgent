import os
import streamlit as st
from langchain_core.runnables import RunnableConfig
from core.investment_committee import InvestmentCommittee, build_stock_information
from data_source.chinese_mainland.tdx.tdx_source import is_bj_ticker
from loguru import logger

committee = InvestmentCommittee()

def _has_deepseek_key():
    """只认 DEEPSEEK_API_KEY——与 InvestmentCommittee 实现对齐。

    make_investment_committee 永远构造 DeepSeekApi()（无 key 构造即抛
    OpenAIError）；只配 DASHSCOPE_API_KEY 时旧检查放行但构造崩溃。Qwen
    已降级为可选项（默认 LLM 是 DeepSeek），UI 不再为其放行。
    """
    return "DEEPSEEK_API_KEY" in os.environ

def write_ui():
    st.title("超绝AI股票分析系统")

    if not _has_deepseek_key():
        st.error("请在环境变量或.env中设置 DEEPSEEK_API_KEY 后重启应用")
        return

    st.write("输入您想要分析的沪深京A股六位股票代码")
    with st.form(key='stock_ticker_form'):
        stock_ticker = st.text_input("股票代码", max_chars=6)
        submit_button = st.form_submit_button(label='提交')

    if submit_button:
        if not stock_ticker.isdigit() or len(stock_ticker) != 6:
            st.error("请输入有效的六位数字股票代码")
        elif is_bj_ticker(stock_ticker):
            st.error("北交所（BJ）股票暂不支持分析：TDX 数据源不覆盖 BJ 证券（无名称/无行情），请使用沪深 A 股代码")
        else:
            status = st.container()
            updatable_container = status.empty()
            updatable_container.info("正在初始化环境，请稍候...")


            (fundamental_analysis_tab,
             trend_analysis_tab,
             bullish_opinion,
             bearish_opinion,
             final_decision) = st.tabs(["基本面分析", "趋势分析", "看涨观点", "看跌观点", "最终结论"])

            updatable_container.info(f"正在获取 {stock_ticker} 的股票信息（含技术指标与实时情报）... 可能会需要一些时间，请耐心等待...")
            try:
                # 图前 enrichment（与 make_investment_decision 共用同一组装点）：
                # 个股信息 + 技术指标 + TDX 实时情报（无 TDX_API_KEY 时降级文本）
                stock_info = build_stock_information(stock_ticker)
            except Exception as e:
                # UI 层守护（error-handling spec 允许）：数据问题（如股票缺失
                # 抛出的 Exception）不裸 traceback 红屏，中文提示 + 记录日志
                logger.exception("Failed to build stock information for {}", stock_ticker)
                st.error(f"获取 {stock_ticker} 的股票信息失败：{e}，请检查股票代码后重试")
                return
            updatable_container.info(f"正在开始分析 {stock_ticker} 的股票信息... 可能会需要一些时间，请耐心等待...")

            config: RunnableConfig = {"configurable": {"thread_id": "1"}}
            graph = committee.make_investment_committee(config, progress_updater=updatable_container)

            try:
                for responses in graph.stream({"messages": [{"role": "user", "content": f"请帮我分析一下 {stock_ticker}"}],
                                           "target_stock_ticker": stock_ticker,
                                           "stock_information": stock_info
                                           }, config=config):
                    for value in responses.values():
                        logger.debug("Assistant: {}", value["messages"][-1].content)
            except Exception as e:
                # LLM 调用失败（API key 失效/网络/限流）→ 中文提示，不裸 traceback
                logger.exception("Agent graph streaming failed for {}", stock_ticker)
                st.error(f"分析 {stock_ticker} 的过程中出错：{e}，请稍后重试或检查 LLM 配置")
                return

            states = list(graph.get_state_history(config))

            with fundamental_analysis_tab:
                st.header("基本面分析")
                st.write(states[0].values["fundamental_analysis"])
            with trend_analysis_tab:
                st.header("趋势分析")
                st.write(states[0].values["trend_analysis"])
            with bullish_opinion:
                st.header("看涨观点")
                st.write(states[0].values["bullish_opinions"][-1].content)
            with bearish_opinion:
                st.header("看跌观点")
                st.write(states[0].values["bearish_opinions"][-1].content)
            with final_decision:
                st.header("最终结论")
                st.write(states[0].values["final_decision"])


