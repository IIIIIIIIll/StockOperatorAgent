// 分析历史归档 —— 纯数据契约(平台无关,不 import 存储/UI/RN)。
// 一次成功分析 = 一条 AnalysisRun(完整正文,含采集数据快照 stock_information);
// 列表只读轻量摘要 RunSummary。按本地日分组(今天/昨天/日期)也在此单点,
// 便于单测与 UI/存储共用同一套标签规则。
//
// 与 src/lastRun.ts 的关系:lastRun 仍只留「最后一次」(启动恢复语义不变),
// 历史是增量留档 —— 两者互不替代(见 PRD R2)。
import type { Opinion } from './events.ts';
import type { Market } from './market.ts';

/** 运行模式:真实 LLM / 演示占位(与 lastRun 同词汇)。 */
export type RunMode = 'real' | 'demo';

const MARKETS: readonly Market[] = ['cn', 'hk', 'us'];
const MODES: readonly RunMode[] = ['real', 'demo'];

/** 一条完整历史记录(存储正文;list 不加载它)。 */
export interface AnalysisRun {
  /** 存储键/RN 文件名安全:ISO 去掉 : 与 . + 随机后缀(同秒多次运行也不撞)。 */
  id: string;
  /** 完成时间 ISO(UTC;展示按本地时区分组)。 */
  at: string;
  mode: RunMode;
  ticker: string;
  /** 运行时的市场(恢复查看时驱动币种/单位与下拉初始值)。 */
  market: Market;
  stock_information: string;
  final_decision: string;
  opinions: Opinion[];
}

/** 列表摘要(索引条目;只含渲染列表所需字段)。 */
export interface RunSummary {
  id: string;
  at: string;
  mode: RunMode;
  ticker: string;
  market: Market;
  /** 最终结论首行(去 Markdown 记号,截断)——列表一行预览。 */
  decisionPreview: string;
}

/** 按本地日期分组的一段(周三/今天等标签见 groupRunsByDay)。 */
export interface RunDayGroup {
  /** 本地日历日 'YYYY-MM-DD'(分组键,不是记录字段)。 */
  key: string;
  label: string;
  runs: RunSummary[];
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;
const PREVIEW_MAX = 80;

/** 生成记录 id:ISO 掐掉 ':' '.'(避免文件名/索引键里的特殊字符)+ 随机后缀。 */
export function newRunId(at: string, salt?: string): string {
  const safeAt = at.replace(/[:.]/g, '-');
  const suffix = salt ?? Math.random().toString(36).slice(2, 8);
  return `${safeAt}-${suffix}`;
}

/** 结论预览:取首个非空行,剥行首 Markdown 记号与强调符,压缩空白后截断。 */
export function decisionPreview(text: string, max = PREVIEW_MAX): string {
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0) ?? '';
  // 行首标题/引用/列表记号(#、>、-、*)+ 行内强调符(**:反引号)——只影响观感
  const plain = line
    .replace(/^[#>\-*\s]+/, '')
    .replace(/\*\*|`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > max ? `${plain.slice(0, max)}…` : plain;
}

/** 完整记录 → 摘要(列表渲染面)。 */
export function toSummary(run: AnalysisRun): RunSummary {
  return {
    id: run.id,
    at: run.at,
    mode: run.mode,
    ticker: run.ticker,
    market: run.market,
    decisionPreview: decisionPreview(run.final_decision),
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isOpinionList(v: unknown): v is Opinion[] {
  return (
    Array.isArray(v) &&
    v.every(
      (o) =>
        isObject(o) &&
        typeof o.key === 'string' &&
        typeof o.tabTitle === 'string' &&
        typeof o.content === 'string',
    )
  );
}

function isMode(v: unknown): v is RunMode {
  return typeof v === 'string' && (MODES as readonly string[]).includes(v);
}

function isMarket(v: unknown): v is Market {
  return typeof v === 'string' && (MARKETS as readonly string[]).includes(v);
}

/** 校验一条完整记录(存储损坏/旧格式 → null,不抛;与 loadLastRun 姿态一致)。 */
export function parseAnalysisRun(value: unknown): AnalysisRun | null {
  if (!isObject(value)) return null;
  if (typeof value.id !== 'string' || value.id.length === 0) return null;
  if (typeof value.at !== 'string' || value.at.length === 0) return null;
  if (!isMode(value.mode)) return null;
  if (typeof value.ticker !== 'string' || value.ticker.length === 0) return null;
  if (!isMarket(value.market)) return null;
  if (typeof value.stock_information !== 'string') return null;
  if (typeof value.final_decision !== 'string') return null;
  if (!isOpinionList(value.opinions)) return null;
  return {
    id: value.id,
    at: value.at,
    mode: value.mode,
    ticker: value.ticker,
    market: value.market,
    stock_information: value.stock_information,
    final_decision: value.final_decision,
    opinions: value.opinions,
  };
}

/** 校验一条摘要(id/at/mode/ticker/market 必需;preview 缺失按空串补齐)。 */
export function parseRunSummary(value: unknown): RunSummary | null {
  if (!isObject(value)) return null;
  if (typeof value.id !== 'string' || value.id.length === 0) return null;
  if (typeof value.at !== 'string' || value.at.length === 0) return null;
  if (!isMode(value.mode)) return null;
  if (typeof value.ticker !== 'string' || value.ticker.length === 0) return null;
  if (!isMarket(value.market)) return null;
  if (typeof value.decisionPreview !== 'string') return null;
  return {
    id: value.id,
    at: value.at,
    mode: value.mode,
    ticker: value.ticker,
    market: value.market,
    decisionPreview: value.decisionPreview,
  };
}

/** 解析摘要数组(损坏条目逐条跳过;整体非数组 → [])。 */
export function parseRunSummaries(value: unknown): RunSummary[] {
  if (!Array.isArray(value)) return [];
  const out: RunSummary[] = [];
  for (const item of value) {
    const s = parseRunSummary(item);
    if (s) out.push(s);
  }
  return sortSummaries(out);
}

/** 时间倒序(同刻按 id 倒序,保证稳定)。ISO 字符串可直接字典序比较。 */
export function sortSummaries(list: readonly RunSummary[]): RunSummary[] {
  return [...list].sort((a, b) => {
    if (a.at !== b.at) return a.at < b.at ? 1 : -1;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 本地时钟 'HH:MM'(历史列表行内)。非法时间戳 → 空串。 */
export function formatRunClock(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 本地日期时间 'MM-DD HH:MM'(顶部「正在查看历史」横幅/跨日引用)。 */
export function formatRunTime(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 本地日历日键 'YYYY-MM-DD'(按设备时区,不用 UTC —— 用户按天回忆)。 */
export function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function dayKeyOfIso(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : localDayKey(d);
}

function dayLabel(key: string, now: Date): string {
  const today = localDayKey(now);
  const yesterdayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const yesterday = localDayKey(yesterdayDate);
  const [y, m, d] = key.split('-');
  const md = `${m}-${d}`;
  if (key === today) return `今天 · ${md}`;
  if (key === yesterday) return `昨天 · ${md}`;
  const sameYear = key.slice(0, 4) === String(now.getFullYear());
  const weekday = WEEKDAYS[new Date(`${key}T00:00:00`).getDay()] ?? '';
  return sameYear ? `${md} ${weekday}` : `${y}-${md} ${weekday}`;
}

/**
 * 按本地日分组(组按日期倒序,组内按时间倒序)。空列表 → []。
 * 非法时间戳的记录归到字符串前 10 位(或 '未知日期'),不丢条目。
 */
export function groupRunsByDay(list: readonly RunSummary[], now: Date = new Date()): RunDayGroup[] {
  const groups = new Map<string, RunSummary[]>();
  for (const run of sortSummaries(list)) {
    const key = dayKeyOfIso(run.at);
    const bucket = groups.get(key);
    if (bucket) bucket.push(run);
    else groups.set(key, [run]);
  }
  return [...groups.entries()]
    .sort((a, b) => (a[0] === b[0] ? 0 : a[0] < b[0] ? 1 : -1))
    .map(([key, runs]) => ({ key, label: dayLabel(key, now), runs }));
}
