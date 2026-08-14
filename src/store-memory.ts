// 内存仓储 —— RN/web 用 StoreLike 实现(better-sqlite3 是 Node 原生,浏览器不可用)
// 语义对齐 Store:addDatas 拒绝 date <= lastDataUpdate;业绩按 report_date 去重。
import type { DailyBar, PerformanceReport, StockRecord, StoreLike } from './store.ts';

export class InMemoryStore implements StoreLike {
  private stocks = new Map<string, StockRecord>();
  private bars = new Map<string, DailyBar[]>();
  private reports = new Map<string, PerformanceReport[]>();
  private meta = new Map<string, string>();

  close(): void {
    this.stocks.clear();
    this.bars.clear();
    this.reports.clear();
    this.meta.clear();
  }

  getStock(ticker: string): StockRecord | null {
    return this.stocks.get(ticker) ?? null;
  }

  putStock(record: StockRecord): void {
    this.stocks.set(record.ticker, { ...record });
  }

  addDatas(ticker: string, bars: DailyBar[]): number {
    if (!bars.length) return 0;
    const existing = this.bars.get(ticker) ?? [];
    const last = existing.length ? existing[existing.length - 1].date : null;
    const fresh = bars.filter((b) => last === null || b.date > last);
    if (!fresh.length) return 0;
    const merged = [...existing, ...fresh].sort((a, b) => a.date.localeCompare(b.date));
    // 升序契约 + 同日期去重(keep last)
    const seen = new Map<string, DailyBar>();
    for (const b of merged) seen.set(b.date, b);
    this.bars.set(ticker, [...seen.values()].sort((a, b) => a.date.localeCompare(b.date)));
    const stock = this.stocks.get(ticker);
    if (stock) {
      this.stocks.set(ticker, { ...stock, lastDataUpdate: fresh[fresh.length - 1].date });
    }
    return fresh.length;
  }

  /** 全量替换(web 采集:代理返回 IPO 全量;防 demo 预载合并混入;空输入早退不清库)。 */
  replaceDatas(ticker: string, bars: DailyBar[]): number {
    if (!bars.length) return 0;
    this.bars.delete(ticker);
    return this.addDatas(ticker, bars);
  }

  addPerformanceReports(ticker: string, reports: PerformanceReport[]): number {
    if (!reports.length) return 0;
    const existing = this.reports.get(ticker) ?? [];
    const known = new Set(existing.map((r) => r.report_date));
    const fresh = reports.filter((r) => !known.has(r.report_date));
    if (!fresh.length) return 0;
    this.reports.set(ticker, [...existing, ...fresh].sort((a, b) => a.report_date.localeCompare(b.report_date)));
    return fresh.length;
  }

  updateOverview(ticker: string, overview: Record<string, unknown>, stamp: string): void {
    const stock = this.stocks.get(ticker);
    if (stock) {
      this.stocks.set(ticker, { ...stock, overview, overviewLastUpdate: stamp });
    }
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
  }
}
