# 实施计划:模块化与跨平台就绪度审计

## 执行顺序

1. **派发 4 个并行 scout**(一个 batch,agent=scout,read-only):按 design.md 四个切片问题集执行;每个 scout 把结构化发现写 `research/<slice>.md`(任务目录内),并返回压缩结论。
2. **综合**:主会话读 4 份 research → 交叉核对(重复发现去重、冲突结论回查源码)→ 写 `research/00-summary.md`(问题清单 + 三档优先级 + 耦合矩阵)。
3. **对照 AC 自检**:每项 AC 逐条核对,证据不足的补查(主会话直接 grep/read)。
4. **结论呈现**:向用户汇报审计结果;若存在高价值重构候选 → 建议后续任务(用户批准后另立)。
5. **收尾**:`task.py finish` + archive + 会话记录。零产品代码改动。

## 验证

- AC1-AC4:4 份 research 落盘,含 severity/location/evidence/impact/recommendation。
- AC5:00-summary.md 三档结论齐备。
- AC6:`git status --short` 仅任务目录与 research(无产品代码改动)。

## 禁用规则

- scout 一律 read-only,禁止改任何产品文件。
- 不跑全量 e2e / 不启动模拟器(纯静态审计)。
- 涉及"哪个实现是活路径"必须用 grep 引用方实证,不许猜。

## 提交前检查

- [ ] 4 份 research + 1 份 summary 落盘
- [ ] 每个发现带 file:line 证据
- [ ] 耦合矩阵成品
- [ ] git 仅含任务目录变更
