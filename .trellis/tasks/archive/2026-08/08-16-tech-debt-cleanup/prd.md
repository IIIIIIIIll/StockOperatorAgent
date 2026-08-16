# 技术债清理

## Goal

清理存量技术债:根 tsc 基线 3 诊断归零、Python/Streamlit 时代残留删除、桌面两处 polish;spec 同步更新。零功能变更。

## Background(confirmed facts)

- **tsc 基线诊断**:`src/mcp.ts`(95/139)+ `src/billionsClient.ts`(124)共 3 个 TS2769——`AbortSignal.timeout()` 返回值与 fetch 期望的 `global.AbortSignal` 形状不兼容(onabort: `Event` vs `AbortEvent`)。版本矩阵实证:`@types/node@26.1.0` 干净、**26.2.0 引入回归**(web-globals AbortSignal 重构);TS 7.0.2 与 @types/node 24/26.0/26.1 均无冲突。
- **`.streamlit/`**:已在提交 `d2ddd5a` 删除;spec `ts/index.md` 仍记载「保留待用户决策」——文本过期。
- **Python 残留**:仅剩 `data_source/chinese_mainland/tdx/vendor/`(56 文件,VENDOR.md 快照,零 TS 消费;测试仅注释提及 "vendor 语义")。
- **test/fixtures/**:9 个 TS 测试文件实际消费,保留。
- **desktop**:每次 stop 退出码 1(疑 3s SIGKILL 兜底而非优雅路径);`desktop/package.json` 缺 dist 构建脚本。

## Requirements

- R1 根 `tsc --noEmit` 0 诊断(@types/node 固定 26.1.0,去 ^)
- R2 删除 `data_source/chinese_mainland/tdx/vendor/`(先证零引用)
- R3 spec 同步:.streamlit 已删、vendor 已删、fixtures 活跃说明
- R4 desktop:`build` 脚本(expo export → dist);优雅退出路径核查(exit=1 根因,可修则修)
- R5 全量回归:vitest 全绿 + app tsc 0 错 + desktop-probe 通过

## Acceptance Criteria

- [ ] `npx tsc --noEmit` 0 错误
- [ ] git 树无 `data_source/` 目录、无 .streamlit 残留
- [ ] spec 无过期残留描述
- [ ] `desktop/package.json` 有 `build` 脚本且可跑
- [ ] 应用退出:优雅路径(flush+close)实际生效或确认 exit=1 无害原因
- [ ] vitest 全绿 + app tsc 0 错 + desktop-probe 通过

## Out of Scope

- 功能/行为变更;electron-builder 打包;Windows 实机验证
- vendor 内容迁移(删除即 git 历史保留)

## Key Decisions

- @types/node 固定 `26.1.0`(精确版本,非 ^)——实证回归边界
- vendor 整体删除(用户批准「清理可删部分」;fixtures 全保留)
