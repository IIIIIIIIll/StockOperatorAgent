"""08-02-ui-live-progress-bridge：ProgressBridge / push_report 纯行为测试。

bridge 是线程安全事件通道（工作线程入队、脚本线程消费后渲染）；离线
直接检查 queue 内容，不 mock Streamlit（house style）。集成侧（真实图
+ 假 LLM 跑通五节点推送）见 test_graph_parallel.py 的 bridge 用例。
"""

import queue

from core.llms.progress import ProgressBridge, push_report, safe_progress


class TestProgressBridge():

    def test_info_enqueues_progress_event(self):
        events = queue.Queue()
        ProgressBridge(events).info("开始分析")
        assert events.get_nowait() == ("progress", "开始分析")

    def test_push_report_enqueues_report_event(self):
        events = queue.Queue()
        ProgressBridge(events).push_report("trend_analysis", "内容")
        assert events.get_nowait() == ("report", "trend_analysis", "内容")

    def test_safe_progress_with_bridge_enqueues(self):
        """bridge 的 info 永不抛——safe_progress 不再走降级路径（无 skip 日志）。"""
        events = queue.Queue()
        safe_progress(ProgressBridge(events), "开始趋势分析报告生成。。。")
        assert events.get_nowait() == ("progress", "开始趋势分析报告生成。。。")


class TestPushReportHelper():

    def test_none_updater_is_noop(self):
        assert push_report(None, "trend_analysis", "内容") is None

    def test_plain_updater_is_noop(self):
        """非 bridge updater（如离线图测试的 _ThrowingUpdater）→ 忽略；
        superstep update 兜底路径仍会渲染该报告。"""

        class _PlainUpdater:
            def info(self, message):
                raise AssertionError("should not be called")

        assert push_report(_PlainUpdater(), "trend_analysis", "内容") is None

    def test_bridge_updater_enqueues(self):
        events = queue.Queue()
        push_report(ProgressBridge(events), "final_decision", "决策内容")
        assert events.get_nowait() == ("report", "final_decision", "决策内容")
