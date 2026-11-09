import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, type DailyBar } from '../src/store.ts';
import { FileStore } from '../src/store-file.ts';
import {
  dailyFresh,
  freshnessGates,
  getLastBusinessDay,
  latestPastQuarterEnd,
  reportsFresh,
} from '../src/gates.ts';
import { InMemoryStore } from '../src/store-memory.ts';
import { applyCollectedToStore, collectViaProxy, type CollectedPayload } from '../src/webCollect.ts';
import { collectForWeb, setStore, store } from '../app/lib/runner.ts';

function bars(dates: string[]): DailyBar[] {
  return dates.map((date) => ({ date, open: 1, close: 2, high: 3, low: 0.5, volume: 100 }));
}

/** webCollect.test 同款载荷形状(简版,无 skip 语义)。 */
function payload(over: Partial<CollectedPayload> = {}): CollectedPayload {
  return {
    ticker: '002027',
    name: '分众传媒',
    bars: bars(['2026-08-13', '2026-08-14']),
    snapshot: { price: 6.4, high: 6.5, low: 6.1, open: 6.2, volume: 120000, amount: 768000000 },
    capitalText: '',
    f10Text: '【主要财务指标】\n净资产收益率: 15.2',
    ...over,
  };
}

describe('store (AC4)', () => {
  it('put/get round-trips overview and name', () => {
    const s = new Store();
    s.putStock({ ticker: '600036', name: '招商银行', overview: { latest_price: 38.8 }, overviewLastUpdate: '2026-08-07', lastDataUpdate: null });
    const r = s.getStock('600036');
    expect(r?.name).toBe('招商银行');
    expect(r?.overview).toEqual({ latest_price: 38.8 });
    s.close();
  });

  it('addDatas rejects bars not newer than last_data_update (align Python add_data)', () => {
    const s = new Store();
    s.putStock({ ticker: 'T', name: 'n', overview: null, overviewLastUpdate: null, lastDataUpdate: null });
    expect(s.addDatas('T', bars(['2026-01-01', '2026-01-02']))).toBe(2);
    expect(s.getDatas('T')).toHaveLength(2);
    // 全部重复 → 0，不写
    expect(s.addDatas('T', bars(['2026-01-01', '2026-01-02']))).toBe(0);
    expect(s.getDatas('T')).toHaveLength(2);
    // 部分新增
    expect(s.addDatas('T', bars(['2026-01-02', '2026-01-03']))).toBe(1);
    expect(s.getDatas('T')).toHaveLength(3);
    expect(s.getStock('T')?.lastDataUpdate).toBe('2026-01-03');
    s.close();
  });

  it('F11:lastDataUpdate 被 putStock 覆盖成旧值 → 重复批次仍 0(基线 = 表内既有末根日期)', () => {
    const s = new Store();
    s.putStock({ ticker: 'T', name: 'n', overview: null, overviewLastUpdate: null, lastDataUpdate: null });
    s.addDatas('T', bars(['2026-01-01', '2026-01-02']));
    // 模拟采集链 putStock 以旧戳覆盖(同日跳过/概览刷新路径常规操作)
    s.putStock({ ticker: 'T', name: 'n', overview: null, overviewLastUpdate: null, lastDataUpdate: '2025-12-31' });
    // 全部重复 → 0 不写(旧实现按 lastDataUpdate 过滤 → 重写 2 根且返回 2)
    expect(s.addDatas('T', bars(['2026-01-01', '2026-01-02']))).toBe(0);
    expect(s.getDatas('T')).toHaveLength(2);
    expect(s.getStock('T')?.lastDataUpdate).toBe('2025-12-31'); // 纯重复批次不动戳
    // 部分新增:仅新日期计入
    expect(s.addDatas('T', bars(['2026-01-02', '2026-01-03']))).toBe(1);
    expect(s.getDatas('T')).toHaveLength(3);
    expect(s.getStock('T')?.lastDataUpdate).toBe('2026-01-03');
    s.close();
  });

  it('replaceDatas:全量替换(旧行删除 + last_data_update 更新,单事务)', () => {
    const s = new Store();
    s.putStock({ ticker: 'T', name: 'n', overview: null, overviewLastUpdate: null, lastDataUpdate: null });
    s.addDatas('T', bars(['2026-01-01', '2026-01-02']));
    expect(s.replaceDatas('T', bars(['2026-02-01', '2026-02-02', '2026-02-03']))).toBe(3);
    const got = s.getDatas('T');
    expect(got).toHaveLength(3); // 旧 01-01/01-02 不残留
    expect(got[0].date).toBe('2026-02-01');
    expect(s.getStock('T')?.lastDataUpdate).toBe('2026-02-03');
    s.close();
  });

  it('InMemoryStore replaceDatas:空输入早退不清库;非空全量替换(旧行不残留)', () => {
    const s = new InMemoryStore();
    s.putStock({ ticker: 'T', name: 'n', overview: null, overviewLastUpdate: null, lastDataUpdate: null });
    s.addDatas('T', bars(['2026-01-01']));
    expect(s.replaceDatas('T', [])).toBe(0);
    expect(s.getDatas('T')).toHaveLength(1); // 空输入不清库
    expect(s.replaceDatas('T', bars(['2026-02-01', '2026-02-02']))).toBe(2);
    const got = s.getDatas('T');
    expect(got).toHaveLength(2);
    expect(got[0].date).toBe('2026-02-01'); // 旧 01-01 不残留
  });

  it('addPerformanceReports dedupes by report_date, single transaction', () => {
    const s = new Store();
    s.addPerformanceReports('T', [
      { report_date: '20260331', fields: { net_profit: 1 } },
      { report_date: '20260630', fields: { net_profit: 2 } },
    ]);
    expect(s.addPerformanceReports('T', [
      { report_date: '20260331', fields: { net_profit: 99 } }, // 重复
      { report_date: '20260930', fields: { net_profit: 3 } },
    ])).toBe(1);
    const reports = s.getPerformanceReports('T');
    expect(reports.map((r) => r.report_date)).toEqual(['20260331', '20260630', '20260930']);
    expect(reports[0].fields).toEqual({ net_profit: 1 });
    s.close();
  });

  it('meta get/set persists', () => {
    const s = new Store();
    expect(s.getMeta('x')).toBeNull();
    s.setMeta('x', 'v');
    expect(s.getMeta('x')).toBe('v');
    s.close();
  });
});

describe('gates (AC5)', () => {
  it('getLastBusinessDay: Sat→Fri, Sun→Fri, weekday→same', () => {
    // 2026-08-07 = Friday, 08-08 = Saturday, 08-09 = Sunday, 08-10 = Monday
    expect(getLastBusinessDay('2026-08-07')).toBe('2026-08-07');
    expect(getLastBusinessDay('2026-08-08')).toBe('2026-08-07');
    expect(getLastBusinessDay('2026-08-09')).toBe('2026-08-07');
    expect(getLastBusinessDay('2026-08-10')).toBe('2026-08-10');
  });

  it('latestPastQuarterEnd picks most recent passed quarter end', () => {
    expect(latestPastQuarterEnd('2026-08-10')).toBe('20260630');
    expect(latestPastQuarterEnd('2026-07-01')).toBe('20260630');
    expect(latestPastQuarterEnd('2026-06-30')).toBe('20260630');
    expect(latestPastQuarterEnd('2026-06-29')).toBe('20260331');
    expect(latestPastQuarterEnd('2026-01-15')).toBe('20251231');
  });

  // P3(评审 2026-11-09):±7 天窗口——非日历财年(如 AAPL 财年 Q3 收在 06-27)
  // 原先永远不满足,该源每轮重取。相邻季度末至少相隔 90 天,窗口不会串期。
  it('reportsFresh: 季度末 ±7 天内视为新鲜,超出则不新鲜', () => {
    expect(reportsFresh('20260627', '2026-08-10')).toBe(true); // 差 3 天
    expect(reportsFresh('20260623', '2026-08-10')).toBe(true); // 差 7 天(边界内)
    expect(reportsFresh('20260622', '2026-08-10')).toBe(false); // 差 8 天
    expect(reportsFresh('20260705', '2026-08-10')).toBe(true); // 晚于季度末 5 天
  });

  it('reportsFresh: latest == past quarter end → fresh', () => {
    expect(reportsFresh('20260630', '2026-08-10')).toBe(true);
    expect(reportsFresh('20260331', '2026-08-10')).toBe(false); // 未披露当期 → 不新鲜
    expect(reportsFresh(null, '2026-08-10')).toBe(false);
  });

  it('dailyFresh:lastDataUpdate == 今天 → 同日跳过日K(对齐 Python)', () => {
    expect(dailyFresh('2026-08-14', '2026-08-14')).toBe(true);
    expect(dailyFresh('2026-08-13', '2026-08-14')).toBe(false); // 跨日 → 重拉
    expect(dailyFresh(null, '2026-08-14')).toBe(false); // 首采 → 全量
  });

  it('freshnessGates:同日日K + 同季业绩组合判定,部分 fresh 独立', () => {
    expect(freshnessGates('2026-08-14', '20260630', '2026-08-14')).toEqual({
      dailyFresh: true,
      f10Fresh: true,
    });
    expect(freshnessGates('2026-08-13', '20260630', '2026-08-14')).toEqual({
      dailyFresh: false, // 日K 跨日 → 仍拉
      f10Fresh: true, // 业绩同季 → 跳过
    });
    expect(freshnessGates('2026-08-14', '20260331', '2026-08-14')).toEqual({
      dailyFresh: true,
      f10Fresh: false, // 未披露当期 → 重拉 F10
    });
    expect(freshnessGates(null, null, '2026-08-14')).toEqual({
      dailyFresh: false,
      f10Fresh: false, // 首采全量
    });
  });
});

describe('freshness 接线（C8：同日跳过日K / 同季跳过 F10）', () => {
  describe('applyCollectedToStore 跳过语义', () => {
    it('skipDaily:保留既有日K + lastDataUpdate(不置空),快照仍回传', () => {
      const s = new InMemoryStore();
      applyCollectedToStore(s, payload()); // 首次全量入库
      const before = s.getDatas('002027');
      const r = applyCollectedToStore(s, payload({ bars: [], skipDaily: true, name: '分众传媒' }));
      expect(s.getDatas('002027')).toEqual(before); // 不清空既有日K
      expect(s.getStock('002027')?.lastDataUpdate).toBe('2026-08-14'); // 不置空
      expect(s.getStock('002027')?.name).toBe('分众传媒'); // 名称仍刷新
      expect(r.snapshot?.price).toBe(6.4); // 快照仍回传
    });

    it('skipF10(f10Text 空):不重写业绩报告/meta,既有数据保留', () => {
      const s = new InMemoryStore();
      applyCollectedToStore(s, payload()); // 首次全量
      s.addPerformanceReports('002027', [{ report_date: '20260630', fields: { net_profit: 1 } }]); // 模拟同季已入库
      const before = s.getPerformanceReports('002027');
      applyCollectedToStore(s, payload({ f10Text: '' })); // 同季跳过 → 空文本
      expect(s.getPerformanceReports('002027')).toEqual(before); // 不重写不删除(幂等)
      expect(s.getMeta('f10:002027')).toContain('主要财务指标'); // 首次的 meta 保留
      // capitalText 持久化(DataScreen 换手率列消费)
      expect(s.getMeta('capital:002027')).toBeNull(); // 空 capitalText 不写
      applyCollectedToStore(s, payload({ capitalText: '总股本: 100000.0万股\n流通股本: 90000.0万股' }));
      expect(s.getMeta('capital:002027')).toContain('流通股本');
    });
  });

  describe('collectViaProxy 跳过参数', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('skipDaily/skipF10 → 查询参数;缺省不带参数(全量,兼容旧调用)', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload()), { status: 200 })));
      await collectViaProxy('002027', 'http://localhost:8090');
      expect(fetch).toHaveBeenCalledWith('http://localhost:8090/tdx-collect?ticker=002027');
      await collectViaProxy('002027', 'http://localhost:8090', { skipDaily: true, skipF10: true });
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:8090/tdx-collect?ticker=002027&skipDaily=1&skipF10=1',
      );
      await collectViaProxy('002027', 'http://localhost:8090', { skipDaily: true });
      expect(fetch).toHaveBeenCalledWith('http://localhost:8090/tdx-collect?ticker=002027&skipDaily=1');
    });
  });

  describe('collectForWeb 端到端(自动门判定)', () => {
    // F10:close() 为终态(排空 pending 写 + 禁后续写穿)——「close 即重置再复用」
    // 语义不再成立;复位须换新实例(setStore live binding 同步)
    beforeEach(() => {
      store.close();
      setStore(new FileStore());
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    });

    it('同日二次分析:自动 skipDaily+skipF10,沿用既有数据,缓存文本顶替 F10', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-14T02:00:00Z')); // 北京时间 2026-08-14
      // 首次分析已入库:同日日K + 同季业绩(20260630)
      store.putStock({
        ticker: '002027',
        name: '分众传媒',
        overview: null,
        overviewLastUpdate: null,
        lastDataUpdate: '2026-08-14',
      });
      store.addDatas('002027', bars(['2026-08-13', '2026-08-14']));
      store.addPerformanceReports('002027', [{ report_date: '20260630', fields: { net_profit: 1 } }]);
      store.setMeta('f10:002027', '【主要财务指标】\n净资产收益率: 15.2');
      // 二次分析:代理按跳过标记返回(日K/F10 均未拉)
      vi.stubGlobal('location', { origin: 'http://test' });
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          new Response(
            JSON.stringify(payload({ bars: [], f10Text: '', skipDaily: true })),
            { status: 200 },
          ),
        ),
      );
      const r = await collectForWeb('002027');

      expect(fetch).toHaveBeenCalledWith('http://test/tdx-collect?ticker=002027&skipDaily=1&skipF10=1');
      expect(store.getDatas('002027')).toHaveLength(2); // 既有日K 保留
      expect(store.getStock('002027')?.lastDataUpdate).toBe('2026-08-14'); // 不置空
      expect(r.f10Text).toContain('主要财务指标'); // 缓存文本顶替,盈利能力块不降级
      expect(r.snapshot?.price).toBe(6.4); // 快照仍拉取
    });

    it('跨日/跨季首次:全量路径不变(无跳过参数,新数据入库)', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-14T02:00:00Z'));
      // 上次采集是昨天(跨日),无业绩(跨季/首采)
      store.putStock({
        ticker: '002027',
        name: '分众传媒',
        overview: null,
        overviewLastUpdate: null,
        lastDataUpdate: '2026-08-13',
      });
      store.addDatas('002027', bars(['2026-08-13']));
      vi.stubGlobal('location', { origin: 'http://test' });
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          new Response(
            JSON.stringify(
              payload({ bars: bars(['2026-08-13', '2026-08-14']), f10Text: '【主要财务指标】\n净资产收益率: 15.2' }),
            ),
            { status: 200 },
          ),
        ),
      );
      await collectForWeb('002027');

      expect(fetch).toHaveBeenCalledWith('http://test/tdx-collect?ticker=002027'); // 全量,无跳过
      expect(store.getDatas('002027')).toHaveLength(2); // 新数据全量替换
      expect(store.getDatas('002027')[1].date).toBe('2026-08-14');
      expect(store.getStock('002027')?.lastDataUpdate).toBe('2026-08-14');
    });
  });
});

// S3-3/S10-1 + S3-5(评审 2026-11-08):DailyBar.volume 已是 number|null,但 SQLite
// 声明仍是 `volume INTEGER NOT NULL` → 入库 null 会 `NOT NULL constraint failed`
// 并回滚整批。同时旧库无法靠 CREATE TABLE IF NOT EXISTS 改列,需要一次重建。
describe('SQLite volume 可空 + 旧库迁移(S3-3/S10-1/S3-5)', () => {
  it('volume: null 可入库并原样读回', () => {
    const s = new Store(':memory:');
    try {
      s.putStock({ ticker: 'T', name: 'n', overview: null, overviewLastUpdate: null, lastDataUpdate: null });
      const bar: DailyBar = { date: '2026-11-07', open: 1, close: 2, high: 3, low: 0.5, volume: null };
      expect(s.addDatas('T', [bar])).toBe(1);
      expect(s.getDatas('T')[0].volume).toBeNull();
    } finally {
      s.close();
    }
  });

  it('旧库(daily_bars.volume NOT NULL)打开时重建为可空,旧数据保留', () => {
    const dir = mkdtempSync(join(tmpdir(), 'soa-store-mig-'));
    const dbPath = join(dir, 'soa.sqlite');
    try {
      // 手工构造「旧版本」库(与迁移前 SCHEMA 同形)
      const old = new Database(dbPath);
      old.exec(`
        CREATE TABLE stocks (ticker TEXT PRIMARY KEY, name TEXT NOT NULL, overview_json TEXT,
          overview_last_update TEXT, last_data_update TEXT);
        CREATE TABLE daily_bars (ticker TEXT NOT NULL, date TEXT NOT NULL, open REAL NOT NULL,
          close REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL, volume INTEGER NOT NULL, amount REAL,
          PRIMARY KEY (ticker, date));
        CREATE TABLE performance_reports (ticker TEXT NOT NULL, report_date TEXT NOT NULL,
          fields_json TEXT NOT NULL, PRIMARY KEY (ticker, report_date));
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      `);
      old.prepare('INSERT INTO daily_bars VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
        'T', '2026-11-06', 1, 2, 3, 0.5, 100, null,
      );
      old.close();

      const s = new Store(dbPath);
      try {
        expect(s.getDatas('T')).toHaveLength(1); // 迁移不丢旧行
        expect(s.getDatas('T')[0].volume).toBe(100);
        expect(s.addDatas('T', [{ date: '2026-11-07', open: 1, close: 2, high: 3, low: 0.5, volume: null }])).toBe(1);
        expect(s.getDatas('T')[1].volume).toBeNull();
      } finally {
        s.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
