---
description: UI E2E 测试 — Playwright mock 模式、种子快照、零调用审计
paths:
  - test/e2e/**
---
# UI E2E 测试框架（`test/e2e/`）

- **2026-08-07（UI E2E 测试框架,08-07-playwright-ui-test-framework）**：
  - **运行**：`pytest test/e2e/ -v` —— mock 模式（FakeGraph + 002027 种子
    快照）启动 streamlit + Playwright 结构断言，15 用例 ~19s（门槛 < 2
    分钟），**零 LLM API 调用、零 TDX/akshare 网络抓取**。UI 改动验收
    秒级完成，不跑完整链路（TDX 抓取 + 5 代理 DeepSeek，分钟级烧 token）。
    生产代码零改动（`git diff` 核实 core/、main.py、agents/、data_*/）。
  - **mock 入口模式**：`test/e2e/mock_app.py` import 后替换
    `display.build_stock_information` / `display.committee` 模块全局 → 调
    `write_ui()` 走生产同一 UI 路径；`MockCommittee.make_investment_committee`
    返回 FakeGraph，`stream()` 迭代 yield `{"mock_node": {报告key: markdown}}`
    （bullish/bearish 各两条不同内容验证 expander 追加渲染）。`streamlit run`
    以脚本方式加载，mock_app 需显式把仓库根加入 sys.path（否则
    `import core.ui.display` ModuleNotFoundError）。
  - **dummy 三键真实用途**：env `LLM_API_KEY` / `LLM_MODEL` /
    `LLM_BASE_URL` dummy 只为绕过 `_llm_configured()` 门禁（三键齐全才
    放行，08-09-llm-provider-agnostic）——`InvestmentCommittee` 无
    `__init__`，make_llm() 只在真实 `make_investment_committee` 内构造
    （mock 已替换，不触发任何 LLM 构造）。
  - **种子快照**：`test/e2e/seed/fixture_002027.txt` 为
    `build_stock_information("002027")` 输出原样固化（overview/日K/业绩/
    指标/情报六段）；再导出必须 `env -u TDX_API_KEY`（否则
    `get_market_intel` 输出实时情报文本，fixture 不可复现）。
  - **零调用审计**（双重）：① 结构性——mock 替换 display 两个模块全局，
    display 无其他入口；② 运行时——mock 自检日志 `E2E_MOCK_CALL_COUNT`
    （提交型用例构造 mock 图计数 ≥1）+ 服务器日志无真实链路标记。**真实
    链路标记注意**：TDX 成功路径日志是 debug 级 `"fetching from network"`
    （tdx_source.py:160），**不是类名 "TdxSource"**——后者只在异常
    traceback 出现，成功抓取不打类名（audit 标记用错会变成近似失效）。
  - **1.61.1 实测差异（Playwright 断言）**：① 图表渲染为 **svg**（非
    canvas）→ 断言 `.vega-embed svg` 尺寸 > 0，不读像素；② tab 选择器是
    `[role="tab"]`（非 `[data-baseweb="tab"]`）；③ tab 条渐进渲染（先渲染
    2 个再补全）+ tab 点击偶发被 React 重渲染吞掉 → 等最后一个 tab 出现
    再断言 + `_open_tab` 重试 helper。等待用「内容出现」条件而非固定
    sleep。
  - **服务器生命周期（conftest）**：子进程 `streamlit run`（headless、
    `SOA_E2E_PORT` 可配默认 8502、`--browser.gatherUsageStats=false`）→
    轮询 `/_stcore/health` ok（60s 超时，失败带 stderr）→ chromium
    context；**端口冲突加固**：streamlit 端口被占时打印 "Port is not
    available" 后退出，但退出可能晚于 health 通过（旧服务返回 ok）——
    health ok 后沉降 2s 再确认本进程存活（rc=1 则报清晰 fixture error）。
    用例失败截图 `logs/e2e/<test_name>.png`；`pytest_sessionfinish` 零
    调用审计（server fixture 失败时经 session.stash 跳过，不叠加误导
    断言）。teardown terminate+wait，不留残留进程（mock 服务器从不构造
    ZODB storage，无 flock 冲突）。
