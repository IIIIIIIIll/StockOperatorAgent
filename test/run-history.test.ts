// 分析历史归档纯契约单测 —— 摘要派生/校验/本地日分组(PRD R3/R4)。
// 时间一律用本地 Date 构造再 toISOString,分组结果与设备时区无关(实现按本地日)。
import { describe, expect, it } from 'vitest';
import {
  decisionPreview,
  groupRunsByDay,
  localDayKey,
  newRunId,
  parseAnalysisRun,
  parseRunSummaries,
  sortSummaries,
  toSummary,
  type AnalysisRun,
  type RunSummary,
} from '../src/runHistory.ts';

function run(over: Partial<AnalysisRun> = {}): AnalysisRun {
  return {
    id: '2026-11-04T09-30-00-000Z-aaaaaa',
    at: '2026-11-04T01:30:00.000Z',
    mode: 'real',
    ticker: '600036',
    market: 'cn',
    stock_information: '【采集数据】招商银行',
    final_decision: '买入并持有',
    opinions: [{ key: 'fundamental_analysis', tabTitle: '基本面分析', content: '稳健' }],
    ...over,
  };
}

function summary(over: Partial<RunSummary> = {}): RunSummary {
  return {
    id: 'r1',
    at: '2026-11-04T01:30:00.000Z',
    mode: 'real',
    ticker: '600036',
    market: 'cn',
    decisionPreview: '买入',
    ...over,
  };
}

describe('newRunId', () => {
  it('去掉 ISO 里的 : 与 .(文件名/索引键安全),salt 决定后缀', () => {
    const id = newRunId('2026-11-04T01:30:00.000Z', 'abc123');
    expect(id).toBe('2026-11-04T01-30-00-000Z-abc123');
    expect(id).not.toMatch(/[:.]/);
  });

  it('无 salt 也生成非空唯一后缀', () => {
    const a = newRunId('2026-11-04T01:30:00.000Z');
    const b = newRunId('2026-11-04T01:30:00.000Z');
    expect(a).not.toBe(b);
  });
});

describe('decisionPreview', () => {
  it('取首个非空行并剥行首 Markdown 记号/强调符,压缩空白', () => {
    expect(decisionPreview('\n\n## **买入**，目标价 42\n次行')).toBe('买入，目标价 42');
    expect(decisionPreview('> `持有`   观察')).toBe('持有 观察');
  });

  it('超长截断并加省略号', () => {
    const long = 'A'.repeat(120);
    const out = decisionPreview(long, 10);
    expect(out).toBe('AAAAAAAAAA…');
  });

  it('空正文 → 空串(列表行留空,不崩)', () => {
    expect(decisionPreview('   \n\n')).toBe('');
  });
});

describe('toSummary', () => {
  it('字段投影正确(正文不进摘要)', () => {
    const r = run({ final_decision: '# 结论\n买入' });
    expect(toSummary(r)).toEqual({
      id: r.id,
      at: r.at,
      mode: 'real',
      ticker: '600036',
      market: 'cn',
      decisionPreview: '结论',
    });
  });
});

describe('parseAnalysisRun', () => {
  it('合法记录 round-trip', () => {
    const r = run();
    expect(parseAnalysisRun(JSON.parse(JSON.stringify(r)))).toEqual(r);
  });

  it('缺字段 / 非法枚举 / opinions 形状错 → null(不抛)', () => {
    const base = run() as unknown as Record<string, unknown>;
    expect(parseAnalysisRun(null)).toBeNull();
    expect(parseAnalysisRun('x')).toBeNull();
    expect(parseAnalysisRun({ ...base, id: '' })).toBeNull();
    expect(parseAnalysisRun({ ...base, mode: 'live' })).toBeNull();
    expect(parseAnalysisRun({ ...base, market: 'jp' })).toBeNull();
    expect(parseAnalysisRun({ ...base, opinions: [{ key: 1 }] })).toBeNull();
    expect(parseAnalysisRun({ ...base, final_decision: 42 })).toBeNull();
  });
});

describe('parseRunSummaries', () => {
  it('坏条目逐条跳过,结果按时间倒序', () => {
    const out = parseRunSummaries([
      summary({ id: 'old', at: '2026-11-01T00:00:00.000Z' }),
      { id: 'bad' },
      summary({ id: 'new', at: '2026-11-04T00:00:00.000Z' }),
    ]);
    expect(out.map((s) => s.id)).toEqual(['new', 'old']);
    expect(parseRunSummaries(null)).toEqual([]);
    expect(parseRunSummaries({})).toEqual([]);
  });
});

describe('sortSummaries', () => {
  it('时间倒序;同刻按 id 倒序(稳定)', () => {
    const at = '2026-11-04T00:00:00.000Z';
    const out = sortSummaries([
      summary({ id: 'a', at }),
      summary({ id: 'c', at: '2026-11-05T00:00:00.000Z' }),
      summary({ id: 'b', at }),
    ]);
    expect(out.map((s) => s.id)).toEqual(['c', 'b', 'a']);
    // 不改入参
    expect(sortSummaries([summary({ id: 'x' }), summary({ id: 'y' })])).toHaveLength(2);
  });
});

describe('localDayKey', () => {
  it('按本地日历日零填充', () => {
    expect(localDayKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});

describe('groupRunsByDay', () => {
  // 本地时间构造:分组是本地日语义,测试不依赖运行环境时区
  const now = new Date(2026, 10, 4, 20, 0); // 2026-11-04 20:00 local
  const atLocal = (y: number, mo: number, d: number, h = 10) =>
    new Date(y, mo - 1, d, h, 0).toISOString();

  it('今天/昨天/同日多条的标签与组内倒序', () => {
    const groups = groupRunsByDay(
      [
        summary({ id: 'today-early', at: atLocal(2026, 11, 4, 9) }),
        summary({ id: 'today-late', at: atLocal(2026, 11, 4, 15) }),
        summary({ id: 'yesterday', at: atLocal(2026, 11, 3, 11) }),
      ],
      now,
    );
    expect(groups.map((g) => g.label)).toEqual(['今天 · 11-04', '昨天 · 11-03']);
    expect(groups[0].runs.map((r) => r.id)).toEqual(['today-late', 'today-early']);
  });

  it('同年更早 → MM-DD 周X;跨年 → YYYY-MM-DD 周X', () => {
    const groups = groupRunsByDay(
      [
        summary({ id: 'older', at: atLocal(2026, 10, 21, 11) }),
        summary({ id: 'last-year', at: atLocal(2025, 12, 31, 11) }),
      ],
      now,
    );
    expect(groups[0].label).toBe('10-21 周三');
    expect(groups[1].label).toBe('2025-12-31 周三');
  });

  it('空列表 → [];非法时间戳不丢条目(退化到前 10 位日期键)', () => {
    expect(groupRunsByDay([], now)).toEqual([]);
    const groups = groupRunsByDay([summary({ id: 'broken', at: 'not-a-date' })], now);
    expect(groups).toHaveLength(1);
    expect(groups[0].runs[0].id).toBe('broken');
  });

  it('组间按日期倒序(与输入顺序无关)', () => {
    const groups = groupRunsByDay(
      [
        summary({ id: 'd1', at: atLocal(2026, 11, 1, 9) }),
        summary({ id: 'd3', at: atLocal(2026, 11, 3, 9) }),
        summary({ id: 'd2', at: atLocal(2026, 11, 2, 9) }),
      ],
      now,
    );
    expect(groups.map((g) => g.key)).toEqual(['2026-11-03', '2026-11-02', '2026-11-01']);
  });
});
