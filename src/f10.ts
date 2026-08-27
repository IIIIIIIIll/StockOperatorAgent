// F10「主要财务指标」raw 文本 → tidy long
// 移植自 Python f10_parser.py + M0 发现的双格式兼容（research/m0-d4-f10.md）
// 分隔符：港澳资讯 U+FF5C ｜ / 通达信 U+2502 │（按文本探测）
// 分节名：精确匹配失败 → 模糊含匹配（【1.主要财务指标】带编号）
const PIPE_FF5C = '｜';
const PIPE_2502 = '│';
const DATE_CELL_RE = /\d{4}-\d{2}-\d{2}/;

export interface F10Record {
  metric: string;
  period: string;
  value_raw: string;
  value_num: number; // NaN = 不可解析（JSON 序列化时为 null）
}

export function toNum(s: string): number {
  const t = (s ?? '').trim();
  if (['', '-', '--', '—', 'null', 'NULL'].includes(t)) return NaN;
  let mult = 1;
  if (t.endsWith('亿')) { mult = 1e8; return Number(t.slice(0, -1)) * mult; }
  if (t.endsWith('万')) { mult = 1e4; return Number(t.slice(0, -1)) * mult; }
  const v = Number(t);
  return Number.isNaN(v) ? NaN : v;
}

function detectPipe(text: string): string {
  return text.includes(PIPE_FF5C) ? PIPE_FF5C : PIPE_2502;
}

function splitPipeCells(line: string, pipe: string): string[] {
  const parts = line.split(pipe).map((c) => c.trim());
  if (parts.length && parts[0] === '') parts.shift();
  if (parts.length && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

/** 分节定位：精确匹配 → 模糊含匹配（如 【1.主要财务指标】）。
 *  跳过"★本栏包括【1.…】【2.…】…"列表行——只接受**独立标题行**
 *  （所在行内 【 出现次数 == 1），否则通达信格式会命中列表而非表格。 */
export function locateSection(text: string, sectionName: string): number {
  const core = sectionName.replace(/[【】]/g, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`【[^】]*${core}[^】]*】`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text ?? '')) !== null) {
    const lineStart = (text ?? '').lastIndexOf('\n', m.index) + 1;
    const lineEnd = (text ?? '').indexOf('\n', m.index);
    const line = (text ?? '').slice(lineStart, lineEnd < 0 ? undefined : lineEnd);
    if ((line.match(/【/g) || []).length === 1) return m.index;
  }
  return -1;
}

export function parseSectionBlock(text: string, sectionName: string): F10Record[] {
  const records: Array<{ metric: string; period: string; value_raw: string; value_num: number }> = [];
  const start = locateSection(text ?? '', sectionName);
  if (start < 0) return [];
  const rest = (text ?? '').slice(start);
  const nxt = rest.indexOf('\n【', 1);
  const block = nxt < 0 ? rest : rest.slice(0, nxt);
  const pipe = detectPipe(block);

  let periods: string[] | null = null;
  for (const line of block.split('\n')) {
    if (!line.includes(pipe)) continue;
    const cells = splitPipeCells(line, pipe);
    if (!cells.length) continue;
    const dateCells = cells.filter((c) => DATE_CELL_RE.test(c));
    if (dateCells.length >= 2) { periods = dateCells; continue; }
    if (periods === null || cells.length < 2) continue;
    const metric = cells[0];
    periods.forEach((period, i) => {
      const raw = cells[1 + i] ?? ''; // F27:行短于 period 数时 undefined 不得进 string 字段
      records.push({ metric, period, value_raw: raw, value_num: toNum(raw) });
    });
  }

  // 同 (metric, period) 去重 keep last：与 pandas drop_duplicates(keep='last')
  // 一致——保留每个 key 最后一次出现的那一行，顺序按末次出现位置
  const lastIdx = new Map<string, number>();
  records.forEach((r, i) => lastIdx.set(`${r.metric}\u0000${r.period}`, i));
  return [...lastIdx.values()].sort((a, b) => a - b).map((i) => records[i]);
}

export function parseFinanceIndicatorsAllTables(text: string): F10Record[] {
  return parseSectionBlock(text, '【主要财务指标】');
}

/** 股本结构 → 总/流通股本(股)。F10「股本结构」节,数值单位万股(表头注明)×10⁴;
 *  流通A股缺失 → 实际流通A股回退;无表/无值 → null。 */
export function parseCapitalStructure(
  text: string | null,
): { zongguben: number; liutongguben: number } | null {
  if (!text) return null;
  const records = parseSectionBlock(text, '【股本结构】');
  const latest = (metric: string): number | null => {
    const rows = records.filter((r) => r.metric === metric && !Number.isNaN(r.value_num));
    if (!rows.length) return null;
    const best = rows.reduce((a, b) => (a.period > b.period ? a : b));
    return best.value_num * 10_000;
  };
  const zongguben = latest('总股本');
  const liutongguben = latest('流通A股') ?? latest('实际流通A股');
  if (zongguben === null || liutongguben === null || zongguben <= 0 || liutongguben <= 0) {
    return null;
  }
  return { zongguben, liutongguben };
}

export function parseIndicatorSection(text: string, sectionName: string): F10Record[] {
  return parseSectionBlock(text, sectionName);
}
