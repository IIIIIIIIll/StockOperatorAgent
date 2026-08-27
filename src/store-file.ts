// 文件仓储 —— RN 端 StoreLike 持久化后端(expo-file-system;设计 §7 决策 C,禁止更改)
// 语义对齐 InMemoryStore/Store(同 IdbStore):addDatas 增量去重、replaceDatas 空输入
// 早退不清库、业绩 report_date 去重、getDatas/getPerformanceReports 返回副本。
// 架构:自维护内存缓存双写(内存同步读 + 异步整文件重写,串行队列保证写序;
// 落盘 = 同目录 tmp 文件 + 原子替换,进程中断只留无害 tmp 或旧文件完整态,
// 不产生半截 JSON);ready() 读全部文件 hydrate(单文件损坏仅跳过该文件并记
// error,不中断其余文件加载);getters 同步读内存副本。
// 布局:<baseDir>/<ticker>.json({stock,bars,reports}) + <baseDir>/meta.json
// (Record<string,string>)。生产默认适配器 expo-file-system(documentDirectory 下
// 解析,惰性动态 import,同 log.ts RN 分支先例);测试注入 node fs 适配器。
import type { DailyBar, PerformanceReport, StockRecord, StoreLike } from './store.ts';
import { error as logError } from './log.ts';

export interface FileFsAdapter {
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, data: string): Promise<void>;
  listDir(): Promise<string[]>;
}

interface TickerFile {
  stock: StockRecord | null;
  bars: DailyBar[];
  reports: PerformanceReport[];
}

const META_FILE = 'meta.json';
const DEFAULT_BASE_DIR = 'soa-store';

function joinPath(baseDir: string, name: string): string {
  return baseDir.endsWith('/') ? baseDir + name : `${baseDir}/${name}`;
}

// ─── 生产默认后端:expo-file-system(惰性解析一次;仅 RN 运行时可达)─────────
interface ExpoBackend {
  fs: FileFsAdapter;
  baseDir: string;
}

let expoBackendPromise: Promise<ExpoBackend> | null = null;

function getExpoBackend(relBaseDir: string): Promise<ExpoBackend> {
  expoBackendPromise ??= (async () => {
    try {
      // 动态 import 边界(类型见 expo-file-system.d.ts):web/Node 包不含该模块,
      // 仅 RN 运行时触发;vitest(ts/ 根)解析失败 → 上层 catch 降级
      const { File, Directory, Paths } = await import('expo-file-system');
      const root = new Directory(Paths.document, relBaseDir);
      if (!root.exists) root.create({ intermediates: true, idempotent: true });
      const baseDir = root.uri;
      return {
        baseDir,
        fs: {
          async readFile(path: string): Promise<string | null> {
            const f = new File(path);
            return f.exists ? await f.text() : null;
          },
          async writeFile(path: string, data: string): Promise<void> {
            // 原子写:先写同目录 tmp(后缀不以 .json 结尾 → hydrate 扫描天然跳过
            // 崩溃残留),再 moveSync 原子替换目标。SDK 57 moveSync 默认不覆盖已存在
            // 目标(RelocationOptions.overwrite 默认 false),必须显式传 overwrite:true。
            const dest = new File(path);
            const tmp = new File(`${path}.tmp.${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
            if (!tmp.exists) tmp.create();
            tmp.write(data);
            tmp.moveSync(dest, { overwrite: true });
          },
          async listDir(): Promise<string[]> {
            return new Directory(baseDir).list().map((e: { name: string }) => e.name);
          },
        },
      };
    } catch (err) {
      // F04:动态 import/初始化失败清 memo——拒绝不永久缓存,后续可重试
      expoBackendPromise = null;
      throw err;
    }
  })();
  return expoBackendPromise;
}

export class FileStore implements StoreLike {
  private stocks = new Map<string, StockRecord>();
  private bars = new Map<string, DailyBar[]>();
  private reports = new Map<string, PerformanceReport[]>();
  private meta = new Map<string, string>();
  private readonly baseDir: string;
  private readonly fs: FileFsAdapter | undefined;
  private queue: Promise<void> = Promise.resolve();
  private readyPromise: Promise<void> | null = null;

  /** baseDir:测试传 os.tmpdir 子目录;生产省略 → 'soa-store' 由 expo 适配器在 documentDirectory 下解析。 */
  constructor(baseDir?: string, fs?: FileFsAdapter) {
    this.baseDir = baseDir ?? DEFAULT_BASE_DIR;
    this.fs = fs;
  }

  /** 读全部文件 hydrate 内存镜像(内存已有键优先——先写后 ready 的变更不丢)。 */
  async ready(): Promise<void> {
    // F04:hydrate 失败清 memo——拒绝不永久缓存(如后端 fs 暂时不可用),可重试
    try {
      this.readyPromise ??= this.hydrate();
      return await this.readyPromise;
    } catch (err) {
      this.readyPromise = null;
      throw err;
    }
  }

  /** 等待写队列排空(测试断言前调用;失败仅记录不抛出,排空即返回)。 */
  async flush(): Promise<void> {
    await this.queue;
  }

  private async backend(): Promise<{ fs: FileFsAdapter; baseDir: string }> {
    if (this.fs) return { fs: this.fs, baseDir: this.baseDir };
    return getExpoBackend(this.baseDir);
  }

  private async hydrate(): Promise<void> {
    const { fs, baseDir } = await this.backend();
    const names = await fs.listDir();
    // 单文件容错(评审 08-23 F1):单个坏文件只跳过自身并 logError,不中断其余
    // 文件加载 —— 此前首个坏文件的解析异常会沿 readyPromise 缓存 rejection,
    // 全库不可读直至手工删除该文件。非 .json 后缀的崩溃残留 tmp(原子写中间态)
    // 走不进下方分支,由命名契约天然跳过。
    for (const name of names) {
      try {
        if (name === META_FILE) {
          const text = await fs.readFile(joinPath(baseDir, name));
          if (text == null) continue;
          const rows = JSON.parse(text) as Record<string, string>;
          for (const [k, v] of Object.entries(rows)) {
            if (!this.meta.has(k)) this.meta.set(k, v);
          }
        } else if (name.endsWith('.json')) {
          const ticker = name.slice(0, -'.json'.length);
          const text = await fs.readFile(joinPath(baseDir, name));
          if (text == null) continue;
          const data = JSON.parse(text) as TickerFile;
          if (data.stock && !this.stocks.has(ticker)) this.stocks.set(ticker, { ...data.stock });
          if (data.bars?.length && !this.bars.has(ticker)) {
            this.bars.set(ticker, [...data.bars].sort((a, b) => a.date.localeCompare(b.date)));
          }
          if (data.reports?.length && !this.reports.has(ticker)) {
            this.reports.set(
              ticker,
              [...data.reports].sort((a, b) => a.report_date.localeCompare(b.report_date)),
            );
          }
        }
      } catch (err) {
        logError(`FileStore 跳过损坏文件:${name}(${err instanceof Error ? err.message : String(err)})`);
      }
    }
  }

  /** 串行写队列:整文件重写(执行时读内存最新态 → 幂等);失败仅记录不阻断(决策 C)。 */
  private enqueue(op: () => Promise<void>): void {
    this.queue = this.queue
      .then(() => this.ready())
      .then(op)
      .catch((err: unknown) => {
        logError(`FileStore 落盘失败:${err instanceof Error ? err.message : String(err)}`);
      });
  }

  private enqueuePersistTicker(ticker: string): void {
    this.enqueue(async () => {
      const { fs, baseDir } = await this.backend();
      const payload: TickerFile = {
        stock: this.stocks.get(ticker) ?? null,
        bars: this.bars.get(ticker) ?? [],
        reports: this.reports.get(ticker) ?? [],
      };
      await fs.writeFile(joinPath(baseDir, `${ticker}.json`), JSON.stringify(payload));
    });
  }

  private enqueuePersistMeta(): void {
    this.enqueue(async () => {
      const { fs, baseDir } = await this.backend();
      await fs.writeFile(joinPath(baseDir, META_FILE), JSON.stringify(Object.fromEntries(this.meta)));
    });
  }

  close(): void {
    this.stocks.clear();
    this.bars.clear();
    this.reports.clear();
    this.meta.clear();
    this.queue = Promise.resolve();
    this.readyPromise = null;
  }

  getStock(ticker: string): StockRecord | null {
    return this.stocks.get(ticker) ?? null;
  }

  putStock(record: StockRecord): void {
    this.stocks.set(record.ticker, { ...record });
    this.enqueuePersistTicker(record.ticker);
  }

  /** 批量追加日K:拒绝 date <= 既有末根日期;升序契约 + 同日期去重(keep last)。 */
  addDatas(ticker: string, bars: DailyBar[]): number {
    if (!bars.length) return 0;
    const fresh = this.mergeBars(ticker, bars);
    if (!fresh) return 0;
    this.enqueuePersistTicker(ticker);
    return fresh;
  }

  /** 全量替换该 ticker 日K(空输入早退不清库)——web 采集语义:代理返回 IPO 全量历史。 */
  replaceDatas(ticker: string, bars: DailyBar[]): number {
    if (!bars.length) return 0;
    this.bars.delete(ticker);
    const fresh = this.mergeBars(ticker, bars);
    if (!fresh) return 0;
    this.enqueuePersistTicker(ticker);
    return fresh;
  }

  /** 返回实际追加数;0 = 全部重复不写。 */
  private mergeBars(ticker: string, bars: DailyBar[]): number {
    const existing = this.bars.get(ticker) ?? [];
    const last = existing.length ? existing[existing.length - 1].date : null;
    const fresh = bars.filter((b) => last === null || b.date > last);
    if (!fresh.length) return 0;
    const merged = [...existing, ...fresh].sort((a, b) => a.date.localeCompare(b.date));
    const seen = new Map<string, DailyBar>();
    for (const b of merged) seen.set(b.date, b);
    this.bars.set(ticker, [...seen.values()].sort((a, b) => a.date.localeCompare(b.date)));
    const stock = this.stocks.get(ticker);
    if (stock) {
      this.stocks.set(ticker, { ...stock, lastDataUpdate: fresh[fresh.length - 1].date });
    }
    return fresh.length;
  }

  /** 批量追加业绩报告:按 report_date 去重。 */
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
    this.enqueuePersistTicker(ticker);
    return fresh.length;
  }

  updateOverview(ticker: string, overview: Record<string, unknown>, stamp: string): void {
    const stock = this.stocks.get(ticker);
    if (!stock) return;
    this.stocks.set(ticker, { ...stock, overview, overviewLastUpdate: stamp });
    this.enqueuePersistTicker(ticker);
  }

  getDatas(ticker: string): DailyBar[] {
    return (this.bars.get(ticker) ?? []).map((b) => ({ ...b }));
  }

  getPerformanceReports(ticker: string): PerformanceReport[] {
    return (this.reports.get(ticker) ?? []).map((r) => ({ report_date: r.report_date, fields: { ...r.fields } }));
  }

  getMeta(key: string): string | null {
    return this.meta.get(key) ?? null;
  }

  setMeta(key: string, value: string): void {
    this.meta.set(key, value);
    this.enqueuePersistMeta();
  }

  /** 已 putStock 的全部 ticker(桌面桥 StoreSnapshot 枚举用;具体类方法,
   *  不进 StoreLike 接口 —— 仅桌面 Node 后端消费)。 */
  listStocks(): string[] {
    return [...this.stocks.keys()];
  }

  /** 已 setMeta 的全部键(桌面桥 StoreSnapshot 枚举用;具体类方法,
   *  不进 StoreLike 接口 —— 仅桌面 Node 后端消费)。 */
  listMetaKeys(): string[] {
    return [...this.meta.keys()];
  }
}
