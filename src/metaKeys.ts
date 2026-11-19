// 采集/演示元数据键 + demo ticker —— 全仓 meta 键名唯一定义面(跨子契约 2)。
// 裸字面量一律经本模块引用:demo:f10 / f10:${ticker} / capital:${ticker} /
// name:${ticker} / '600036' 的写读都在这里 const 化/模板化,换键名或换 demo 票只改一处。
// 说明:
// - LAST_RUN_KEY('soa:last-run')已在 src/lastRun.ts 单点,此处不重复导出,
//   避免双定义(消费方从 lastRun.ts import)。
// - DEMO_TICKER 与 app/data/demo.json 的 ticker 一致的约定(demo.json 属
//   app 侧资源,src 纯函数层不依赖它)。

/** 全局 demo F10 文本 meta 键(loadDemoData 写入;未起 server 时的占位视图)。 */
export const DEMO_F10_KEY = 'demo:f10';

/** 每股 F10 文本 meta 键模板(webCollect/deviceCollect 写,DataScreen/runner 读)。 */
export const f10Key = (ticker: string): string => `f10:${ticker}`;

/** 每股股本结构节文本 meta 键模板(webCollect 写,DataScreen 读)。 */
export const capitalKey = (ticker: string): string => `capital:${ticker}`;

/** 每股股本 JSON meta 键模板(hk/us Yahoo 链写,DataScreen 读;形如
 *  `{"zongguben":9004607601,"liutongguben":9004607601}`)——CN 的
 *  capitalKey 存 F10 文本,港美股无 F10 文本,两份键不混用。 */
export const yahooCapitalKey = (ticker: string): string => `yahoo-capital:${ticker}`;

/** 每股票公司画像 JSON meta 键模板(hk/us Yahoo 链写,DataScreen/pipeline 读;
 *  结构见 src/yahoo/composeYahooProfile.ts 的 YahooProfile)。 */
export const yahooProfileKey = (ticker: string): string => `yahoo-profile:${ticker}`;

/** 每股年度(FY)业绩 JSON meta 键模板(hk/us Yahoo 链写,pipeline/DataScreen 读;
 *  形如 `[{"report_date":"20251231","fields":{...}}]`)。
 *
 *  为什么放 meta 而不进 performance_reports:该表 PK 是 (ticker, report_date),
 *  而港股 Q4 季度行与 FY 年度行同为 12-31、美股 FY 末季同为 Q4 末日 → 同日两行
 *  在 PK 上相撞(旧实现季度行胜,FY 行静默丢失)。改用独立 meta 存年度行 = 零
 *  迁移、零 Party 风险,且季度序列不被年度行污染(并列反而更清楚)。 */
export const yahooAnnualKey = (ticker: string): string => `yahoo-annual:${ticker}`;

/** 每股证券名称 meta 键模板(deviceCollect/webCollect 缓存,quoteClient 读写)。 */
export const nameKey = (ticker: string): string => `name:${ticker}`;

/** 历史归档迁移标记 —— 首次启动把 `soa:last-run` 补成第一条历史(只迁一次;
 *  用户清空历史后不得复活)。历史正文/索引不入 meta(见 app/lib/runArchive.ts)。 */
export const RUN_HISTORY_MIGRATED_KEY = 'soa:runs-migrated';

/** 演示股票代码(与 app/data/demo.json 的 ticker 一致的约定)。 */
export const DEMO_TICKER = '600036';
