// 「决策价位」抽取 —— 把自由格式的《最终结论》(投资经理 LLM 输出)里散落在
// 正文与表格中的价位抽成结构化列表,供「决策价位」Tab 画在价格轴上。
//
// 为什么是这个形状(2026-11-22 用户需求:把最终报告里那些数字做成易读的图):
// - 报告是**自由 markdown**,没有 schema。改提示词让它吐 JSON 会撞
//   test/agents-prompt-golden.test.ts 的逐字节提示词钉死,历史归档里的旧报告
//   也拿不到结构化字段 —— 只能事后解析,必须容错。
// - 解析策略刻意保守:**只认「关键词之后的那串数字」**。关键词确认语义(买入/
//   目标/止损),其后的数字才是价位;PB 0.915、ROE 13.49%、量 1,260,378.40
//   lots 这些落在关键词之外或单位/区间过滤里。**宁可少抽,不可抽错** —— 抽错的
//   价位画在图上会直接误导交易。
// - 只解析**结构化行**(表格 / 列表项 / 标题),直接跳过散文段落:真实报告里
//   「一句话结论」这种长句会把一整句的杂数字贡献成价位(2026-11-22 实测)。
// - 跳过含「空头/做空/看空」的行:空方方案是本报告要否决的对象,不是本报告的
//   执行价位(实测会把空头自己 0.84 ATR 的止损当成自家止损)。
//
// 纯函数、零 IO、零 RN 依赖(架构断言 #1/#2),可在 vitest 里直接钉死行为。
import { warn } from './log.ts';

/** 价位语义:买(建仓/加仓)、卖(目标/减仓)、防守(止损/支撑)。 */
export type LevelKind = 'entry' | 'target' | 'stop';

export interface PriceLevel {
  price: number;
  kind: LevelKind;
  /** 命中该数字的原文片段(≤48 字)——界面上可回溯核对,不接受"凭空来的数"。 */
  source: string;
}

export interface DecisionLevels {
  /** 报告里「方向：…」那一行的首个分句(≤24 字);没有该行 → null。 */
  direction: string | null;
  /** 「整体信心度：65%」→ 65;没有该表述 → null。 */
  confidence: number | null;
  entry: PriceLevel[];
  target: PriceLevel[];
  stop: PriceLevel[];
}

/** 关键词 → 语义。刻意不收「减持/回补/兑现/减半」:这些词在真实报告里出现在
 *  结论长句与仓位百分比旁,会把一整句的杂数字吞进价位列表(见文件头)。 */
const KEYWORDS: ReadonlyArray<readonly [LevelKind, readonly string[]]> = [
  ['entry', ['买入带', '买入区', '买入', '建仓', '加仓', '买点', '进场', '入场', '承接']],
  ['target', ['目标', '止盈', '减仓', '卖出', '平仓', '压力', '阻力']],
  ['stop', ['止损', '防守', '支撑', '跌破', '破位']],
];

/** 含这些词的整行跳过:空方/反方方案不属于本报告的执行价位。 */
const SKIP_LINE_WORDS = ['空头', '做空', '看空'];

/** 列表项(含编号项与要点项)标记 —— 只有这类行与表格/标题参与解析。 */
const LIST_RE = /^\s*(?:[-*+]|\d+[.)])\s/;

/** 列表项/标题里,关键词之后取多长的窗口(字)。列表行常在一行里挂多个价位,
 *  窗口太短会漏(「止损 42.64」),太长会吞到下一句(实测 32 字够用)。 */
const WINDOW_CHARS = 32;

/** 判定「这个数不是价位」的单位后缀(紧邻 ≤3 字内出现即丢弃)。
 *  元/元每股是货币,**不在**丢弃表内。 */
const NON_PRICE_SUFFIXES = ['%', '％', '倍', '手', '股', 'lots', 'lot', '亿', '万', 'pct', 'bp', '天', '日', '月', '年', '档', '成', '个', '条', '项'];

/** 百分比邻近判定半径:落在 ±N 字内的数字一律不当价位。
 *  拦的是「仅留 20–30% 底仓」这种仓位百分比 —— 20/30 的量级与价位区间重合
 *  (现价 42.88 时 30 是"合法"价位),只能靠 % 邻近性剔除。 */
const PERCENT_RADIUS = 6;

/** 每个语义最多保留几条(界面可读性上限;截断规则见 capPerKind)。 */
const MAX_PER_KIND = 5;

/** 价位与现价的方向约束:目标在现价**上方**、防守在现价**下方**。
 *  语义上就是如此(「目标」= 上涨目标、「止损/防守」= 下方防线);不加这条
 *  实测会把报告里的"悲观下行锚 36–38"排到目标列表里,把真正的减仓区 49.5
 *  挤出 5 条上限(2026-11-22 实测 600036 报告)。买入带不做约束:追单触发价
 *  本来就在现价上方。 */
const SIDE: Record<LevelKind, 'up' | 'down' | 'both'> = { entry: 'both', target: 'up', stop: 'down' };

/** 现价倍数下/上界:低于 0.5x 或高于 1.6x 现价的数字不可能是本次策略价位
 *  (真实报告里最远的锚是 -16% 的 36.0;留到 0.5x 只为宽容极端下跌锚)。 */
const MIN_RATIO = 0.5;
const MAX_RATIO = 1.6;

/** 与现价相差 ≤0.1% 的数不算价位:报告里大量出现「现价 42.88」这种引用,
 *  它会被关键词窗口扫到,但现价本身不是买点也不是目标。 */
const CURRENT_EPS = 0.001;

const NUMBER_RE = /\d+(?:\.\d+)?/g;

interface KeywordHit { start: number; end: number; kind: LevelKind }

/** 一段文本里所有关键词命中,按位置升序(同位置 → 长词优先,「买入带」先于「买入」)。 */
function keywordHits(text: string): KeywordHit[] {
  const hits: KeywordHit[] = [];
  for (const [kind, words] of KEYWORDS) {
    for (const word of words) {
      let at = text.indexOf(word);
      while (at >= 0) {
        hits.push({ start: at, end: at + word.length, kind });
        at = text.indexOf(word, at + word.length);
      }
    }
  }
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  return hits;
}

/** 片段内的可用数字:排除千分位分组、单位后缀、百分比邻近。 */
function numbersOf(segment: string): number[] {
  const out: number[] = [];
  NUMBER_RE.lastIndex = 0;
  let m = NUMBER_RE.exec(segment);
  while (m) {
    const raw = m[0];
    const at = m.index;
    // 千分位:1,260,378.40 会被正则切成 1 / 260 / 378.40,靠逗号相邻判掉
    const before = at > 0 ? segment[at - 1] : '';
    const after = segment[at + raw.length] ?? '';
    const grouped = before === ',' || (after === ',' && /\d/.test(segment[at + raw.length + 1] ?? ''));
    const tail = segment.slice(at + raw.length, at + raw.length + 3);
    const unit = NON_PRICE_SUFFIXES.some((s) => tail.startsWith(s));
    const near = segment.slice(Math.max(0, at - PERCENT_RADIUS), at + raw.length + PERCENT_RADIUS);
    const percent = near.includes('%') || near.includes('％');
    const value = Number(raw);
    if (!grouped && !unit && !percent && Number.isFinite(value) && value > 0) out.push(value);
    m = NUMBER_RE.exec(segment);
  }
  return out;
}

/** 原文片段:压掉 markdown 记号,过长截断(界面上一行显示)。 */
function snippetOf(line: string): string {
  const clean = line.replace(/[|*_`>#]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean.length <= 48 ? clean : `${clean.slice(0, 47)}…`;
}

/** 表格行 → 每个关键词的候选数字:关键词所在单元格的后半段 + 紧邻的下一个
 *  单元格。只取下一格(不是其后所有格子):真实报告的「维度|决策|依据」三列
 *  里,依据列是论证不是价位,吞进来全是噪声。 */
function fromTableRow(line: string): Array<{ kind: LevelKind; values: number[] }> {
  const cells = line.split('|');
  const out: Array<{ kind: LevelKind; values: number[] }> = [];
  for (let i = 1; i < cells.length; i++) {
    for (const hit of keywordHits(cells[i])) {
      const own = numbersOf(cells[i].slice(hit.end));
      // 下一格整格取;末格没有下一格 → 只取本格后半段
      const next = i + 1 < cells.length ? numbersOf(cells[i + 1]) : [];
      out.push({ kind: hit.kind, values: [...own, ...next] });
    }
  }
  return out;
}

/** 列表项/标题行 → 关键词之后的定长窗口。 */
function fromInlineLine(line: string): Array<{ kind: LevelKind; values: number[] }> {
  return keywordHits(line).map((hit) => ({
    kind: hit.kind,
    values: numbersOf(line.slice(hit.end, hit.end + WINDOW_CHARS)),
  }));
}

/** 现价过滤 + 现价排除 + 去重 + 按「离现价近」截断后升序返回。 */
function capPerKind(levels: PriceLevel[], current: number): PriceLevel[] {
  const seen = new Set<string>();
  const kept: PriceLevel[] = [];
  for (const lv of levels) {
    const ratio = lv.price / current;
    if (!(ratio >= MIN_RATIO && ratio <= MAX_RATIO)) continue;
    const side = SIDE[lv.kind];
    if (side === 'up' && lv.price <= current) continue;
    if (side === 'down' && lv.price >= current) continue;
    if (Math.abs(lv.price - current) / current <= CURRENT_EPS) continue;
    const key = `${lv.kind}:${lv.price.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(lv);
  }
  // 离现价越近越先执行(买点/止损/目标都是先到先动);同距 → 低者优先
  kept.sort((a, b) => Math.abs(a.price - current) - Math.abs(b.price - current) || a.price - b.price);
  return kept.slice(0, MAX_PER_KIND).sort((a, b) => a.price - b.price);
}

/** 抽方向行:「### 方向：**不做空；以…**」→ '不做空'(首个分句,≤24 字)。 */
function directionOf(text: string): string | null {
  for (const line of text.split('\n')) {
    const m = /方向\s*[：:]\s*(.+)/.exec(line);
    if (!m) continue;
    const raw = m[1].replace(/[*_`]/g, '').trim();
    // 只取第一个分句:方向行常把「立场 + 执行细则」写在一句里,chip 放不下
    const head = raw.split(/[；;。]/)[0].trim();
    if (!head) continue;
    return head.length <= 24 ? head : `${head.slice(0, 23)}…`;
  }
  return null;
}

/** 抽信心度:「策略整体信心度：65%」→ 65;越界/缺省 → null。 */
function confidenceOf(text: string): number | null {
  const m = /信心(?:度)?[^\d%％\n]{0,12}(\d{1,3})\s*[%％]/.exec(text);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) && v >= 0 && v <= 100 ? v : null;
}

/** 该行是否参与解析:表格行 / 列表项 / 标题;散文段落一律跳过。 */
function lineMode(line: string): 'table' | 'inline' | null {
  const t = line.trim();
  if (!t) return null;
  if (t.startsWith('|')) return 'table';
  if (t.startsWith('#') || LIST_RE.test(line)) return 'inline';
  return null;
}

/**
 * 从《最终结论》原文抽出决策价位。
 *
 * @param text        最终结论 markdown(投资经理节点输出;历史归档同一字段)
 * @param currentPrice 现价(store 快照/日K末根收盘)。非有限正数时只回方向与
 *   信心度、价位全空 —— 没有基准就无从判断哪个数像价位,宁可空也不瞎猜。
 */
export function extractLevels(text: string, currentPrice: number): DecisionLevels {
  const body = (text ?? '').trim();
  const summary: DecisionLevels = {
    direction: body ? directionOf(body) : null,
    confidence: body ? confidenceOf(body) : null,
    entry: [], target: [], stop: [],
  };
  if (!body) return summary;
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return summary;

  const bucketOf: Record<LevelKind, PriceLevel[]> = { entry: [], target: [], stop: [] };
  for (const line of body.split('\n')) {
    const mode = lineMode(line);
    if (!mode) continue;
    if (SKIP_LINE_WORDS.some((w) => line.includes(w))) continue;
    const source = snippetOf(line);
    const groups = mode === 'table' ? fromTableRow(line) : fromInlineLine(line);
    for (const g of groups) {
      for (const price of g.values) bucketOf[g.kind].push({ price, kind: g.kind, source });
    }
  }

  const result: DecisionLevels = {
    direction: summary.direction,
    confidence: summary.confidence,
    entry: capPerKind(bucketOf.entry, currentPrice),
    target: capPerKind(bucketOf.target, currentPrice),
    stop: capPerKind(bucketOf.stop, currentPrice),
  };
  // 未抽到价位本身不是错误(演示占位报告、未跑完的分析都属正常态),但报告里
  // 有「目标/止损」字样却一个数都没落到区间内 = 解析规则与报告写法脱节,值得留痕。
  const hasKeyword = KEYWORDS.some(([, words]) => words.some((w) => body.includes(w)));
  if (hasKeyword && !result.entry.length && !result.target.length && !result.stop.length) {
    warn(`[levels] 报告含价位关键词但未抽到价位(现价 ${currentPrice})`);
  }
  return result;
}

/** 价位相对现价的百分比(带符号,保留小数由调用方定);现价非法 → NaN。 */
export function levelDeltaPct(price: number, currentPrice: number): number {
  if (!Number.isFinite(price) || !Number.isFinite(currentPrice) || currentPrice <= 0) return NaN;
  return ((price - currentPrice) / currentPrice) * 100;
}
