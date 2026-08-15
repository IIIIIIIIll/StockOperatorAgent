import { TdxClient } from 'node-tdx-market';
import { getCompanyInfoCategory, getCompanyInfoContent, f10MarketFor } from '../src/tdx/f10Client.ts';
import { parseFinanceIndicatorsAllTables, parseIndicatorSection, type F10Record } from '../src/f10.ts';
import { composeReports } from '../src/reports.ts';
import { financialTrendSeries } from '../src/chartData.ts';

const client = new TdxClient({ host: '150.158.160.2', connectTimeout: 8000, requestTimeout: 12000 });
client.on('error', () => {});
await client.connect();
const ticker = '600036';
try {
  const cats = await getCompanyInfoCategory(client, f10MarketFor(ticker), ticker);
  const sec = cats.find((c) => c.name.includes('财务分析'));
  const f10 = sec
    ? await getCompanyInfoContent(client, f10MarketFor(ticker), ticker, sec.filename, sec.start, sec.length)
    : '';
  const zyzb = parseFinanceIndicatorsAllTables(f10);
  const profit = parseIndicatorSection(f10, '【盈利能力指标】');

  const byV = (rows: F10Record[]): string => {
    const m = new Map<string, { n: number; last: string }>();
    for (const r of rows) {
      if (Number.isNaN(r.value_num)) continue;
      const e = m.get(r.metric) ?? { n: 0, last: '' };
      e.n++;
      e.last = r.period;
      m.set(r.metric, e);
    }
    return [...m.entries()].map(([k, v]) => `${k}×${v.n}[${v.last}]`).join(' | ');
  };

  console.log('盈利能力有效值:', byV(profit));
  console.log('主要财务指标有效值:', byV(zyzb));

  const reports = composeReports(ticker, '招商银行', zyzb);
  console.log('report fields keys:', reports[0] ? Object.keys(reports[0].fields).join(',') : 'none');
  const series = financialTrendSeries(reports, profit);
  console.log('财务趋势 series:', series.map((s) => `${s.label}: ${s.points.length}点`).join(' | '));
} finally {
  client.disconnect();
}
