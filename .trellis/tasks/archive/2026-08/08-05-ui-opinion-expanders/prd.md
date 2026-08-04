# UI：观点 tab 可折叠条目（expander）

## Goal

观点 tab（bullish_opinions / bearish_opinions）渲染从"平铺追加"改为
**可折叠条目**（st.expander）：每份观点一个"第 n 次观点"条目，第 1 次默认
展开、后续默认折叠（用户先见初稿，修订版可点击展开，不占空间）；非观点
key（fundamental/trend/final_decision）保持现状平铺（单份内容，无多次）。

背景：08-05 用户实测 UI 后反馈"期待可缩放的条目，而不是直接平摊"。

## Requirements

- R1: `core/ui/display.py` 渲染循环——观点 key（bullish_opinions /
      bearish_opinions）每份观点一个 `st.expander("第 {n} 次观点",
      expanded=(n == 1))` 包裹 `st.write(content)`；tab 内 header
      （REPORT_TITLES[key]）仍只在第 1 次渲染时输出。
- R2: 非观点 key 渲染行为零变化（header + 平铺内容，无 expander）。
- R3: `(key, content)` 去重、per-key 计数（counts）语义不变；
      `_stream_graph_events` / ProgressBridge / 事件协议零改动。
- R4: 观点 key 判定用模块级常量（如 `OPINION_REPORT_KEYS`），靠近
      REPORT_TABS 定义，注释说明。

## Acceptance Criteria

- [ ] AC1: display.py 渲染循环实现 expander 形态（观点 key）；非观点 key
      平铺不变（代码事实 review）。
- [ ] AC2: `test_display.py`（源码 introspect）全绿；`test_graph_parallel.py`
      7 用例全绿（bridge 断言只管事件）。
- [ ] AC3: spec（core/index.md UI 段）同步 expander 渲染契约，提交。
- [ ] AC4: streamlit 热加载/重启后可用（不跑全量回归——app 在跑，flock
      互斥；改动仅渲染形式，风险面由 display 测试覆盖）。

## Constraints

- 只改 `core/ui/display.py` + core spec；不碰事件协议/agent/测试断言。
- expander 文案中文（"第 n 次观点"），与轮次标签语义一致。
