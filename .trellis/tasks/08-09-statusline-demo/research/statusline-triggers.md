# omp 状态栏各段触发条件

来源：`~/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/dist/cli.js`（版本以安装为准），段 id 枚举来自 `dist/types/config/settings-schema.d.ts` 的 `StatusLineSegmentId`。

## 段 id 全集（24 个）

`pi, model, mode, path, git, pr, subagents, token_in, token_out, token_total, token_rate, cost, context_pct, context_total, time_spent, time, session, hostname, cache_read, cache_write, cache_hit, session_name, usage, collab`

## 渲染规则总则

- 条件渲染：`render()` 返回 `{content, visible}`，`visible:false` 时**零宽度跳过**，不影响布局。
- 布局：`leftSegments` → 左侧；`rightSegments` → 右侧。`custom` preset 下由配置决定，其余 preset 有内置默认。
- **内置附加项（不受配置控制）**：
  - `subagentCount > 0` 时，右侧硬编码显示 `⛳ N agent(s)` 摘要（`#V0()`，`if(this.#z===0)return`），且左右循环中均有 `if(G && I==="subagents") continue` 强制跳过配置里的 `subagents` 段；`subagentCount === 0` 时 `#V0()` 返回 undefined，此时配置段虽进入循环但其自身 renderer 返回 `visible:!1` → **`subagents` 段两种情况下都不显示（死代码，永不渲染）**。
  - 运行中异步 job 数 `J > 0` 时，右侧硬编码显示 `job 图标 + J`（`getAsyncJobSnapshot().running.length`，unshift 到右侧）。两者均 unshift 到右侧最前，顺序为 `[G 摘要, job 计数, ...rightSegments]`。

## 各段触发条件（核验列：✅ 本会话直接核实 / ⬜ 待 trellis-check 核验）

| 段 | 显示条件 | 触发方式 | 核验 |
|---|---|---|---|
| `pi` | 恒显示（omp 图标） | 无 | ✅（渲染循环可见） |
| `model` | 恒显示：模型名 + thinking level（`segmentOptions.model.showThinkingLevel` 控制后缀；仅模型支持 thinking 时有后缀） | 无 | ✅ |
| `mode` | plan/prewalk/goal/vibe/loop 任一模式激活 | `/plan`、loop/vibe/goal 模式开关 | ✅（PS1 renderer） |
| `collab` | collab 会话中：host `⇄ collab:N` / guest `⇄ collab guest:N` | `/collab` 或 `/join` | ✅（ZI1 renderer） |
| `path` | 恒显示：cwd（`abbreviate`/`maxLength`/`stripWorkPrefix` 选项；worktree/scratch 变体） | 无 | ✅ |
| `git` | git 仓库（无分支且无 status 时 hidden）；分支 + staged/unstaged/untracked 标记（`showBranch`/`showStaged`/`showUnstaged`/`showUntracked` 选项，均有值才亮） | 仓库有改动即亮脏标记 | ✅ |
| `pr` | 当前分支存在关联的 open PR | 在 PR 分支上工作 | ✅（lS1 renderer：无 PR → hidden） |
| `subagents` | **永不显示**（死代码，见总则） | — | ✅ |
| `token_in` / `token_out` / `token_rate` / `token_total` | 有对应 usage 统计时（无数据 → hidden；`token_total` = input+output+cacheWrite+orchestrationInput+orchestrationOutput） | 模型请求发生时 | ✅ |
| `cost` | 有会话成本数据时（cost / 高级请求 ★ / OAuth (sub) / advisor 成本 (adv) 任一非空） | 请求发生后累计 | ✅ |
| `context_pct` | 恒显示：上下文占用百分比 | 上下文增长 | ✅ |
| `context_total` | 存在 contextWindow 时 | 有上下文窗口 | ✅（uI1 renderer） |
| `time_spent` | `activeMs >= 1000`。activeMs 是**agent 活动累计时间快照**（`markActivityStart/End`），非墙钟；只在活动结束累加 + UI 事件重绘，不持续跳动 | 会话内累计 agent 活动 ≥1s | ✅（pI1 renderer） |
| `time` | 恒显示：当前时钟（`12h`/`24h`、`showSeconds` 选项） | 无 | ✅ |
| `session` | 恒显示：session id 前 8 位（无 id 时显示 `new`） | 无 | ✅ |
| `hostname` | 恒显示：主机名（`os.hostname()` 取第一个 `.` 前） | 无 | ✅ |
| `cache_read` / `cache_write` / `cache_hit` | 有 provider 缓存统计时（无数据 → hidden；`cache_hit` 显示 `cacheRead/(cacheRead+cacheWrite+input)` 命中率百分比） | 命中缓存 | ✅ |
| `session_name` | **有会话名时显示**（`getSessionName()` 为空 → hidden，非恒显示） | 设置会话名后 | ✅ |
| `usage` | 有 5h/7d rate-limit 数据时（`fiveHour` 或 `sevenDay` 任一存在；tier 单独不足以显示），显示 tier / 5h / 7d 百分比 | 请求发生 | ✅（kI1 renderer 部分） |

## 配置现状（本演示任务）

```yaml
statusLine:
  preset: custom
  leftSegments: [pi, mode, collab, git, pr, subagents, context_pct]
  rightSegments: [session_name, time_spent]
```

## 观察记录

- 2026-08-09：scout 任务运行期间（36.7s），右侧出现 subagents 摘要与 job 计数；左侧 `subagents` 段始终未显示（死代码，与源码一致）。
- `time_spent` 在演示会话中随 agent 活动累计后显示（≥1s 门槛）。
