// 上次分析结果缓存 —— done 事件结果持久化到 store meta KV,App 启动时恢复展示。
// 纯函数,只依赖 StoreLike + FinalReport 类型,不依赖 UI/平台;四平台(web/RN/Node/内存)共用。
// 键名 `soa:last-run` 对齐现有 `soa:llm-config` 前缀惯例。
import type { FinalReport, Opinion } from './events.ts';
import type { StoreLike } from './store.ts';

/** store meta 键:最近一次成功分析结果。 */
export const LAST_RUN_KEY = 'soa:last-run';

/** 缓存记录:完整结果 + 完成时间(ISO) + 运行模式。 */
export interface LastRunRecord {
  ticker: string;
  stock_information: string;
  final_decision: string;
  opinions: Opinion[];
  at: string; // ISO 完成时间
  mode: 'real' | 'demo';
}

/** 成功分析(done)后写入缓存;分析失败不写 → 旧缓存保留(R4)。 */
export function saveLastRun(
  store: StoreLike,
  report: FinalReport,
  mode: 'real' | 'demo',
  at: string,
): void {
  const record: LastRunRecord = {
    ticker: report.ticker,
    stock_information: report.stock_information,
    final_decision: report.final_decision,
    opinions: report.opinions,
    at,
    mode,
  };
  store.setMeta(LAST_RUN_KEY, JSON.stringify(record));
}

/** 读缓存;缺失键 / JSON 损坏 / 字段校验不过 → null,不抛异常(R6 静默降级)。 */
export function loadLastRun(store: StoreLike): LastRunRecord | null {
  const raw = store.getMeta(LAST_RUN_KEY);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const rec = parsed as Record<string, unknown>;
  if (typeof rec.ticker !== 'string') return null;
  if (typeof rec.stock_information !== 'string') return null;
  if (typeof rec.final_decision !== 'string') return null;
  if (!Array.isArray(rec.opinions)) return null;
  if (typeof rec.at !== 'string') return null;
  if (rec.mode !== 'real' && rec.mode !== 'demo') return null;
  return {
    ticker: rec.ticker,
    stock_information: rec.stock_information,
    final_decision: rec.final_decision,
    opinions: rec.opinions as Opinion[],
    at: rec.at,
    mode: rec.mode,
  };
}
