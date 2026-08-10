# M1 数据层移植：TS 工程 + SQLite + 指标 + F10 双格式

## Goal

把数据层完整移植到正式 TS 工程（`~/soa-ts-prototype`），与 Python 版
**逐字段等价**（Python 版为 oracle）。M0 已验证的四个缺口（RN TCP 选型 /
getQuote / xdxr+qfq / F10 解析）全部接入正式代码。

## Requirements

- **R1 工程正式化**：`~/soa-ts-prototype` 升级为正式工程（package.json
  type=module、tsconfig、vitest、src/ 分层）。
- **R2 TDX 客户端封装**：`src/tdx/`——TdxClient 封装（getKline/getQuote/
  getStockList）+ xdxr（Gbbq opcode，m0-d3）+ F10（CompanyCategory/
  Content，m0-d4）。原型 `.mjs` 转正式 `.ts`。
- **R3 qfq 复权**：`src/adjust.ts`——m0-d3 已验证算法接入（TS 版，
  750 根与 Python IDENTICAL）。
- **R4 SQLite 仓储**：`src/store.ts`——表：stocks / daily_bars /
  performance_reports / overview / meta（freshness 戳）；get/put/
  add_datas 批量单事务（对齐 Python add_datas 语义：0=全部重复不写）；
  按 date/report_date 去重。
- **R5 freshness 门 + 单遍拉取**：`src/gates.ts`——overview 交易日
  17:00 门、业绩季度末门（'%Y%m%d' 比较）、FetchScope 单遍（cached_bars
  ≥ 请求尺寸判定）；交易日判定 `get_last_business_day` 语义（工作日，
  节假日日历已知缺陷同步保留）。
- **R6 指标计算**：`src/indicators.ts`——移植 vendored `compute_all`
  （MA/EMA/MACD/RSI/KDJ/BOLL/ATR/量比）+ `extra_indicators.py`
  （MACD-VH/刘晨明乖离率）。纯函数，输入日K输出指标。
- **R7 F10 双格式兼容**：`src/f10.ts`——解析器支持两种格式：
  通达信（`│` U+2502、`【1.主要财务指标】` 带编号）与港澳资讯
  （`｜` U+FF5C、无编号 `【主要财务指标】`）；分节名模糊含匹配。

## Acceptance Criteria

- [ ] **AC1** vitest 套件全绿（npm test）。
- [ ] **AC2 复权等价**：600036 全量日K fixture（原始 + Python qfq 输出
      固化 test/fixtures/）→ TS qfq 输出与 fixture 逐行一致。
- [ ] **AC3 指标等价**：同 fixture 日K → TS 指标 vs Python vendor
      compute_all 输出对比（容差：价格类 1e-6、指标类 1e-4 或列明）。
- [ ] **AC4 仓储语义**：put/get 往返、add_datas 去重/批量单事务、
      报告按 report_date 去重——测试钉死（对齐 Python add_data 契约）。
- [ ] **AC5 freshness/FetchScope**：overview 门（同日幂等/跨交易日
      刷新）、业绩门（季度末截止判定）、FetchScope 请求尺寸复用判定——
      离线测试（注入假 fetcher）。
- [ ] **AC6 F10 双格式**：两种格式 fixture 各解析正确；与 Python
      f10_parser 输出（港澳资讯格式）逐字段一致；通达信格式解析成功
      （无 0 行）。
- [ ] **AC7 M0 接入**：getQuote/xdxr/F10 客户端接入 src/tdx/，Node
      探针可跑通（真实服务器）。

## Constraints

- **C1** Python 仓库零改动；fixture 由 Python 侧一次性导出脚本生成
      （tools/export_fixtures.py 放 TS 工程内，只读 Python 仓库）。
- **C2** 存储用 better-sqlite3（Node 22 环境，RN 阶段换 expo-sqlite
      时仓储接口保持同构——SQL 层隔离）。
- **C3** 指标输入契约 = qfq 后 12 列语义（日期/OHLCV/成交额），
      与 Python `to_akshare_hist_schema` 输出对齐。
- **C4** 本任务只做数据层，不做编排/UI。

## Notes

- 参考：父任务 `research/m0-d1~d4-*.md`（决策点结论与原型代码）、
  `design.md` 数据契约节。
- 原型代码：`~/soa-ts-prototype/*.mjs`（quote/xdxr/qfq/f10_client/f10_parser）。

## 验收结果（2026-08-09）

> 正式工程位置调整：落在仓库内 `ts/`（package.json name=soa-ts-prototype），
> 非 `~/soa-ts-prototype`（该目录保留 .mjs 原型）；等价性契约不变。

- [x] **AC1** `npm test` 全绿（14 文件 80 测试，vitest）。
- [x] **AC2** `test/qfq.test.ts`：600036 全量日K fixture（`600036_daily.json`：
      raw + Python qfq adjusted + xdxr）→ TS qfq 输出与 Python `adjust.py`
      输出一致（5835 根）。
- [x] **AC3** `test/indicators.test.ts`：同 fixture 日K → TS 指标 vs Python
      vendor compute_all 输出（`600036_indicators.json` fixture）。
- [x] **AC4** `test/store-gates.test.ts`：put/get 往返、add_datas 去重/批量
      单事务、报告按 report_date 去重——对齐 Python add_data 契约。
- [x] **AC5** `test/store-gates.test.ts`：overview 门/业绩门（'%Y%m%d' 比较）/
      FetchScope 请求尺寸复用——注入假 fetcher 离线钉死。
- [x] **AC6** `test/f10.test.ts`：双 fixture 各解析正确——`f10_hk.txt`
      （港澳资讯 `｜` U+FF5C 无编号）/ `f10_tdx.txt`（通达信 `│` U+2502
      带编号）；与 Python f10_parser 逐字段一致（港澳格式）。
- [x] **AC7** M0 客户端接入 `src/tdx/{quoteClient,f10Client,xdxr}.ts`；Node
      探针真服务器全链跑通（probe-output/soa.sqlite）。
