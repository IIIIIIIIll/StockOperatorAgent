// renderer 桌面桥 —— Electron 壳的 window.__soaDesktop 接线面(design 决策 4)
// 职责:isDesktopBridge 探针 + getBridge + DesktopStore(StoreLike 同步镜像 +
// 写穿串行队列)+ settingsStore 桥接(bridgeStorage)。
// 镜像语义与 src/store-file.ts FileStore 完全一致(addDatas 增量去重、
// replaceDatas 空输入早退、业绩 report_date 去重、getDatas/getPerformanceReports
// 返回副本、updateOverview 仅对既有 stock 生效);mutator 本地应用后按调用序
// 入队列逐条 invoke desktop:store-op(前一个完成后才发下一个),失败仅
// console.error 不抛、不阻断后续(对齐 FileStore 写穿队列语义)。
// 平台安全:不做任何 declare global(architecture 测试禁 DOM 名 global 增强;
// 根 tsconfig 亦无 DOM lib)——经 globalThis 局部类型断言读 window.__soaDesktop。
// 浏览器中 globalThis === window,读 globalThis.window 与 typeof window 守卫
// 等价;Node/RN/vitest 无 window 成员 → 探针 false,web/Android 路径零行为变化。
import type { DailyBar, PerformanceReport, StockRecord, StoreLike } from '../../src/store.ts';
import type { SettingsStorageLike } from './settingsStore.ts';

/** 桌面壳全量快照(child 侧经 FileStore getter 序列化;JSON 安全,均纯对象)。 */
export interface StoreSnapshot {
  stocks: Record<string, StockRecord>;
  datas: Record<string, DailyBar[]>;
  reports: Record<string, PerformanceReport[]>;
  meta: Record<string, string>;
}

/** 桌面壳 renderer 桥面(preload contextBridge 暴露 window.__soaDesktop)。
 *  Electron IPC:store-init/store-op 走 invoke(异步);settings-load 走
 *  sendSync(仅冷路径:模块挂载/分析启动,实证可靠),settings-save 走
 *  invoke(异步)——sendSync 在 React 事件处理路径内会间歇性死锁
 *  (原生 pthread_cond_wait 同步 Mojo 等待;08-16-desktop-app 实证
 *  点击开关 3/5 挂起、直接调用 2/2 通过;Electron 文档亦禁用事件路径
 *  sendSync)。 */
export interface SoaDesktopBridge {
  readonly isDesktop: true;
  storeInit(): Promise<StoreSnapshot>;
  storeOp(op: string, args: unknown[]): Promise<void>;
  settingsLoad(): string | null;
  settingsSaveAsync(json: string): Promise<void>;
}

/** renderer 全局上桥面形状(局部类型断言,非 global 增强)。 */
interface DesktopGlobal {
  window?: { __soaDesktop?: SoaDesktopBridge };
}

function readBridge(): SoaDesktopBridge | null {
  const w = (globalThis as unknown as DesktopGlobal).window;
  if (typeof w === 'undefined') return null;
  const bridge = w.__soaDesktop;
  return bridge && bridge.isDesktop === true ? bridge : null;
}

/** 桌面壳探针:仅 window.__soaDesktop.isDesktop === true 时为真。 */
export function isDesktopBridge(): boolean {
  return readBridge() !== null;
}

/** 当前桌面桥实例;无桥 → null。 */
export function getBridge(): SoaDesktopBridge | null {
  return readBridge();
}

/** 桌面后端:本地同步镜像 + 写穿串行队列(保持 StoreLike 同步契约,消费方零改动)。
 *  读方法纯本地镜像同步返回;mutator 先本地应用(语义与 FileStore 逐项一致)
 *  再按调用序入队列 storeOp,失败仅记录不抛出。 */
export class DesktopStore implements StoreLike {
  private stocks = new Map<string, StockRecord>();
  private datas = new Map<string, DailyBar[]>();
  private reports = new Map<string, PerformanceReport[]>();
  private meta = new Map<string, string>();
  private queue: Promise<void> = Promise.resolve();
  private readyPromise: Promise<void> | null = null;

  constructor(private readonly bridge: SoaDesktopBridge) {}

  /** 拉全量快照 hydrate 镜像(内存已有键优先——先写后 ready 的变更不丢,同 FileStore)。 */
  ready(): Promise<void> {
    this.readyPromise ??= this.hydrate();
    return this.readyPromise;
  }

  private async hydrate(): Promise<void> {
    const snapshot = await this.bridge.storeInit();
    for (const [ticker, srec] of Object.entries(snapshot.stocks)) {
      if (srec && !this.stocks.has(ticker)) this.stocks.set(ticker, { ...srec });
    }
    for (const [ticker, bars] of Object.entries(snapshot.datas)) {
      if (bars.length && !this.datas.has(ticker)) {
        this.datas.set(ticker, [...bars].sort((a, b) => a.date.localeCompare(b.date)));
      }
    }
    for (const [ticker, reports] of Object.entries(snapshot.reports)) {
      if (reports.length && !this.reports.has(ticker)) {
        this.reports.set(ticker, [...reports].sort((a, b) => a.report_date.localeCompare(b.report_date)));
      }
    }
    for (const [k, v] of Object.entries(snapshot.meta)) {
      if (!this.meta.has(k)) this.meta.set(k, v);
    }
  }

  /** 串行写穿队列:前一个 storeOp 完成才发下一个(顺序 = 调用序,对齐 FileStore
   *  队列语义);失败仅 console.error 不抛、不阻断后续(op 已本地生效)。 */
  private enqueueOp(op: string, args: unknown[]): void {
    this.queue = this.queue
      .then(() => this.ready())
      .then(() => this.bridge.storeOp(op, args))
      .catch((err: unknown) => {
        console.error(`DesktopStore ${op} 写穿失败:${err instanceof Error ? err.message : String(err)}`);
      });
  }

  close(): void {
    // 镜像与队列随实例回收;桥生命周期由壳管理,无需释放(空实现契约)。
  }

  getStock(ticker: string): StockRecord | null {
    return this.stocks.get(ticker) ?? null;
  }

  /** 整记录替换(与 FileStore putStock 一致:存副本、覆盖旧值)。 */
  putStock(record: StockRecord): void {
    this.stocks.set(record.ticker, { ...record });
    this.enqueueOp('putStock', [record]);
  }

  /** 批量追加日K:拒绝 date <= 既有末根日期;升序契约 + 同日期去重(keep last)。
   *  返回实际追加数;0 = 全部重复不写不排队。 */
  addDatas(ticker: string, bars: DailyBar[]): number {
    if (!bars.length) return 0;
    const fresh = this.mergeDatas(ticker, bars);
    if (!fresh) return 0;
    this.enqueueOp('addDatas', [ticker, bars]);
    return fresh;
  }

  /** 全量替换该 ticker 日K(空输入早退不清库)——web 采集语义,同 FileStore。 */
  replaceDatas(ticker: string, bars: DailyBar[]): number {
    if (!bars.length) return 0;
    this.datas.delete(ticker);
    const fresh = this.mergeDatas(ticker, bars);
    if (!fresh) return 0;
    this.enqueueOp('replaceDatas', [ticker, bars]);
    return fresh;
  }

  /** 镜像合并核心(与 FileStore.mergeBars 逐行一致):过滤 date > 末根、排序、
   *  同日期 keep last、同步 stock.lastDataUpdate。 */
  private mergeDatas(ticker: string, bars: DailyBar[]): number {
    const existing = this.datas.get(ticker) ?? [];
    const last = existing.length ? existing[existing.length - 1].date : null;
    const fresh = bars.filter((b) => last === null || b.date > last);
    if (!fresh.length) return 0;
    const merged = [...existing, ...fresh].sort((a, b) => a.date.localeCompare(b.date));
    const seen = new Map<string, DailyBar>();
    for (const b of merged) seen.set(b.date, b);
    this.datas.set(ticker, [...seen.values()].sort((a, b) => a.date.localeCompare(b.date)));
    const stock = this.stocks.get(ticker);
    if (stock) {
      this.stocks.set(ticker, { ...stock, lastDataUpdate: fresh[fresh.length - 1].date });
    }
    return fresh.length;
  }

  /** 批量追加业绩报告:按 report_date 去重;返回实际追加数;0 = 全重复不排队。 */
  addPerformanceReports(ticker: string, reports: PerformanceReport[]): number {
    if (!reports.length) return 0;
    const existing = this.reports.get(ticker) ?? [];
    const known = new Set(existing.map((r) => r.report_date));
    const fresh = reports.filter((r) => !known.has(r.report_date));
    if (!fresh.length) return 0;
    this.reports.set(
      ticker,
      [...existing, ...fresh].sort((a, b) => a.report_date.localeCompare(b.report_date)),
    );
    this.enqueueOp('addPerformanceReports', [ticker, reports]);
    return fresh.length;
  }

  /** 合并进 overview(替换 overview/overviewLastUpdate;仅对既有 stock 生效,同 FileStore)。 */
  updateOverview(ticker: string, overview: Record<string, unknown>, stamp: string): void {
    const stock = this.stocks.get(ticker);
    if (!stock) return;
    this.stocks.set(ticker, { ...stock, overview, overviewLastUpdate: stamp });
    this.enqueueOp('updateOverview', [ticker, overview, stamp]);
  }

  getDatas(ticker: string): DailyBar[] {
    return (this.datas.get(ticker) ?? []).map((b) => ({ ...b }));
  }

  getPerformanceReports(ticker: string): PerformanceReport[] {
    return (this.reports.get(ticker) ?? []).map((r) => ({ report_date: r.report_date, fields: { ...r.fields } }));
  }

  getMeta(key: string): string | null {
    return this.meta.get(key) ?? null;
  }

  setMeta(key: string, value: string): void {
    this.meta.set(key, value);
    this.enqueueOp('setMeta', [key, value]);
  }
}

/** settingsStore 桥接(getItem/setItem 映射桥的 settingsLoad /
 *  settingsSaveAsync;忽略键名——单键语义与 web localStorage 分支一致)。
 *  setItem 先写本地镜像(getItem 立即可见)再异步落盘(invoke,不阻塞
 *  renderer 事件路径);失败仅 console.error(对齐 FileStore 写穿语义)。
 *  仅 isDesktopBridge() 为真时调用;无桥调用属接线错误,直接抛出。 */
export function bridgeStorage(): SettingsStorageLike {
  const bridge = getBridge();
  if (!bridge) throw new Error('bridgeStorage() 需先有 window.__soaDesktop');
  let mirror: string | null = null;
  return {
    getItem(): string | null {
      return mirror ?? bridge.settingsLoad();
    },
    setItem(_key: string, value: string): void {
      mirror = value;
      void bridge.settingsSaveAsync(value).catch((err) => {
        console.error(`[desktop] settings 异步落盘失败: ${String(err)}`);
      });
    },
  };
}
