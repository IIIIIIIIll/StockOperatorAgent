# Web 版 TDX 采集修复:server 代理 + App 接线

## Goal

修复 web 版(Expo web / `npm run web`)无法采集真实行情的问题:浏览器无原始 TCP,
node-tdx-market 采集(`node:net`)只能在 Node 跑。在 `server.mjs`(Node 侧,已跑
/llm-proxy 同源代理)加 `/tdx-collect` 端点执行真 TDX 采集,浏览器 fetch 回
数据写入 InMemoryStore 后再跑委员会——任意 6 位 ticker 均可真实分析,
对齐 Node 探针(tools/probe.mts)的数据链语义。

## Background(根因,2026-08-10 实测)

- `App.tsx` 启动只 `loadDemoData()` 预载 600036 的 250 根日K + F10 到内存 store。
- `events.ts run()` 无采集步骤,只读 store(注释:"数据已由 Node 侧采集写入
  store——见 tools/probe.mts;App 端注入/预载")。
- `server.mjs` 仅 `/llm-proxy`,无 TDX 代理。
- 结果:web 输入 600036 → demo 数据能出报告;输入 002027 → store 空 →
  指标块空 → 真 LLM 拒绝("未提供行情数据")。
- 附带 bug:web 的 f10Text 取全局 `demo:f10`(600036 的),任何 ticker 的 F10
  段都串成 600036。

## Requirements

- **R1 服务端采集端点** `server.mjs`:`GET /tdx-collect?ticker=NNNNNN` →
  连接 TdxClient → 拉 F10 财务分析节 + collectAll(快照/全量日K/名称)→
  返回 JSON `{ticker, name, bars, snapshot, f10Text}`。失败 → 5xx JSON
  `{error}`;并发采集互斥;45s 总超时;ticker 校验 `^\d{6}$`。
- **R2 F10 市场码修正**:F10 客户端 market 参数按交易所推断
  (pytdx: 0=深 1=沪;`inferExchange` SZ=0/SH=1 恰好对齐)——探针硬编码 1
  (沪)只对 600036 类正确,深市 002027 需 0。
- **R3 共享接线层** `src/webCollect.ts`(纯 TS,零 RN 依赖,可单测):
  `collectViaProxy(ticker, base)` fetch 代理 + `applyCollectedToStore(store,
  payload)` 写 store(putStock/addDatas/per-ticker `f10:<ticker>` meta)。
- **R4 App 接线** `App.tsx start()`:web 平台先采集,失败 → 明确报错并中止
  (绝不以空数据喂 LLM);成功 → 以本次采集的 f10Text/snapshot/name 跑
  `runner.run`。F10 不再取全局 demo:f10。
- **R5 脚本** `ts/app/package.json`:`web`/`serve` 加
  `--experimental-strip-types`(server.mjs 静态 import ../../src/*.ts)。
- **R6 演示保留**:`loadDemoData()` 继续用于预览渲染(未起 server 时的占位
  视图),但任何 ticker 的分析都走真实采集。

## Acceptance Criteria

- [ ] **AC1** `npm run web` 起服后,`curl 'localhost:8090/tdx-collect?ticker=002027'`
      返回非空 bars(≥ 若干百根)、snapshot 非 null、f10Text 含"主要财务指标";
      600036 同样通过(F10 市场码 1)。
- [ ] **AC2** 浏览器 web 输入 002027(无 LLM 三键 → 演示 stub):采集数据 Tab
      显示 002027 真实日K 尾行 + 指标表,观点/报告非空;不再出现"未提供行情
      数据"拒绝。
- [ ] **AC3** 采集失败路径:代理不可达/5xx → UI 报错并中止,不跑空委员会。
- [ ] **AC4** `src/webCollect.ts` 单测绿(applyCollectedToStore 纯函数 +
      collectViaProxy mock fetch ok/err)。
- [ ] **AC5** 回归:`ts/` `tsc --noEmit` + `npm test` 全绿;`ts/app` 独立
      typecheck 干净。
- [ ] **AC6** F10 市场码:002027(SZ→0)与 600036(SH→1)的 F10 请求 market
      参数正确(单测或探针证据)。

## Constraints

- **C1** 浏览器侧不做任何 TCP;所有真实采集在 server.mjs(Node)完成。
- **C2** 数据链语义与 tools/probe.mts 对齐(原始 bars 入库,不做 qfq——
      与探针/现有 pipeline 一致;qfq 属独立等价性话题)。
- **C3** `src/` 保持纯 TS 零 RN 依赖(vitest 在 Node 跑);web 专属接线放
      `app/lib/`。
- **C4** 不改委员会/LLM/事件协议——只补采集通路。

## 验收结果(2026-08-10,含实施中扩展修复)

- [x] **AC1** `npm run web` 起服后 `/tdx-collect` 双票实测:002027 → 5202 根日K
      + 分众传媒 + snapshot + F10 24.7KB;600036 → 5836 根 + 招商银行 + F10
      24.3KB(bars/snapshot/f10Text 全非空)。
- [x] **AC2** 全链实测(真 TDX 数据 → 委员会 → 捕获 LLM):002027 上下文含
      技术指标/盈利能力/业绩摘要,8 观点产出;浏览器同路径(Node 全链 + UI
      层 typecheck)。
- [x] **AC3** 失败路径单测:代理不可达/5xx/400 → 抛带原因错误,UI 中止。
- [x] **AC4** `src/webCollect.ts` 8 单测 + reports 10 + turnover 7 +
      fmtDate 3 + query-content 6——全离线绿。
- [x] **AC5** `ts/` `tsc --noEmit` + `npm test` 117 绿/1 skip(live 门控);
      `ts/app` 独立 typecheck 干净。
- [x] **AC6** F10 深市市场码实测(002027 SZ→0 有真实财务内容)+ 单测钉死
      002027→0 / 300750→0 / 600036→1 / 688111→1。

### 实施中扩展修复(用户逐项反馈驱动)

1. **委员会 query 数据注入**(根因:TS 移植漏了 Python 各角色 f-string 嵌入)——
   专家嵌 stock_information、交易员嵌三份专家报告、经理嵌报告+双方修订版;
   `test/query-content.test.ts` 捕获式 LLM 钉死(修复前必挂)。
2. **业绩报告入库**——`src/reports.ts`(Python reports.py 移植):F10 tidy long
   → 每期 15 列、QoQ 相邻季度自算、双词表(通达信/港澳)+ 万元归一;web 采集
   与探针入库,UI 渲染真实业绩表。
3. **K线/日K 日期格式**——TDX 采集 `YYYYMMDD` vs 图表业务日 `YYYY-MM-DD`;
   `src/format.ts fmtDate` 归一(K 线空图根因)。
4. **换手率**——pytdx 命令 0x000b 实测服务器不支持 → F10 股本结构节解析
   (`parseCapitalStructure`);60 日行 + 技术指标块换手率真值(002027 最新日
   1.124%)。
5. **启动演示上下文 + 采集后立即显示 + 全量替换**——运行前上下文可见;
   委员会数分钟等待期上下文不空;`replaceDatas` 防 demo 数据混入真实全量。
6. **上下文去截断 + 报告 Markdown 渲染**——`MarkdownText`(react-native-
   markdown-display,主题色驱动)。

### 收尾状态

- `.trellis/spec/data_source/index.md` 落盘 TS 移植补充(双词表/股本来源/
  web 代理/日期双格式)。
- 全部修复经 vitest 117 绿 + 双工程 tsc + 真数据 E2E 验证;任务归档。
