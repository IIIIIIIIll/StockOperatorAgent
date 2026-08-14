# B1：亿信 caps 接线（child A）

## Goal

修复审计 BLOCKER-1：设置面板「亿信调用上限」（searchMax/twitterMax/fetchMax）当前只存 localStorage、从不生效。接线到工具层，面板值真实控制亿信工具单次 run 调用上限。

## Background

- 审计证据：`archive/2026-08/08-14-py-ts-gap-audit/research/00-gap-report.md` §2 BLOCKER-1（三片交叉印证）。
- 现状：`settings.ts:18-22` CapsState 定义、`SettingsPanel.tsx:31-35` 渲染、`settings.ts:46,69` 持久化；`runner.ts assembleTools`（168-177）只收 keys 不收 caps；`App.tsx` 不写 env；`billionsTools.ts:159-161` `maxCallsFor` 只读注入或 env。
- 决策（用户 2026-08-14）：接线到工具层。

## Requirements

1. caps（searchMax/twitterMax/fetchMax）从 settings 传入 `assembleTools` → `makeBillionsTools` 的 `opts.maxCalls` 注入（billionsTools.ts:145 参数已就绪）。
2. 面板值优先于 env `BILLIONS_{CAP}_MAX_CALLS`，env 优先于默认（与 `maxCallsFor` 现有注入>env>默认 优先级一致）。
3. 未设置/非法值 → 回退 env/默认（不崩、不 NaN）。
4. Python 对照：display.py:143-146 会话覆盖经 runtime_int 生效——TS 面板改动即生效（App.tsx 现有变更即 apply 模式）。

## Acceptance Criteria

- [ ] SettingsPanel 改上限 → 下一次分析亿信工具按新上限计数（超限占位文本含新数字）
- [ ] env 覆盖在未改面板时仍生效（现有行为不回退）
- [ ] vitest 新增用例覆盖：caps 注入优先、非法值回退、三 cap 各自生效
- [ ] 现有 vitest 全绿 + `tsc --noEmit`

## Out of scope

- 亿信开关正极性覆盖键（P-2，NON_BLOCKER）
- UI 控件移除（决策为接线，不移除）
