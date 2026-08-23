# 全仓 Review 整改执行(2026-08-22 五路并行审查)

## Goal

执行 2026-08-22 五路并行 review 的**全部已复核确认项**。输入 = `.trellis/tasks/08-22-repo-review-remediation/findings_verified.md`(验证轮结论:≈40 条目 → 7 REFUTED / 6 PARTIAL / ~27 CONFIRMED,每项带 file:line 证据与修正锚点)。

用户价值:安全(遍历/注入)面实证关闭、Yahoo 采集链超时补齐(429 锁死根治)、事件协议契约回归、App 层浮层/权限/文档缺陷清零、测试缺口(编排零覆盖)关闭、死代码/规格漂移清理 —— 全部按 guides 35% FP 预算复核后**只修成立项**。

## In Scope

按域(A 安全CI / B 数据源 / C 核心 / D AppRN / E 测试规范),逐条对 findings_verified.md:

| 域 | 项 | 修复内容 |
|---|---|---|
| A | A3, A4, A5, A6 | tag↔version CI 强制;签名脚本严格 base64;child.mjs store-op 入参校验(纵深);server Host 头校验 |
| B | B1, B2-残余, B3, B4, E9 | Yahoo 链全链路超时(AbortController,RN 兼容);fc 回落 404-带-cookie 解析不对称;putStock 字段级合并(不覆盖好数据);单 bar 今日边 change_pct 归 NaN 对齐 CN;isYahooMarket 去重单源 |
| C | C1, C2, C3 | events 不再越过事件边界抛错(契约 error-handling.md);runner 并发守卫(busy → error 事件);store-idb close() flush 队列 |
| D | D1, D2-ghost, D4, D5, D6, D7, D8, D9, D11, D12, D13, D14, D15, a11y#15 | 菜单位置重测/clamp/maxWidth;web fade 穿透(animationType none);SettingsPanel 卸载守卫+竞态;settings 文档修正;DataScreen 死字面量;错误横幅运行中不清;Kotlin POST_NOTIFICATIONS 请求;冗余 stopPropagation 清理;稳定 key;IndicatorChart resize;✓分析完成仅 done 后显示;菜单 ARIA 角色 |
| E | E1, E2, E3, E4, E5, E6, E7, E8, E10, E11 | useAnalysis 编排可测化+测试;updateOverview/listStocks/device-finnhub/handleYahooCollect/settings env 回落/demoLlm 兜底测试;死导出删除(gates 两符号连测试删);3 处 spec 漂移修正;lotSize 删除;safe() 吞异常文档化 |
| 验收 | — | 每项修复附文件/测试证据;`findings_verified.md` 加「关闭状态」列(修复后回填) |

## Out of Scope(验证轮 REFUTED / investigated-not-bug,不修;已在 findings_verified.md 记录防翻案)

- **A1 server.mjs 遍历** / **A2 release.yml 注入**:REFUTED(实证 403 / bash 参数展开不可注入)。
- **B2 空哨兵碰撞**:REFUTED(null 是哨兵非值);只修残余的一行 404-cookie 不对称(已列入 In Scope)。
- **C4 中途失败丢部分结果**:R4 有意设计(失败不写 lastRun,旧缓存保留)。
- **D2 原「死点击窗」**:REFUTED(实际是穿透);穿透本身 → In Scope 的 D2-ghost 修复。
- **D3 双击测量竞态**:REFUTED(不可触发,幂等 FIFO)。
- **D12 键盘焦点陷阱**:REFUTED(RNW ModalFocusTrap 内建);仅 stopPropagation 清理在列。
- **a11y#16 aria-modal**:REFUTED(RNW 自带;背景捕手非 dialog 根)。
- **新 npm 依赖**:除非仓库已有,禁止引入(用现有 vitest/react 生态取测试路径)。

## 验收准则(AC)

- [ ] AC1 全量关闭:findings_verified.md 中所有 In Scope 项已修复,每项可指向 diff 路径 + 测试证据;REFUTED 项无代码改动。
- [ ] AC2 根 `npx vitest run` 全绿:现有 511 通过 + 新增测试全部通过;无 skip 意外新增。
- [ ] AC3 `npx tsc --noEmit` 无**新增**错误(基线为准;若有新增必须清零)。
- [ ] AC4 行为零回归:test/architecture.test.ts 七断言不破坏;proxies 504→锁→200 语义保持(现有测试逻辑);C1 改契约后 events.test.ts 相应更新且事件顺序断言不破。
- [ ] AC5 规格同步:E8 三处 spec 漂移修正(§7 措辞/agents-tools.md:49/chart-ui.md:21);cross-platform-thinking-guide.md「已知平台差异清单」追加 web fade 穿透件;error-handling.md 若契约措辞需微调则一并。
- [ ] AC6 过程:8 切片并行实施 → 整合串行验证 → trellis-check 质量门 → 全部 commit(Phase 3.4);改动经 review,无未审直接合入。»- [ ] AC6 过程:**串行单元制**——每修一个问题:全量回归(vitest+tsc)通过后单独 commit,再进下一个(用户裁决,替代原并行方案);全改动经 review,无未审直接合入。

## 依赖与并行(摘要,详见 design.md)

8 切片无阻塞依赖,可全并行;唯一约束 = 文件所有权互斥(useAnalysis.ts / App.tsx / yahoo 链 / market.ts 各归一片)。切片全部完成后由整合人串行跑验证门(集成期不得并行跑测试,避免 5s 超时误报 — 已验证 6 agent 并行时出现 9 个超时假失败)。**串行单元制**:无并行;32 个修复单元按序执行,每单元 = 一次回归验证 + 独立 commit(见 implement.md U1-U32)。同文件簇(useAnalysis.ts / App.tsx)单元相邻排列,保证任意时刻单写者。
