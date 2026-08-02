"""progress_updater 安全调用（2026-08-02，review #4 并行化引入的修复）。

LangGraph 并行节点（fundamental/trend/bullish/bearish）运行在内部工作
线程；Streamlit `DeltaGenerator.info()` 只能在脚本运行线程 enqueue——
工作线程调用即 `streamlit.errors.NoSessionContext`，会把整个分析打崩
（实测 2026-08-02：002027 分析在 trend 节点崩溃）。本 helper 把进度输出
降级为尽力而为：非脚本线程 → debug 日志，不影响分析。manager 节点在
join 后仍运行于脚本线程，其进度照常显示。
"""

from loguru import logger


def safe_progress(updater, message: str) -> None:
    """尽力输出进度：无 updater / 非脚本线程（并行节点）→ 跳过（debug 日志）。

    :param updater: Streamlit DeltaGenerator（或 None——无 UI 上下文路径）
    :param message: 中文进度文案（与既有提示风格一致）
    """
    if updater is None:
        return
    try:
        updater.info(message)
    except Exception:
        logger.debug("Progress update skipped (non-script thread): {}", message)
