// AC7 集成探针：真实 TDX 服务器全链（getQuote / 日K / xdxr / F10）
// 网络依赖——默认跳过，SOA_LIVE=1 时运行：
//   SOA_LIVE=1 npx vitest run test/live.integration.test.ts
import { describe, expect, it } from 'vitest';
import { TdxClient, KlineCategory } from 'node-tdx-market';
import { getXdxrInfo, parseXdxrResponse } from '../src/tdx/xdxr';
import { getCompanyInfoCategory, getCompanyInfoContent } from '../src/tdx/f10Client';
import { qfqAdjust } from '../src/adjust';

const LIVE = process.env.SOA_LIVE === '1';

describe.skipIf(!LIVE)('live TDX integration (AC7)', () => {
  it('quote + kline + xdxr + F10 all reachable and consistent', async () => {
    const client = new TdxClient({ connectTimeout: 8000, requestTimeout: 8000 });
    client.on('error', () => {});
    try {
      await client.connect();

      // 快照（getQuote 正确调用姿势：string）
      const q = await client.getQuote('sh600036');
      expect(q[0].price).toBeGreaterThan(0);
      expect(q[0].code).toBe('600036');

      // 日K：最近 bar 与快照同日同价
      const k = await client.getKline({ code: 'sh600036', category: KlineCategory.Day, start: 0, count: 5 });
      const last = k.bars[k.bars.length - 1];
      expect(Math.abs(last.close - q[0].price)).toBeLessThan(1e-6);

      // xdxr：与 fixture 一致（67 条，最近事件 2026-07-10 fenhong=10.03）
      const xdxr = await getXdxrInfo(client, 1, '600036');
      const div = xdxr.filter((r) => r.category === 1);
      expect(xdxr.length).toBe(67);
      const lastDiv = div[div.length - 1];
      expect(`${lastDiv.year}${String(lastDiv.month).padStart(2, '0')}${String(lastDiv.day).padStart(2, '0')}`).toBe('20260710');
      expect(Math.abs(lastDiv.fenhong! - 10.03)).toBeLessThan(1e-6);

      // F10：category + content + 解析
      const cats = await getCompanyInfoCategory(client, 1, '600036');
      const sec = cats.find((c) => c.name.includes('财务分析'));
      expect(sec).toBeTruthy();
      const text = await getCompanyInfoContent(client, 1, '600036', sec!.filename, sec!.start, sec!.length);
      expect(text.length).toBeGreaterThan(1000);
      const { parseFinanceIndicatorsAllTables } = await import('../src/f10');
      expect(parseFinanceIndicatorsAllTables(text).length).toBeGreaterThan(100);

      // qfq 端到端：日K + xdxr → 复权（最近 250 根与 fixture 逐位一致）
      const all = [];
      for (let start = 0; start < 9000; start += 800) {
        const r = await client.getKline({ code: 'sh600036', category: KlineCategory.Day, start, count: 800 });
        all.push(...r.bars);
        if (r.count < 800) break;
      }
      const bars = all
        .map((b) => ({
          date: b.time.toISOString().slice(0, 10).replace(/-/g, ''),
          open: b.open / 1000, close: b.close / 1000,
          high: b.high / 1000, low: b.low / 1000, volume: b.volume,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));
      const events = xdxr.map((r) => ({
        tradeDate: `${r.year}${String(r.month).padStart(2, '0')}${String(r.day).padStart(2, '0')}`,
        fenhong: r.fenhong, peigujia: r.peigujia, songzhuangu: r.songzhuangu,
        peigu: r.peigu, suogu: r.suogu,
      }));
      const adj = qfqAdjust(bars, events);
      const fixture = JSON.parse(require('node:fs').readFileSync('test/fixtures/600036_daily.json', 'utf8'));
      for (let i = 0; i < 250; i++) {
        const a = adj[adj.length - 250 + i];
        const e = fixture.adjusted[fixture.adjusted.length - 250 + i];
        expect(a.date).toBe(e.date);
        expect(Math.abs(a.close - e.close)).toBeLessThan(1e-6);
      }
    } finally {
      client.disconnect();
    }
  });
});
