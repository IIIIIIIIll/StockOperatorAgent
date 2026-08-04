import os
import queue
import threading

import streamlit as st
from langchain_core.runnables import RunnableConfig
from core.investment_committee import InvestmentCommittee, build_stock_information
from core.llms.progress import ProgressBridge
from core.ui import data_markdown
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
# 在 build_stock_information 成功后、stream 前填充 markdown 表格
# （data_markdown.to_markdown_tables，08-02-ui-data-markdown-tables）。
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


# 报告 key → Tab 标题查询（事件循环渲染用；REPORT_TABS 仍是权威定义）
REPORT_TITLES = dict(REPORT_TABS)


def _stream_graph_events(graph, config, inputs, events):
    """后台线程驱动 graph.stream：报告/异常/结束入队（脚本线程消费）。

    agent 侧 ProgressBridge 已把进度与节点完成报告推入同一队列（更早
    到达，节点级 1-1-1-1-1）；这里把 superstep update 的报告也入队作
    兜底（同 key 由脚本线程去重），异常与 sentinel 收尾。daemon 线程，
    会话结束随进程终止。
    """
    try:
        for responses in graph.stream(inputs, config=config):
            for value in responses.values():
                for key, _title, content in iter_report_items(value):
                    events.put(("report", key, content))
    except Exception as e:
        events.put(("error", e))
    finally:
        events.put(("done", None))


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
            # 采集数据 Tab（08-02-ui-collected-data-display + 08-02-ui-data-
            # markdown-tables）：enrichment 成功后、stream 前填充。stock_information
            # 是定宽文本（overview 单行 + 60 根日K + 业绩报告，行间 \n），
            # 展示端用 data_markdown.to_markdown_tables 转成带表格的 markdown
            # （纯函数；LLM 上下文零改动，源头文本不变）。报告 Tab（LLM
            # markdown）仍走 st.write。异常路径上面已 return，此处数据必
            # 可用（降级占位文本是原文一部分，照常透传展示）。
            with data_tab:
                st.header(DATA_TAB_TITLE)
                st.markdown(data_markdown.to_markdown_tables(stock_info))

            updatable_container.info(f"正在开始分析 {stock_ticker} 的股票信息... 可能会需要一些时间，请耐心等待...")

            config: RunnableConfig = {"configurable": {"thread_id": "1"}}
            # 事件队列桥（08-02-ui-live-progress-bridge）：并行节点在 LangGraph
            # 工作线程，Streamlit DeltaGenerator 只能在脚本线程 enqueue——
            # 进度/报告经 ProgressBridge 入队（线程安全），脚本线程消费后渲染。
            events: queue.Queue = queue.Queue()
            bridge = ProgressBridge(events)
            graph = committee.make_investment_committee(config, progress_updater=bridge)

            # 报告 key → Tab 容器（与 REPORT_TABS 顺序对应，见 iter_report_items）
            report_tabs = {
                "fundamental_analysis": fundamental_analysis_tab,
                "trend_analysis": trend_analysis_tab,
                "bullish_opinions": bullish_opinion,
                "bearish_opinions": bearish_opinion,
                "final_decision": final_decision,
            }

            try:
                # 图在后台线程驱动（sync stream 的 superstep 是屏障，脚本线程
                # 直接迭代会被阻塞到整个阶段完成，队列无法实时消费）；脚本线程
                # get 循环实时渲染：进度 → status 容器；报告 → 节点完成即填充
                # 对应 Tab（agent push 先到即渲染，superstep update 兜底按
                # (key, content) 去重）——1-1-1-1-1 而非 2-2-1。对抗修订轮
                # （08-04-adversarial-verdict-loop）：同 key 内容不同（初稿 →
                # 修订版）→ 追加渲染。轮次标签（08-04-ui-opinion-round-labels）：
                # counts 按 key 计数，第 1 次 header+内容，第 n（n≥2）次
                # `---` + "第 n 次观点"标签 + 内容——通用轮次计数（非"初稿/
                # 修订版"字样），未来多轮互驳每轮追加自然成为第 3、4 次观点。
                # 去重集合存 (key, content) 对——防 superstep 兜底重复推送
                # 同内容。
                threading.Thread(
                    target=_stream_graph_events,
                    args=(graph, config, {
                        "messages": [{"role": "user", "content": f"请帮我分析一下 {stock_ticker}"}],
                        "target_stock_ticker": stock_ticker,
                        "stock_information": stock_info,
                    }, events),
                    daemon=True,
                ).start()
                rendered = set()
                counts = {}
                while True:
                    kind, *payload = events.get()
                    if kind == "progress":
                        updatable_container.info(payload[0])
                    elif kind == "report":
                        key, content = payload
                        if (key, content) in rendered:
                            continue
                        rendered.add((key, content))
                        with report_tabs[key]:
                            n = counts.get(key, 0) + 1
                            counts[key] = n
                            if n == 1:
                                st.header(REPORT_TITLES[key])
                            else:
                                st.markdown("---")
                                st.markdown(f"**第 {n} 次观点**")
                            st.write(content)
                    elif kind == "error":
                        raise payload[0]
                    elif kind == "done":
                        break
            except Exception as e:
                # LLM 调用失败（API key 失效/网络/限流）→ 中文提示，不裸 traceback
                logger.exception("Agent graph streaming failed for {}", stock_ticker)
                st.error(f"分析 {stock_ticker} 的过程中出错：{e}，请稍后重试或检查 LLM 配置")
                return


