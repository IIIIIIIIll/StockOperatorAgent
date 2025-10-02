import os
import streamlit as st
from langchain_core.runnables import RunnableConfig
from core.investment_committee import InvestmentCommittee
from core.llms.tools.get_company_info import get_stock_info
from loguru import logger

committee = InvestmentCommittee()

def write_ui():
    st.title("超绝AI股票分析系统")

    if "DASHSCOPE_API_KEY" not in os.environ:
        st.error("请在环境变量或.env中设置DASHSCOPE_API_KEY后重启应用")
        return

    st.write("输入您想要分析的沪深京A股六位股票代码")
    with st.form(key='stock_ticker_form'):
        stock_ticker = st.text_input("股票代码", max_chars=6)
        submit_button = st.form_submit_button(label='提交')

    if submit_button:
        if not stock_ticker.isdigit() or len(stock_ticker) != 6:
            st.error("请输入有效的六位数字股票代码")
        else:
            status = st.container()
            updatable_container = status.empty()
            updatable_container.info("正在初始化环境，请稍候...")


            (fundamental_analysis_tab,
             trend_analysis_tab,
             bullish_opinion,
             bearish_opinion,
             final_decision) = st.tabs(["基本面分析", "趋势分析", "看涨观点", "看跌观点", "最终结论"])

            updatable_container.info(f"正在获取 {stock_ticker} 的股票信息... 可能会需要一些时间，请耐心等待...")
            stock_info = get_stock_info(stock_ticker)
            updatable_container.info(f"正在开始分析 {stock_ticker} 的股票信息... 可能会需要一些时间，请耐心等待...")

            config: RunnableConfig = {"configurable": {"thread_id": "1"}}
            graph = committee.make_investment_committee(config, progress_updater=updatable_container)

            for responses in graph.stream({"messages": [{"role": "user", "content": f"请帮我分析一下 {stock_ticker}"}],
                                       "target_stock_ticker": stock_ticker,
                                       "stock_information": stock_info
                                       }, config=config):
                for value in responses.values():
                    logger.debug("\nAssistant:", value["messages"][-1].content)

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


