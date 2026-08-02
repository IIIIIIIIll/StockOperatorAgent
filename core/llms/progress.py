"""progress_updater 安全调用（2026-08-02，review #4 并行化引入的修复）。

LangGraph 并行节点（fundamental/trend/bullish/bearish）运行在内部工作
线程；Streamlit `DeltaGenerator.info()` 只能在脚本运行线程 enqueue——
工作线程调用即 `streamlit.errors.NoSessionContext`，会把整个分析打崩
（实测 2026-08-02：002027 分析在 trend 节点崩溃）。`safe_progress` 把
进度输出降级为尽力而为：非脚本线程 → debug 日志，不影响分析。

**ProgressBridge（08-02-ui-live-progress-bridge）**：display 以 bridge 作为
progress_updater 传给图——`info`/`push_report` 都只是 `queue.Queue.put`
（线程安全、永不抛），脚本线程消费队列后调用真实 DeltaGenerator。进度
消息实时上屏，并行节点的报告也在其 LLM 返回时**节点级**入队（不等同一
superstep 的慢节点）。`safe_progress` 的 try/except 降级保留为最后防线
（非 bridge updater 路径不变，如离线图测试的 `_ThrowingUpdater`）。
"""

import queue

from loguru import logger


def safe_progress(updater, message: str) -> None:
    """尽力输出进度：无 updater / 非脚本线程（并行节点）→ 跳过（debug 日志）。

    :param updater: ProgressBridge（推荐）或 Streamlit DeltaGenerator
                    （或 None——无 UI 上下文路径）
    :param message: 中文进度文案（与既有提示风格一致）
    """
    if updater is None:
        return
    try:
        updater.info(message)
    except Exception:
        logger.debug("Progress update skipped (non-script thread): {}", message)


class ProgressBridge:
    """线程安全进度桥：工作线程入队，脚本线程消费后渲染。

    Streamlit DeltaGenerator 只能在脚本线程 enqueue；LangGraph 并行节点
    在工作线程。bridge 的 `info` / `push_report` 只做 `queue.put`
    （线程安全、永不抛）——display 的事件循环（脚本线程）消费队列后
    调用真实 DeltaGenerator。
    """

    def __init__(self, events: queue.Queue):
        self._events = events

    def info(self, message: str) -> None:
        self._events.put(("progress", message))

    def push_report(self, key: str, content: str) -> None:
        self._events.put(("report", key, content))


def push_report(updater, key: str, content: str) -> None:
    """agent 节点完成即推送报告（节点级即时填充，1-1-1-1-1 而非 2-2-1）。

    updater 是 ProgressBridge → 入队（工作线程 queue.put 立即可达，脚本
    线程消费即渲染，不等同一 superstep 的慢节点）；None / 非 bridge
    （离线图测试的 `_ThrowingUpdater`、无 UI 上下文路径）→ no-op——
    display 的 superstep update 兜底路径仍会渲染该报告（同 key 去重）。

    :param key: 该 agent 返回的 State key（fundamental_analysis /
                trend_analysis / bullish_opinions / bearish_opinions /
                final_decision）
    """
    if updater is None or not hasattr(updater, "push_report"):
        return
    updater.push_report(key, content)
