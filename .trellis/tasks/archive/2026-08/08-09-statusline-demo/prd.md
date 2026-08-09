# PRD: statusline 全功能演示

## 目标

用一次完整的 Trellis 任务生命周期（planning → in_progress → 派发子代理 → 验收 → 归档），真实点亮 omp 状态栏的各个条件段，并沉淀一份「状态栏各段触发条件」速查文档。

## 背景

- omp 状态栏 `statusLine.preset: custom`，当前配置：左 `[pi, mode, collab, git, pr, subagents, context_pct]`，右 `[session_name, time_spent]`。
- 多数段是条件渲染（无对应状态时隐藏零宽度）。本任务通过真实生命周期触发 subagents / time_spent / context_pct / git 等段，验证其显示行为。

## 交付物

1. `research/statusline-triggers.md` — 每个段的触发条件，基于安装包源码（`~/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/dist/cli.js`）逐段摘录渲染逻辑。
2. `.omp/extensions/trellis/index.ts` 新增状态栏展示：经 `pi.ui.setStatus("trellis", ...)` 在状态栏下方显示活动任务 slug + 标题 + phase（如 `08-09-statusline-demo · statusline 全功能演示 [in_progress]`）。
3. 生命周期观察记录（时间点、哪些段亮起、何时消失）。

## 验收标准

- 任务目录包含 `prd.md`、`research/statusline-triggers.md`
- 触发条件文档覆盖状态栏全部段 id（22+ 个），每条条件直接引自源码并有可复现的触发方式
- 扩展改动：`node:path` import 增加 `basename`；新增 `formatTaskStatusText` / `refreshTaskStatus`；`session_start`（主会话分支）与 `input` 处理器各调用一次刷新；无任务时清除状态文本；错误被 try/catch 吞掉（best-effort，不破坏会话启动）
- 任务走完 start → 派发（trellis-implement/trellis-check）→ 提交 → 归档 全流程
- 派发期间观察到状态栏 subagents 摘要出现、time_spent 累计

## 非目标

- 不改 omp 本体（不 patch dist）
- 不改状态栏配置
