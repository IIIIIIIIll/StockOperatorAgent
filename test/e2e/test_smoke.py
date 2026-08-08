"""冒烟：标题 / ticker 表单 / 提交按钮 / 报告 tab（08-07-playwright-ui-test-framework）。

结构断言为主（文本/存在性/数量），模型不能读图——不读像素内容。
mock 服务器（test/e2e/mock_app.py）零 LLM、零网络；服务器/浏览器
fixtures 见 conftest.py。

1.61.1 结构注记（实测）：tab 按钮选择器是 `[role="tab"]`（非
`[data-baseweb="tab"]`）；tab 只在**提交有效代码后**创建（write_ui 内
st.tabs）——主服务器（dummy BILLIONS_API_KEY）共 8 个（数据 + 7 报告，
含「信息面分析」；无 key 布局见 test_billions_tab.py）。
"""


class TestSmoke:

    def test_page_title_and_heading(self, page):
        """浏览器标签页标题 + 页面主标题（st.title）。"""
        assert page.title() == "超绝AI股票分析系统"
        heading = page.locator("h1").first
        heading.wait_for(timeout=30000)
        assert heading.inner_text() == "超绝AI股票分析系统"

    def test_ticker_form_and_submit_button(self, page):
        """ticker 输入框（带「股票代码」标签）+ 提交按钮存在。

        1.61.1 结构注记（实测）：st.text_input 的「股票代码」渲染为
        label（非 placeholder 属性——placeholder 为空串）。
        """
        inp = page.get_by_label("股票代码")  # 按 label 定位（面板先渲染，input.first 会命中折叠 expander 内的隐藏输入）
        assert inp.is_visible()
        page.get_by_text("股票代码", exact=True).first.wait_for(timeout=10000)
        assert page.get_by_role("button", name="提交").count() == 1

    def test_tabs_after_submit(self, page):
        """提交有效代码 → 数据 Tab + 7 报告 Tab 共 8 个（顺序契约 report_tabs()）。

        08-08-billions-api-integration（Step 5）：conftest 给主服务器注入
        dummy BILLIONS_API_KEY → ANALYST 开 → 多「信息面分析」（第 4 位
        专家报告，技术指标分析之后）；无 key 布局见 test_billions_tab.py。

        1.61.1 结构注记（实测）：rerun 的 tab 条**渐进渲染**——等第一个
        tab 出现后 count 可能只有 2，须等最后一个 tab（最终结论）出现
        再断言数量。
        """
        page.get_by_label("股票代码").fill("002027")
        page.get_by_role("button", name="提交").click()
        tabs = page.locator('[role="tab"]')
        tabs.filter(has_text="最终结论").first.wait_for(timeout=30000)
        labels = [t.inner_text() for t in tabs.all()]
        assert len(labels) == 8, f"expected 8 tabs, got {labels}"
        assert labels == ["采集数据", "基本面分析", "趋势分析", "技术指标分析",
                          "信息面分析", "看涨观点", "看跌观点", "最终结论"]
