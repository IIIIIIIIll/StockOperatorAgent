# UI：观点 tab 多次观点轮次标签呈现

## Goal

`core/ui/display.py` 观点 tab（bullish_opinions / bearish_opinions）的追加渲染升级：
同 key 每次追加的观点带**轮次标签**（"第 1 次观点"、"第 2 次观点"……），替代当前
朴素的 `---` 分隔线——用户能一眼看到"初稿 → 修订版"的对抗过程结构，并自动适配
未来多轮互驳（每轮追加自然成为第 3、4 次观点）。

背景：08-04-adversarial-verdict-loop 已实现初稿+修订版追加渲染（同 key 按
`(key, content)` 去重，`---` 分隔）。本任务只升级**展示形式**，不动数据流。

## Requirements

- R1: 同 key 第 1 次渲染 → `st.header(REPORT_TITLES[key])` + 内容（现状不变）；
  后续每次渲染 → 分隔 + **"第 n 次观点"标签**（如 `**第 2 次观点**`）+ 内容。
  标签用通用轮次计数（非"初稿/修订版"字样）——未来多轮互驳自动成立。
- R2: `(key, content)` 去重语义不变（superstep 兜底重复推送仍跳过）；
  `rendered_keys` 首次渲染语义由 key 计数（per-key counter）替代，行为等价。
- R3: 进度消息/报告推送（`_stream_graph_events`、ProgressBridge）零改动；
  非观点 key（fundamental/trend/final_decision）仍单次渲染，无标签。

## Acceptance Criteria

- [ ] AC1: `display.py` 渲染循环实现 per-key 轮次计数：第 1 次 header+内容，
      第 n（n≥2）次 `---` + 轮次标签 + 内容。
- [ ] AC2: `(key, content)` 去重保留；语义与 08-04-adversarial-verdict-loop
      （verdict 阶段）完全兼容（行为等价替换 `rendered_keys`）。
- [ ] AC3: 全量回归 `python -m pytest` 0 新增失败（基线 236P/20S/0F）；
      `test_graph_parallel.py` 7 用例不动仍全绿（bridge 断言只管事件，不管渲染）。
- [ ] AC4: 渲染循环改动不破坏 `test_display.py`（其通过源码 introspect tab
      顺序——核对无影响）。
- [ ] AC5: spec（core/index.md UI 段）同步：追加渲染契约补"轮次标签"描述并提交。

## Constraints

- 纯 UI 展示改动：不碰 agent/图/State/测试断言（除核对）。
- 轮次标签文案用中文 house style（"第 n 次观点"），与既有 UI 文案一致。
