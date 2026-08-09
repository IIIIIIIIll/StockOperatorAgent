// SQLite 仓储 —— 对齐 Python ZODBStorage + ChinaStock 语义（见 spec data_storage/data_structure）
// 单事务批量写：addDatas / addPerformanceReports 一次 commit；0 = 全部重复不写
import Database from 'better-sqlite3';

export interface DailyBar {
  date: string; // YYYY-MM-DD（升序契约）
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number; // 手
  amount?: number | null;
}

export interface PerformanceReport {
  report_date: string; // '%Y%m%d'
  fields: Record<string, unknown>;
}

export interface StockRecord {
  ticker: string;
  name: string;
  overview: Record<string, unknown> | null;
  overviewLastUpdate: string | null; // YYYY-MM-DD
  lastDataUpdate: string | null; // YYYY-MM-DD
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS stocks (
  ticker TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  overview_json TEXT,
  overview_last_update TEXT,
  last_data_update TEXT
);
CREATE TABLE IF NOT EXISTS daily_bars (
  ticker TEXT NOT NULL,
  date TEXT NOT NULL,
  open REAL NOT NULL,
  close REAL NOT NULL,
  high REAL NOT NULL,
  low REAL NOT NULL,
  volume INTEGER NOT NULL,
  amount REAL,
  PRIMARY KEY (ticker, date)
);
CREATE TABLE IF NOT EXISTS performance_reports (
  ticker TEXT NOT NULL,
  report_date TEXT NOT NULL,
  fields_json TEXT NOT NULL,
  PRIMARY KEY (ticker, report_date)
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export class Store {
  private db: Database.Database;

  constructor(dbPath = ':memory:') {
    this.db = new Database(dbPath);
    this.db.exec(SCHEMA);
    this.db.pragma('journal_mode = WAL');
  }

  close(): void {
    this.db.close();
  }

  getStock(ticker: string): StockRecord | null {
    const row = this.db.prepare('SELECT * FROM stocks WHERE ticker = ?').get(ticker) as
      | { ticker: string; name: string; overview_json: string | null; overview_last_update: string | null; last_data_update: string | null }
      | undefined;
    if (!row) return null;
    return {
      ticker: row.ticker,
      name: row.name,
      overview: row.overview_json ? JSON.parse(row.overview_json) : null,
      overviewLastUpdate: row.overview_last_update,
      lastDataUpdate: row.last_data_update,
    };
  }

  putStock(record: StockRecord): void {
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO stocks (ticker, name, overview_json, overview_last_update, last_data_update)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(ticker) DO UPDATE SET
             name = excluded.name,
             overview_json = excluded.overview_json,
             overview_last_update = excluded.overview_last_update,
             last_data_update = excluded.last_data_update`,
        )
        .run(
          record.ticker,
          record.name,
          record.overview ? JSON.stringify(record.overview) : null,
          record.overviewLastUpdate,
          record.lastDataUpdate,
        );
    });
    tx();
  }

  /**
   * 批量追加日K（对齐 Python add_datas：输入升序；拒绝 date <= last_data_update；
   * 单事务；返回实际追加数，0 = 全部重复不写）。
   */
  addDatas(ticker: string, bars: DailyBar[]): number {
    if (!bars.length) return 0;
    const stock = this.getStock(ticker);
    const last = stock?.lastDataUpdate ?? null;
    const fresh = bars.filter((b) => last === null || b.date > last);
    if (!fresh.length) return 0;
    const insert = this.db.prepare(
      `INSERT OR REPLACE INTO daily_bars (ticker, date, open, close, high, low, volume, amount)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const tx = this.db.transaction(() => {
      for (const b of fresh) {
        insert.run(ticker, b.date, b.open, b.close, b.high, b.low, b.volume, b.amount ?? null);
      }
      const maxDate = fresh[fresh.length - 1].date;
      this.db
        .prepare('UPDATE stocks SET last_data_update = ? WHERE ticker = ?')
        .run(maxDate, ticker);
    });
    tx();
    return fresh.length;
  }

  /** 批量追加业绩报告（对齐 Python add_performance_reports：report_date 去重，单事务）。 */
  addPerformanceReports(ticker: string, reports: PerformanceReport[]): number {
    if (!reports.length) return 0;
    const existing = new Set(
      (this.db
        .prepare('SELECT report_date FROM performance_reports WHERE ticker = ?')
        .all(ticker) as Array<{ report_date: string }>).map((r) => r.report_date),
    );
    const fresh = reports.filter((r) => !existing.has(r.report_date));
    if (!fresh.length) return 0;
    const insert = this.db.prepare(
      'INSERT OR REPLACE INTO performance_reports (ticker, report_date, fields_json) VALUES (?, ?, ?)',
    );
    const tx = this.db.transaction(() => {
      for (const r of fresh) {
        insert.run(ticker, r.report_date, JSON.stringify(r.fields));
      }
    });
    tx();
    return fresh.length;
  }

  updateOverview(ticker: string, overview: Record<string, unknown>, stamp: string): void {
    this.db
      .prepare('UPDATE stocks SET overview_json = ?, overview_last_update = ? WHERE ticker = ?')
      .run(JSON.stringify(overview), stamp, ticker);
  }

  getDatas(ticker: string): DailyBar[] {
    return (
      this.db
        .prepare('SELECT date, open, close, high, low, volume, amount FROM daily_bars WHERE ticker = ? ORDER BY date')
        .all(ticker) as Array<{
        date: string;
        open: number;
        close: number;
        high: number;
        low: number;
        volume: number;
        amount: number | null;
      }>
    ).map((r) => ({ ...r, amount: r.amount ?? null }));
  }

  getPerformanceReports(ticker: string): PerformanceReport[] {
    return (
      this.db
        .prepare('SELECT report_date, fields_json FROM performance_reports WHERE ticker = ? ORDER BY report_date')
        .all(ticker) as Array<{ report_date: string; fields_json: string }>
    ).map((r) => ({ report_date: r.report_date, fields: JSON.parse(r.fields_json) }));
  }

  getMeta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }
}
