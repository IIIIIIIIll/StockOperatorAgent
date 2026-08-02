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

# 采集数据 Tab 标题（08-02-ui-collected-data-display）：放 st.tabs 最前，
# 在 build_stock_information 成功后、stream 前填充原文（st.text 保换行）。
DATA_TAB_TITLE = "采集数据"

# 报告 state key → Tab 标题。顺序即 write_ui 里 st.tabs 中报告 Tab 的
# 创建顺序（数据 Tab 插入不影响相对顺序）——渲染 dispatch 依赖该契约
# （08-02-ui-incremental-report-render）。
REPORT_TABS = (
    ("fundamental_analysis", "基本面分析"),
    ("trend_analysis", "趋势分析"),
    ("bullish_opinions", "看涨观点"),
    ("bearish_opinions", "看跌观点"),
    ("final_decision", "最终结论"),
)


def _report_content(value):
    """State 报告值 → 展示文本（08-02-ui-incremental-report-render）。

    stream update 中报告是节点返回的原始字符串（reducer 未应用）；最终
    state 里 bullish/bearish 被 add_messages reducer 包装成消息列表
    （旧 get_state_history 渲染取 [-1].content）——两种形态都消化，
    展示语义与旧实现一致。
    """
    if isinstance(value, list) and value and hasattr(value[-1], "content"):
        return value[-1].content
    return value


def iter_report_items(update):
    """节点 update dict → (key, title, content) 渲染项；无报告 key → 空。

    纯函数，与 Streamlit 解耦：UI 循环按 key 查 Tab 容器 dispatch，离线
    测试喂合成 update 验证映射（house style，不 mock Streamlit）。
    """
    for key, title in REPORT_TABS:
        if key in update:
            yield key, title, _report_content(update[key])


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


            (data_tab,
             fundamental_analysis_tab,
             trend_analysis_tab,
             bullish_opinion,
             bearish_opinion,
             final_decision) = st.tabs([DATA_TAB_TITLE, "基本面分析", "趋势分析", "看涨观点", "看跌观点", "最终结论"])

            updatable_container.info(f"正在获取 {stock_ticker} 的股票信息（含技术指标与实时情报）... 可能会需要一些时间，请耐心等待...")
            try:
                # 图前 enrichment（与 make_investment_decision 共用同一组装点）：
                # 个股信息 + 技术指标 + TDX 实时情报（无 TDX_API_KEY 时降级文本）
                # progress（review #9）：三个工具调用之间输出分步进度
                stock_info = build_stock_information(
                    stock_ticker, progress=lambda msg: updatable_container.info(msg)
                )
            except Exception as e:
                # UI 层守护（error-handling spec 允许）：数据问题（如股票缺失
                # 抛出的 Exception）不裸 traceback 红屏，中文提示 + 记录日志
                logger.exception("Failed to build stock information for {}", stock_ticker)
                st.error(f"获取 {stock_ticker} 的股票信息失败：{e}，请检查股票代码后重试")
                return
            # 采集数据 Tab（08-02-ui-collected-data-display）：enrichment
            # 成功后、stream 前填充原文。stock_information 是定宽文本
            # （overview 单行 + 60 根日K + 业绩报告，行间 \n），st.write
            # 走 markdown 渲染会合并单换行——st.text 等宽保换行才是原文；
            # 报告 Tab（LLM markdown）仍走 st.write。异常路径上面已 return，
            # 此处数据必可用（降级占位文本是原文一部分，照常展示）。
            with data_tab:
                st.header(DATA_TAB_TITLE)
                st.text(stock_info)

            updatable_container.info(f"正在开始分析 {stock_ticker} 的股票信息... 可能会需要一些时间，请耐心等待...")

            config: RunnableConfig = {"configurable": {"thread_id": "1"}}
            graph = committee.make_investment_committee(config, progress_updater=updatable_container)

            # 报告 key → Tab 容器（与 REPORT_TABS 顺序对应，见 iter_report_items）
            report_tabs = {
                "fundamental_analysis": fundamental_analysis_tab,
                "trend_analysis": trend_analysis_tab,
                "bullish_opinions": bullish_opinion,
                "bearish_opinions": bearish_opinion,
                "final_decision": final_decision,
            }

            try:
                # 边算边渲染（08-02-ui-incremental-report-render）：每个报告在
                # 其节点完成、state key 出现在 stream update 时立即填充对应
                # Tab，不等整次分析（最终结论）完成。循环体运行于脚本线程
                # （LangGraph sync stream 在调用线程 yield）——st.write 安全；
                # 并行节点工作线程的进度调用由 safe_progress 兜住，互不干扰。
                for responses in graph.stream({"messages": [{"role": "user", "content": f"请帮我分析一下 {stock_ticker}"}],
                                           "target_stock_ticker": stock_ticker,
                                           "stock_information": stock_info
                                           }, config=config):
                    for value in responses.values():
                        for key, title, content in iter_report_items(value):
                            with report_tabs[key]:
                                st.header(title)
                                st.write(content)
            except Exception as e:
                # LLM 调用失败（API key 失效/网络/限流）→ 中文提示，不裸 traceback
                logger.exception("Agent graph streaming failed for {}", stock_ticker)
                st.error(f"分析 {stock_ticker} 的过程中出错：{e}，请稍后重试或检查 LLM 配置")
                return


