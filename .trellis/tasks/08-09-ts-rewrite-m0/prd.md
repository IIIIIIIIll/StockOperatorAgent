# M0 缺口原型：TDX RN 选型 + getQuote/xdxr/F10 验证

## Goal

钉死父任务（08-09-ts-rewrite）design.md 的 **D1-D4 四个决策点**，
产出可落盘的验证结论。原型通过 → 进入 M1 数据层移植；
任一决策点失败 → 回父任务 design 调整选型，不进入 M1。

## Requirements

- **R1（D1）RN 运行时 TCP 选型**：查明 node-tdx-market 内部传输实现
  （是否依赖 Node `net`/`http`）；评估 RN（Expo）环境可行性；
  不可行则给出替代方案（react-native-tcp-socket + 移植协议层 / 换 HTTP 源）。
- **R2（D2）getQuote 修复**：定位 0.2.1 `normalized.slice is not a function`
  报错点，fork/patch 修复；拉真实快照，字段与 Python 侧 snapshot 对齐。
- **R3（D3）xdxr 数据源**：读 pytdx `get_xdxr_info` 源码 → TS 移植 opcode
  （或评估 HTTP 除权源）；qfq 前复权结果与 Python `adjust.py` 对比。
- **R4（D4）F10 TS 移植**：TS fetch 客户端（filename/start/length 文本区间）+
  移植 `f10_parser.py` 分节解析；输出与 Python `build_reports` 逐字段对比。

## Acceptance Criteria

- [ ] **AC1** node-tdx-market 传输实现查明（源码级证据），RN 可行性结论落盘；
      不可行 → 替代方案评估（工作量/风险）落盘。
- [ ] **AC2** getQuote 修复后拉真实快照成功；快照字段与 Python 对比结果落盘
      （逐字段一致，或明确列出差异及影响）。
- [ ] **AC3** xdxr 数据源定案（opcode 移植或 HTTP 源）；同 ticker 同区间
      qfq 复权结果与 Python 对比通过（价格/成交量逐根一致或列出差值）。
- [ ] **AC4** F10 TS 解析与 Python `build_reports` 输出逐字段一致
      （metric/period/value_num、15 列输出、'%Y%m%d' 报告期）。
- [ ] **AC5** 四决策点结论全部落盘 `.trellis/tasks/08-09-ts-rewrite/research/`
      （新文件或更新 gap-analysis.md），父任务 design 决策点表回填结论。

## Constraints

- **C1** 原型代码放 `~/soa-ts-prototype/`（临时目录，验证后 M1 建正式工程），
      Python 仓库**零改动**。
- **C2** Python 侧只读：读源码、跑 oracle fixture 导出脚本。
- **C3** 真实网络：通达信行情服务器（本网络实测可达，2026-08-09）、
      F10 HTTP 端点。
- **C4** 不等完整流水线：本任务只做数据层四个缺口，不做编排/UI。

## Notes

- 参考：父任务 `research/gap-analysis.md`（实测证据与缺口清单）。
- 决策点定义见父任务 `design.md` D1-D4（默认值/触发条件）。
