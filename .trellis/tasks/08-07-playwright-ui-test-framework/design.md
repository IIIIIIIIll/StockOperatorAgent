# Design: Playwright UI 测试框架（mock 模式）

## 架构总览

```
pytest test/e2e/  (Playwright sync API, 无新依赖)
   │  conftest.py fixtures
   ├── session: spawn `streamlit run test/e2e/mock_app.py` (headless, 端口 8502,
   │            env: DEEPSEEK_API_KEY=dummy)
   │            └─ 等 /_stcore/health 就绪 → 浏览器 context (chromium headless)
   ├── 用例: 结构断言为主 (文本/存在性/数量), 必要处像素断言
   │
   mock_app.py (streamlit 入口, 仅 test/e2e/ 内)
   │   1. import core.ui.display as display
   │   2. display.build_stock_information = mock_build_stock_information
   │      (读 seed/fixture_002027.txt 原样返回, 接受 progress 回调)
   │   3. display.committee = MockCommittee()
   │   4. write_ui()  ← 与生产同一条 UI 代码路径
   │
   MockCommittee.make_investment_committee(config, progress_updater)
   └── FakeGraph.stream(inputs, config)  → 迭代吐 {node: {报告key: markdown文本}}
```

**生产代码零改动**：`write_ui` 按模块全局名 `committee` /
`build_stock_information` 查找（display.py:96-237），mock 入口在
`import` 后替换这两个名字即可，真实 `InvestmentCommittee()` 顶层构造
（display.py:31）虽然会发生，但**从不被调用** —— `write_ui` 用的已是
替换后的全局。不产生任何 LLM 构造副作用？→ 注意：顶层
`committee = InvestmentCommittee()` 本身会构造 DeepSeekApi（无 key 抛
OpenAIError）。因此服务器 env 必须注入 dummy `DEEPSEEK_API_KEY`，一箭
双雕：满足顶层构造 + 绕过 `_has_deepseek_key()` 门禁（display.py:104）。

## 已验证的关键契约（2026-08-07 对照代码）

| 契约 | 位置 | mock 侧要求 |
|---|---|---|
| `display.committee` 模块全局 | display.py:31 | 替换为 `MockCommittee()` |
| `committee.make_investment_committee(config, progress_updater=bridge)` | display.py:172 | 返回 `FakeGraph`（构造零 LLM） |
| `graph.stream(inputs, config)` 迭代 `{node: update}` | display.py:85-88 | 每次 yield `{"mock_node": {报告key: 字符串}}`；结束自然停止（stream 迭代完 → finally 推 done） |
| 报告 key → Tab | REPORT_TABS display.py:35-42 | 5 key: fundamental_analysis / trend_analysis / bullish_opinions / bearish_opinions / final_decision |
| 观点 key → expander「第 n 次观点」 | OPINION_REPORT_KEYS display.py:46 | bullish/bearish 渲染为 expander，第 1 次默认展开 |
| `_report_content` 接受裸字符串 | display.py:49-58 | 直接喂 markdown 字符串（stream update 形态） |
| `build_stock_information(ticker, progress=...)` | display.py:136 | mock 返回 fixture 文本，progress 回调可不调 |
| 门禁 `_has_deepseek_key()` | display.py:104-107 | env dummy key |
| `is_bj_ticker` 4/8 开头拦截 | tdx_source.py:50-56 | 用例用 43xxxx/83xxxx 作 BJ 样例 |
| 图表渲染 | charts.iter_data_charts → st.altair_chart | DOM 为 `.vega-embed` / canvas；断言 canvas 元素存在且尺寸 > 0 |
| 健康检查 | streamlit 内建 | GET `/_stcore/health` 返回 "ok" |

## 文件布局

```
test/e2e/
├── mock_app.py            # streamlit 入口（mock 替换 + write_ui）
├── mock_committee.py      # MockCommittee + FakeGraph
├── conftest.py            # server/browser/页面 fixtures + 截图 on-fail
├── test_smoke.py          # 冒烟: 标题/表单/6 tab
├── test_interaction.py    # 交互: 提交 002027 → 图表/表格/5 报告 tab
├── test_invalid_input.py  # 无效输入 + BJ 拦截
├── test_theme.py          # colorScheme 仿真切主题 → 背景色断言
└── seed/
    └── fixture_002027.txt # build_stock_information("002027") 真实输出
scripts/export_seed_002027.py  # 一次性导出脚本（需网络；产物入库后不再运行）
```

## 服务器生命周期（conftest session fixture）

1. 子进程 `streamlit run test/e2e/mock_app.py --server.headless=true
   --server.port=8502 --server.address=127.0.0.1
   --browser.gatherUsageStats=false`，env 注入 dummy key
2. 轮询 `/_stcore/health` 至 "ok"（超时 60s）；启动失败 → fixture error
   （带 stderr 输出定位）
3. 端口可配置（`SOA_E2E_PORT` env），避免 CI/本地冲突
4. teardown: terminate + wait；每个用例失败时截图保存到
   `logs/e2e/<test_name>.png`（复用仓库 logs/ 惯例）

## 主题断言（1.61.1 行为，memory 记录）

1.61.1 主题切换不在 ⋮ 菜单（菜单只读/持久化），用 CDP
`Emulation.setEmulatedMedia(colorScheme=dark|light)` 仿真；
背景色契约：亮 #FFFFFF / 暗 #0E1117（.streamlit/config.toml）。

## 零 LLM / 零网络验证设计

- FakeGraph 计数器：模块级 `CALL_COUNT`，mock 层自检（断言 0 次真实
  构造/调用）
- 运行日志：服务器日志无 `agent graph streaming` / DeepSeek / TDX 抓取
  痕迹（conftest 收集 server stderr 供失败诊断）
- 种子 fixture 生成后 `git diff` 核对生产目录无改动

## 风险与对策

| 风险 | 对策 |
|---|---|
| 顶层 `InvestmentCommittee()` 无 key 构造即抛 | env 注入 dummy key（见上） |
| streamlit 首次启动慢（Vega 资源加载） | 等待条件用「报告内容出现」而非固定 sleep；首启预热一次 |
| VegaLite canvas 断言脆弱 | 断言 canvas 存在 + 尺寸 > 0，不断言像素内容 |
| 端口占用 | 可配置端口 + 启动失败清晰报错 |
| FakeGraph 文本需触发 `st.write` 渲染 markdown | 报告文本带 `#` 标题 + 列表，断言其渲染后的 DOM 节点 |

## 依赖

无新增：playwright（已装）、pytest（已有）、streamlit（已有）。
不使用 pytest-playwright 插件，conftest 直接 `sync_playwright()`。
