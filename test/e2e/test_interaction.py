"""交互：提交 002027 → 数据 Tab 图表/表格 + 5 报告 Tab（08-07-playwright-ui-test-framework）。

mock 种子（seed/fixture_002027.txt）是 build_stock_information("002027")
的真实输出原样快照——数据 Tab 的图表/表格由同一份文本经
data_markdown/charts 纯函数渲染，与生产展示路径一致。

1.61.1 结构注记（实测）：
- altair 图表经 vega-embed 渲染为 **svg**（非 canvas）——断言
  `.vega-embed svg` 存在且尺寸 > 0（结构断言，不读像素）；
- 报告 tab 面板**默认隐藏**（仅激活 tab 可见）——断言报告内容前须先
  点击对应 `[role="tab"]`；
- 观点 tab 每份观点一个 expander（第 1 次默认展开，第 2 次点击展开）。
"""

import time


def _submit_002027(page):
    page.get_by_label("股票代码").fill("002027")
    page.get_by_role("button", name="提交").click()


def _wait_tabs_ready(page):
    """tab 条渐进渲染——等最后一个 tab（最终结论）出现再交互。

    1.61.1 实测：rerun 中 tab 条可能先渲染 2 个再补全 6 个；在补全前
    点击 tab 会被后续 delta 重置激活状态（面板不切换）——交互前先等
    全 6 个 tab。
    """
    page.locator('[role="tab"]').filter(has_text="最终结论").first.wait_for(timeout=30000)


def _open_tab(page, tab_name: str, content_marker: str, timeout: int = 30000):
    """点击 tab 并等面板内容可见；点击可能被 rerun 的 React 重渲染吞掉
    （实测偶发：aria-selected 不切换）——失败重试，幂等。"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        tab = page.locator('[role="tab"]').filter(has_text=tab_name).first
        try:
            tab.click(timeout=5000)
        except Exception:
            pass  # 元素未就绪/点击被吞 → 下一轮重试
        try:
            page.get_by_text(content_marker).first.wait_for(timeout=5000)
            return
        except Exception:
            pass
    raise AssertionError(f"tab {tab_name!r} content {content_marker!r} never became visible")


class TestInteraction:

    def test_data_tab_charts_and_markdown_table(self, page):
        """数据 Tab：6 张 altair 图表（K线/成交量/收盘价/涨跌幅/净利润/每股
        收益）svg 渲染且尺寸 > 0；markdown 表格（概览/日K/业绩/指标/情报
        共 5 张 `<table>`）可见。

        1.61.1 结构注记（实测）：
        - 图表/表格随 rerun **渐进渲染**——须等最后一个图表
          （stFullScreenFrame 第 6 个）出现再断言数量；
        - markdown 表格的列值分列渲染（"Date" 与 "2026-08-07" 是不同
          cell）——断言 `<table>` 元素存在而非整行文本。
        """
        _submit_002027(page)
        # 图表：vega-embed 容器 + svg（首启预热 vega 资源可能较慢）
        page.locator(".vega-embed svg").first.wait_for(timeout=60000)
        page.locator('[data-testid="stFullScreenFrame"]').nth(5).wait_for(timeout=30000)
        assert page.locator('[data-testid="stFullScreenFrame"]').count() == 6
        box = page.locator(".vega-embed svg").first.bounding_box()
        assert box is not None, "vega svg has no bounding box"
        assert box["width"] > 0 and box["height"] > 0, f"vega svg size not positive: {box}"
        # markdown 表格：to_markdown_tables 5 张表（概览/日K/业绩/指标/情报）
        page.locator("table").first.wait_for(timeout=15000)
        assert page.locator("table").count() == 5

    def test_six_report_tabs_render_mock_content(self, page):
        """6 个报告 tab：点击 → 对应 header 与 mock 报告内容可见。

        mock 内容（mock_committee.MOCK_REPORTS）与真实 LLM 输出无关——
        断言「mock 内容原样渲染进对应 Tab」。tab 面板默认隐藏，先点击
        再断言（等待「内容出现」而非固定 sleep）。
        """
        _submit_002027(page)
        _wait_tabs_ready(page)
        cases = {
            "基本面分析": ("基本面分析（mock）", "mock 基本面结论"),
            "趋势分析": ("趋势分析（mock）", "mock 趋势结论"),
            "技术指标分析": ("技术指标分析（mock）", "mock 指标结论"),
            "最终结论": ("最终结论（mock）", "mock 最终结论"),
        }
        for tab_name, (header, content) in cases.items():
            _open_tab(page, tab_name, header)
            assert page.get_by_text(content).first.is_visible(), f"{tab_name} content not visible"

    def test_opinion_tabs_show_expander_rounds(self, page):
        """看涨/看跌观点 tab：每份观点一个 expander——第 1 次默认展开
        （初稿内容可见），第 2 次点击展开（修订版内容可见）。"""
        _submit_002027(page)
        _wait_tabs_ready(page)
        # 看涨：初稿 + 修订版（marker 用面板独有文本——「第 1 次观点」在
        # 隐藏的看跌面板里也有一份，get_by_text().first 会命中隐藏那份）
        _open_tab(page, "看涨观点", "mock 看涨初稿")
        # 隐藏面板的 expander 也在 DOM 中——用 :visible 限定激活面板；
        # 侧边栏「设置」expander（08-08-billions-switches-ui）恒可见，
        # 从总数中减去（主区域观点 expander = 总数 - 侧边栏那个）
        assert (
            page.locator('[data-testid="stExpander"]:visible').count()
            - page.locator('[data-testid="stSidebar"] [data-testid="stExpander"]:visible').count()
        ) == 2
        assert page.get_by_text("mock 看涨初稿").first.is_visible(), "第 1 次观点应默认展开"
        # 点击展开第 2 次观点（限定可见 expander——隐藏面板里也有一份）
        page.locator('[data-testid="stExpander"]:visible').filter(has_text="第 2 次观点").first.click()
        page.get_by_text("mock 看涨修订").first.wait_for(timeout=15000)
        # 看跌：初稿 + 修订版
        _open_tab(page, "看跌观点", "mock 看跌初稿")
        assert page.get_by_text("mock 看跌初稿").first.is_visible(), "第 1 次观点应默认展开"
        page.locator('[data-testid="stExpander"]:visible').filter(has_text="第 2 次观点").first.click()
        page.get_by_text("mock 看跌修订").first.wait_for(timeout=15000)
