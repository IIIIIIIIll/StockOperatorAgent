# M0 执行计划：四缺口原型

顺序执行，每步结论即时回填 `research/`。全部在 `~/soa-ts-prototype/` 内
（Node/TS 环境；node 22 已具备）。

## 步骤 1 — D1：RN TCP 传输选型（最大风险，先做）

1. 读 node-tdx-market 源码（`node_modules/node-tdx-market/dist/client.js` +
   `commands/`）：确认 socket 传输用 Node `net` 还是自有实现/第三方。
2. 查 react-native-tcp-socket 是否兼容其用法（事件 API、连接/心跳/断线重连）。
3. 结论落盘：`research/m0-d1-rn-tcp.md` —— 可行路径（polyfill 名 + 改动点）
   或替代方案评估（移植协议层工作量估算）。
4. **验收**：结论文件含源码级证据（关键代码摘录）。

## 步骤 2 — D2：getQuote 修复

1. 复现 0.2.1 报错：拉 600036 快照 → 定位 `normalized.slice` 报错栈。
2. fork 到 `~/soa-ts-prototype/node-tdx-market/`（本地 patch，MIT）修复。
3. 修复后拉真实快照：字段（最新价/涨跌幅/量比/五档等）与 Python
   `overview.py` snapshot 输入对比。
4. 结论落盘：`research/m0-d2-quote.md`。
5. **验收**：探针脚本输出快照字段表 + 对比结果。

## 步骤 3 — D3：xdxr 数据源 + qfq 对比

1. 读 pytdx 源码 `get_xdxr_info`（site-packages 或 GitHub）：命令号/响应解析。
2. TS 实现 opcode（挂在 node-tdx-market patch 里或独立客户端）。
3. 拉 600036/002027 的 xdxr 事件，与 Python pytdx 拉取对比（字段/单位：
   fenhong/songzhuangu/peigu 每10股、peigujia 元/股）。
4. 移植 `adjust.py` qfq 算法 → 同 ticker 同区间复权结果与 Python 对比。
5. 结论落盘：`research/m0-d3-xdxr-qfq.md`。
6. **验收**：xdxr 事件对比一致；复权后价格/成交量逐根对比（或列出差值及原因）。

## 步骤 4 — D4：F10 TS 移植

1. 从 vendor `company_info_job.py` + `tdx_source.fetch_company_finance_raw`
   还原 F10 HTTP 端点（filename/start/length 文本区间）→ TS fetch 客户端。
2. 移植 `f10_parser.py` 分节解析（`parse_finance_indicators_all_tables` /
   `parse_indicator_section`：日期头子表并入、(metric,period) 去重、亿万归一）。
3. 拉 600036 F10 财务分析节 → 与 Python `build_reports` 输出对比
   （15 列、metric/period/value_num、QoQ 自算语义可留 M1，本步只对比原始解析）。
4. 结论落盘：`research/m0-d4-f10.md`。
5. **验收**：同一 ticker 解析结果逐字段一致（或列出差异及原因）。

## 收尾

- 更新父任务 `research/gap-analysis.md`：D1-D4 结论回填；`design.md` 决策点表
  标注已定案/待调整。
- 汇报 AC1-AC5 打勾情况；父任务 review 后进入 M1。
