# ts-tests 审查报告

范围：TS 测试 22 文件 + 工具脚本 2 文件（24 文件全覆盖）。纯只读审查，未运行任何测试/linter（按约束禁止运行）。
对照 spec：`.trellis/spec/ts/index.md`（事件流协议 / ProgressUpdater / streamWithRetry / 同源代理 / 图表约定）、`.trellis/spec/guides/index.md`（防假阳性验证规则）。

## 审阅覆盖

|文件|行数|结论|
|---|---|---|
|ts/test/agents.test.ts|155|有发现（无缺陷；间接覆盖 progress 降级）|
|ts/test/committee.test.ts|167|无发现|
|ts/test/events.test.ts|182|无发现|
|ts/test/f10.test.ts|39|无发现|
|ts/test/format.test.ts|20|无发现|
|ts/test/indicators.test.ts|38|无发现|
|ts/test/live.integration.test.ts|77|有发现（INFO：require vs import 风格）|
|ts/test/llm.test.ts|48|有发现（WARNING：测试名与断言矛盾）|
|ts/test/log-server.test.ts|131|无发现|
|ts/test/log.test.ts|384|无发现|
|ts/test/overview.test.ts|124|有发现（INFO：注释"周六"错误）|
|ts/test/pipeline.test.ts|147|无发现|
|ts/test/prompt.test.ts|16|无发现|
|ts/test/qfq.test.ts|46|无发现（成交量后 250 根偏差有注释）|
|ts/test/query-content.test.ts|142|无发现|
|ts/test/reports.test.ts|140|无发现|
|ts/test/retry.test.ts|244|无发现|
|ts/test/store-gates.test.ts|119|无发现|
|ts/test/tool-loop.test.ts|220|无发现|
|ts/test/turnover.test.ts|71|无发现|
|ts/test/web-search.test.ts|154|无发现|
|ts/test/webCollect.test.ts|126|无发现|
|ts/tools/probe.mts|119|有发现（INFO：文件中部 import）|
|ts/tools/export_fixtures.py|117|有发现（WARNING ×2：非确定性导出 / 魔数文件+docstring 不实）|

## 发现

### [WARNING] createLlm 测试名与断言矛盾——"rejects"却断言 not.toThrow
- **位置**: ts/test/llm.test.ts:45-46
- **问题**: 测试名 `createLlm rejects without config`（"createLlm 无配置时拒绝"）与断言 `expect(() => createLlm({ apiKey: '', model: 'm', baseUrl: 'https://x' })).not.toThrow()` 完全相反。已核实 `src/llm.ts` 的 `createLlm` 是薄构造器（不做校验，校验全在 `readLlmEnv`，且 readLlmEnv 已有完整用例矩阵）。该断言钉的是"构造不抛"这一行为，名字却宣称"拒绝"。若未来有人给 createLlm 加校验，此测试会失败，而测试名会让维护者以为"拒绝"是新期望行为——回归信号被名字掩盖/误导。名字大概率是从 readLlmEnv 用例复制时的笔误。
- **证据**: `it('createLlm rejects without config', () => { expect(() => createLlm({ apiKey: '', model: 'm', baseUrl: 'https://x' })).not.toThrow(); });`
- **建议**: 改名对齐断言，如 `createLlm 不做校验（构造即成功；校验在 readLlmEnv）`；或若本意是要校验，则改为 `expect(() => createLlm({...})).toThrow()` 并在 createLlm 中实现。
- **spec 对照**: 偏离测试自述契约；spec 无直接条款，属测试有效性（断言强度）问题。

### [WARNING] export_fixtures.py f10_hk.txt 导出非确定性——hk_files[0] 依赖 glob 目录顺序
- **位置**: ts/tools/export_fixtures.py:110-111
- **问题**: `hk_files = glob.glob(f"{REPO}/data/tdx_cache/company_info_raw/**/data.parquet", recursive=True)` 在 10+ 个 ts_code 目录（000001.SZ…601088.SH）上展开，`hk_files[0]` 取"第一个"——Python `glob.glob` 顺序由目录迭代决定，不保证排序、不保证稳定。当前缓存里恰好选到 300750.SZ（fixture 头 `◇300750 宁德时代◇`）。但 TS 测试**硬钉**该文件内容：`reports.test.ts:118-119` 断言 `latest.report_date === '20260630'`、`eps ≈ 9.51`、`net_profit_YoY_rate ≈ 41.9839`，`f10.test.ts:13` 断言 `rows.length === 180`。重新导出时若目录顺序变化，会静默生成另一家公司/另一期数据 → TS 测试无谓失败，或更糟：把错误公司固化成新 fixture。
- **证据**: `hk_files = glob.glob(f"{REPO}/data/tdx_cache/company_info_raw/**/data.parquet", recursive=True)` / `hk = pd.read_parquet(hk_files[0]).iloc[0]["text"]`
- **建议**: 显式指定目标 ts_code（如 `company_info_raw/ts_code=300750.SZ/data.parquet`）或对文件名排序后筛选 300750，并在脚本内断言选中的 ticker 与预期一致。
- **spec 对照**: 违反工具自述"产出固定 fixture 供等价性测试"的可复现前提（guides 验证规则：可复现性属工具契约）。

### [WARNING] export_fixtures.py 依赖 /tmp/f10_text.txt 魔数文件；docstring"零网络重跑"不实
- **位置**: ts/tools/export_fixtures.py:2, 108
- **问题**: ① `tdx = open("/tmp/f10_text.txt").read()` 是手工产出的魔数路径——干净机器/新 clone 上直接 `FileNotFoundError`，fixture 无法重建；② docstring 宣称"零网络重跑"，但已核实 `get_tdx_source().fetch_daily` → `tdx_client.py:115 download_daily` 每次都 `create_hq_api() + connected_session()` 真实连接 TDX 拉全量（无缓存优先读路径），`fetch_xdxr` 同理；③ docstring 用法路径 `cd ~/soa-ts-prototype` 与本仓库不符（实际为 `ts/tools/export_fixtures.py`，须 cd 到 `ts/` 使相对 `FIX="test/fixtures"` 生效，`~/soa-ts-prototype` 目录不存在）。三条都破坏该工具"固定 oracle 可复现导出"的契约。
- **证据**: 第 2 行 docstring `零网络重跑`；第 108 行 `tdx = open("/tmp/f10_text.txt").read()`；`data_source/chinese_mainland/tdx/tdx_source.py:81-83` `fetch_daily → self.downloader.download_daily`；`.../vendor/scripts/data_pipeline/tdx_client.py:115-137` `download_daily` 恒建 API 会话联网。
- **建议**: 用 `fetch_company_finance_raw(ticker)`（已核实为只读缓存路径）生成 f10_tdx.txt，删掉 /tmp 魔数文件；docstring 改为真实用法（`cd ts && python3 tools/export_fixtures.py`）并如实说明"联网拉取 + 写入缓存"。
- **spec 对照**: 偏离工具自述契约（可复现/零网络）；非产品代码，定 WARNING 不升 CRITICAL。

### [INFO] live.integration.test.ts 用 require('node:fs')，其余测试文件均用 import
- **位置**: ts/test/live.integration.test.ts:66
- **问题**: `require('node:fs')` 与该文件自身的 ESM import 风格及全部其他测试文件（`import fs from 'node:fs'`）不一致。已核实 vitest 4.1.10 module-evaluator 对每个模块注入 `cjsGlobals.require`（`createRequire(import.meta.url)`），ESM 测试内 `require` 可用，**非运行 bug**；仅风格/一致性。
- **证据**: `const fixture = JSON.parse(require('node:fs').readFileSync(...))` vs `import { ... } from 'node:fs'`（同文件其余与 log-server.test.ts 等）。
- **建议**: 改为 `import { readFileSync } from 'node:fs'` 统一风格。
- **spec 对照**: N/A（风格）。

### [INFO] overview.test.ts 注释"周六"错误——2026-08-09 实为周日
- **位置**: ts/test/overview.test.ts:39
- **问题**: 注释 `today: '2026-08-09', // 周六,末根 08-07`。2026-08-07 是周五（store-gates.test.ts:66 自证 Sat→Fri 语义），则 08-08 周六、**08-09 周日**。断言本身正确（today 非末根 bar 日期 → volume/amount NaN，与星期几无关），仅注释错误；events.test.ts 用同一天期做 today 但未声称星期。
- **证据**: `today: '2026-08-09', // 周六,末根 08-07`（对照 ts/test/store-gates.test.ts:67 `2026-08-08` = Saturday）。
- **建议**: 注释改"周日"。
- **spec 对照**: N/A（注释）。

### [INFO] probe.mts 文件中部 import + stubLlm 后置定义
- **位置**: ts/tools/probe.mts:100
- **问题**: `import { AIMessage } from '@langchain/core/messages'` 出现在 main() 之后、stubLlm() 之前（文件中部），且 `main()` 在 stubLlm 声明之前就引用它。ESM import 提升与函数声明提升使其合法运行，但违反"import 集中在文件头"的惯例——扫描依赖时容易漏看；建议将 import 移到顶部、stubLlm 定义移到 main 之前。
- **证据**: 文件第 100 行中部 import；`main()` 第 88 行 `llm = stubLlm()`。
- **建议**: import 上移文件头。
- **spec 对照**: N/A（风格）。

### [INFO] 覆盖缺口：chart 零测试钉死；progress.ts safePush* 仅间接覆盖；qfq volume 前 5585 根未断言
- **位置**: 全仓（ts/test 无对应文件）
- **问题**: ① 08-13 提交 99bb1af 的 IndicatorChart.tsx（动态 import lightweight-charts、pane stretch 布局、NaN 过滤、setHeight 坑）无任何测试——devDeps 无 @testing-library/react/jsdom，仓库无组件测试基础设施，图表布局类回归（如 setHeight 重排）无法被测试捕获；② progress.ts 的 safePushDelta/safePushStatus/safeProgress/pushReport 无直接单测文件，仅经 agents.test.ts 'spy updater 抛错 → 降级 no-op'（agents.test.ts:143-155）间接覆盖；③ qfq.test.ts 对 5835 根中前 5585 根的 volume 未断言（仅价格全量逐位一致 + 后 250 根 volume），有注释说明 Python astype(int64) 溢出语义，属文档化的刻意取舍。①②为真实覆盖缺口，③为已文档化的刻意缩减。
- **证据**: ts/package.json devDependencies 无测试库；agents.test.ts:143-155（throwing updater 用例）；qfq.test.ts:22-35 注释。
- **建议**: 如需钉 chart 协议，引入 minimal 组件测试或至少对 `chartOptions`/数据过滤纯函数抽离单测；progress.ts 四个守卫函数可加 10 行级直接单测（与 retry.test.ts 同级成本）。
- **spec 对照**: ts/index.md 图表约定与 ProgressUpdater 可选方法扩展——协议已实现但无直接测试钉死，属覆盖率偏离。

## spec 符合性结论

- **事件流协议（ts/src/events.ts）**：events.test.ts 钉死事件序 progress→reports→done、unsubscribe 停止投递、错误路径 error 事件 + throw、retry 注入后 roleStatus 序列 running→retry→done 且 token 全量重来（无残留 partial）、revise 节点 node→roleKey 映射（bullish_revise→bullish_opinions）——与 ts/index.md 逐条对齐，符合。
- **ProgressUpdater 可选方法扩展**：agents.test.ts 用带 pushDelta/pushStatus 的 updater 断言完整事件序、用全抛错 updater 断言降级不中断图——向后兼容与 safePush* 守卫语义被间接钉住，符合（直接单测缺失见 INFO）。
- **streamWithRetry / invokeWithRetry（08-11-ts-streaming-output）**：retry.test.ts 覆盖 429/5xx 重试、400 直抛零 warn、退避 warn 格式（含 HTTP 状态码后缀与 2 倍间隔 0.001→0.002s）、耗尽 reraise、流中途断重试丢弃失败 partial、tool_call_chunks 聚合出 tool_calls 且 onDelta 跳过、content 数组 join——符合 spec 语义对齐要求。
- **工具轮复位通道（onReset + pushStatus('retry') 单通道）**：tool-loop.test.ts 钉死每轮 tool_calls 触发 onReset、warn 含轮次与全部工具名、末轮文本完整流入 onDelta——符合。
- **同源代理（proxies.cjs）**：web-search.test.ts 钉死 /web-search 代理 searcher URL/归一化/错误抛出；webCollect.test.ts 钉死 /tdx-collect 载荷/5xx/400/不可达错误契约（'不可达' 文案与 src/webCollect.ts 一致）——符合。SSE 透传无直接测试（需真 server，属集成面）。
- **图表约定（web-only）**：无测试（无基础设施），实现符合 spec 但未钉死——见 INFO。
- **live.integration.test.ts 网络标记**：`describe.skipIf(!LIVE)`（SOA_LIVE==='1' 才跑）+ 模块级无连接副作用（TdxClient 构造/on 不联网），`npm test`（vitest run）默认跳过——不会误跑网络，符合约束。

## 统计
CRITICAL: 0 / WARNING: 3 / INFO: 4
