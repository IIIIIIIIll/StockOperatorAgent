# Playwright UI 测试框架（mock 模式独立套件）

## Goal

独立前端 UI 测试框架：以 mock 模式（FakeGraph + 002027 种子快照）启动
streamlit 应用，用 Playwright 断言渲染与交互。**运行时零 LLM API 调用、
零网络数据抓取**，让每次 UI 改动验收从「完整流程（TDX 抓取 + 5 代理
DeepSeek 调用 + 分钟级）」降到「秒到分钟级、零 token」。

## Background

现状痛点：任何 UI 改动验证都要跑完整链路 —— `main.py` → `write_ui()` →
`build_stock_information`（TDX/akshare 网络抓取）→ `committee`（5 个
LLM 代理，真实 DeepSeek API，`display.py` 模块顶层即构造
InvestmentCommittee）→ threading+queue 增量渲染 → 浏览器人工验收。
慢且烧 token。

已有可复用资产：
- `test/core/llms/` 离线 FakeListChatModel 测试先例（spec: bind_tools
  NotImplementedError 回退即为离线保绿）
- `test/core/ui/` 纯函数单测（display/charts/theme/data_markdown）
- Playwright headless 已装（此前验收用过，未沉淀为套件）
- streamlit 1.61.1（含 AppTest，但本任务按用户拍板走 Playwright 路线 B）

## Requirements

1. **mock 入口脚本**（test 目录内，生产代码零改动）：
   - 替换 `core.ui.display` 模块全局 `committee` 与 `build_stock_information`
   - 替换后调用 `write_ui()`；可由 `streamlit run` 直接启动
   - 生产代码（`core/`、`main.py`、`agents/` 等）**不允许改动**
2. **种子快照**：002027 真实数据一次性导出固化为 fixture
   （`build_stock_information("002027")` 输出文本原样保存），mock 原样返回。
   导出脚本允许真实网络运行（一次性），固化后测试运行时不得再抓取。
3. **FakeGraph**：`make_investment_committee(config, progress_updater)` 返回
   假 graph，`stream()` 迭代吐固定 State（含 5 个报告 key），零 LLM 构造。
4. **Playwright 测试套件**：pytest + playwright sync API 自建 fixtures
   （不新增依赖，不装 pytest-playwright 插件）。断言以结构为主
   （文本/存在性/数量），像素断言仅必要处。
5. **范围**：
   - 冒烟：页面标题、ticker 表单、提交按钮、6 个 tab 存在
   - 交互：输入 002027 → 提交 → 数据 Tab 图表+表格、5 个报告 tab 渲染
     mock 报告内容（观点 tab 为 expander 折叠条目）
   - 无效输入：非 6 位数字报错；北交所代码报 BJ 不支持
   - 主题：亮/暗切换生效（1.61.1 colorScheme 仿真，非 ⋮ 菜单）
6. **运行约束**：全套用例 < 2 分钟；全程零 LLM/网络调用
   （可用日志/计数器断言验证）。

## Acceptance Criteria

- [ ] `pytest test/e2e/ -v` 一键全绿，全套时长 < 2 分钟
- [ ] 测试运行期间无真实 LLM API 调用、无 TDX/akshare 网络抓取
      （通过 mock 调用计数断言 + 运行日志检查验证）
- [ ] 冒烟用例：标题「超绝AI股票分析系统」、表单、提交按钮、6 tab 均渲染
- [ ] 交互用例：提交 002027 后数据 Tab 出现图表（altair canvas）与
      markdown 表格；5 个报告 tab 出现对应 header 与 mock 报告内容；
      看涨/看跌 tab 为「第 1 次观点」expander
- [ ] 无效输入用例：非法代码显示中文错误提示；北交所代码显示
      「北交所（BJ）股票暂不支持分析」
- [ ] 主题用例：colorScheme 仿真切换后页面背景色变化
      （亮 #FFFFFF / 暗 #0E1117 契约）
- [ ] `git diff` 确认生产代码（core/、main.py、agents/、data_*/）零改动

## Notes

- 决策记录（2026-08-07 用户拍板）：路线 B（Playwright 真实渲染，不走
  AppTest）；范围含交互断言（非仅冒烟）；种子用真实快照 002027
  （用户当前在用股票）；模型不能读图 → 结构断言为主。
- 门禁细节：`display.py` `_has_deepseek_key()` 要求 DEEPSEEK_API_KEY 存在
  才渲染 → 测试服务器 env 注入 dummy key 绕过（不触碰用户真实配置）。
