// 真机采集接线 —— collectForWeb 的 Android 对应物:浏览器无原始 TCP,web 走
// server /tdx-collect 代理(Node 侧跑 node-tdx-market);真机 node-tdx-market
// 直接经 RN TCP(react-native-tcp-socket shim)连 TDX。契约同 web:输入
// CollectSkipOpts、输出 WebCollectResult、freshness 门同 collectForWeb
// (store 现状自动判定,显式布尔覆盖);失败抛错 → App 层 describeError 明确
// 报错并中止(不喂空数据)。store 由 App 启动时经 setDeviceStore 注入。
import { TdxClient } from 'node-tdx-market';
import type { StoreLike } from '../store.ts';
import type { CollectSkipOpts, CollectedPayload, WebCollectResult } from '../webCollect.ts';
import { applyCollectedToStore } from '../webCollect.ts';
import { asiaToday, freshnessGates } from '../gates.ts';
import { info, warn } from '../log.ts';
import { collectAll } from './quoteClient.ts';
import { f10MarketFor, getCompanyInfoCategory, getCompanyInfoContent, type F10Category } from './f10Client.ts';

// ─── store 注入 ──────────────────────────────────────────────────────────────
// collectForDevice 签名固定(ticker+opts,对齐 collectForWeb 输入形),store 由
// App 启动时注入(runner.ts 的 FileStore 实例)。未注入即调用 → 明确抛错,不静默
// (接线遗漏可定位)。
let deviceStore: StoreLike | null = null;

export function setDeviceStore(store: StoreLike): void {
  deviceStore = store;
}

// 实测可达节点(2026-08-15 WSL2 网络 5/5 连通;真机移动网络同网段预期可达)。
// 顺序尝试 + TDX_HOST env 覆盖(服务器漂移兜底)。
export const DEVICE_TDX_HOSTS: string[] = [
  process.env.TDX_HOST ?? '150.158.160.2',
  '124.71.187.122',
  '101.35.121.35',
  '122.51.120.217',
  '111.229.247.189',
];

/** F10 节文本拉取(组装序对齐 proxies.cjs fetchF10Section);节缺失 → '' 。 */
async function fetchF10Section(
  client: TdxClient,
  ticker: string,
  cats: F10Category[],
  namePart: string,
): Promise<string> {
  const section = cats.find((c) => c.name.includes(namePart));
  if (!section) return '';
  return getCompanyInfoContent(client, f10MarketFor(ticker), ticker, section.filename, section.start, section.length);
}

/** 真机采集:单连接内拉 F10(财务分析 + 股本结构)+ collectAll(日K qfq/快照/
 *  名称/xdxr)→ applyCollectedToStore 写 FileStore → WebCollectResult。
 *  freshness 门对齐 collectForWeb:opts 缺省按 store 现状判定(skipDaily 同日、
 *  skipF10 同季),显式布尔覆盖;同季跳过 F10 → 缓存 f10:ticker meta 顶替。
 *  失败抛错(可读中文,对齐 web「不喂空数据」语义);结束 disconnect()。 */
export async function collectForDevice(
  ticker: string,
  opts?: CollectSkipOpts,
): Promise<WebCollectResult> {
  if (!deviceStore) {
    throw new Error('真机采集未就绪:store 未注入(需先调 setDeviceStore)');
  }
  const store = deviceStore;
  const today = asiaToday();
  const stock = store.getStock(ticker);
  const reports = store.getPerformanceReports(ticker);
  const latestReportDate = reports.reduce((m, r) => (r.report_date > m ? r.report_date : m), '') || null;
  const gates = freshnessGates(stock?.lastDataUpdate ?? null, latestReportDate, today);
  const skipDaily = opts?.skipDaily ?? gates.dailyFresh;
  const skipF10 = opts?.skipF10 ?? gates.f10Fresh;
  const skipped: string[] = [];
  if (skipDaily) skipped.push('日K(同日已采集)');
  if (skipF10) skipped.push('F10财务分析(同季已入库)');
  if (skipped.length) info(`跳过采集:${skipped.join('、')},沿用既有数据`);

  // host 顺序尝试(设计决策:真机冷启动不做 getFastestHost 并发测速——省
  // 连接与延迟;列表为实测可达节点,TDX_HOST env 可覆盖)。每 host 一次完整
  // 采集,失败切下一个;全部失败抛错(调用方中止,不喂空数据)。
  const hosts = DEVICE_TDX_HOSTS;
  let lastErr: unknown = null;
  for (const host of hosts) {
    const client = new TdxClient({ host, connectTimeout: 8000, requestTimeout: 12000 });
    client.on('error', () => {}); // 必挂监听(EventEmitter 无 error 监听者即抛)
    try {
      // 组装序对齐 proxies.cjs doCollect:connect → category → 财务分析节(可跳过)
      // → 股本结构节(恒拉,capital 不缺失)→ collectAll(skipDaily 跳过日K+xdxr)
      await client.connect();
      const cats = await getCompanyInfoCategory(client, f10MarketFor(ticker), ticker);
      const f10Text = skipF10 ? '' : await fetchF10Section(client, ticker, cats, '财务分析');
      const capitalText = await fetchF10Section(client, ticker, cats, '股本结构');
      const collected = await collectAll(
        client,
        ticker,
        { get: (k) => store.getMeta(k), set: (k, v) => store.setMeta(k, v) },
        { skipDaily: skipDaily === true },
      );
      const payload: CollectedPayload = {
        ticker,
        name: collected.name,
        bars: collected.bars,
        snapshot: collected.snapshot,
        f10Text,
        capitalText,
        skipDaily: skipDaily === true,
      };
      // 同季跳过 F10:未拉文本 → 缓存文本顶替(applyCollectedToStore 幂等重写)
      if (skipF10 && !payload.f10Text) {
        payload.f10Text = store.getMeta(`f10:${ticker}`) ?? '';
      }
      return applyCollectedToStore(store, payload);
    } catch (err) {
      lastErr = err;
      warn(`TDX host ${host} 采集失败:${String((err as Error)?.message ?? err)}——尝试下一个`);
    } finally {
      client.disconnect();
    }
  }
  // 可读中文,对齐 proxies.cjs 代理错误文案;调用方中止分析,不喂空数据
  throw new Error(`TDX 采集失败:${String((lastErr as Error)?.message ?? lastErr)}`);
}
