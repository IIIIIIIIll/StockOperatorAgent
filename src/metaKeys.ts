// 采集/演示元数据键 + demo ticker —— 全仓 meta 键名唯一定义面(跨子契约 2)。
// 裸字面量一律经本模块引用:demo:f10 / f10:${ticker} / capital:${ticker} /
// '600036' 的写读都在这里 const 化/模板化,换键名或换 demo 票只改一处。
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

/** 演示股票代码(与 app/data/demo.json 的 ticker 一致的约定)。 */
export const DEMO_TICKER = '600036';
