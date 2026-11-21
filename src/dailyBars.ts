// 日K 合并 —— 四族 store 的唯一真值源(2026-11 架构整改)。
//
// 整改前这段 9 行逻辑被抄了四份:
//   src/store-memory.ts  (内联在 addDatas)
//   src/store-file.ts    (private mergeBars)
//   src/store-idb.ts     (private mergeBars,返回 updatedStock)
//   src/store.ts         (SQLite:另一份实现,曾因去重基线取 stocks.last_data_update
//                         而分叉,直接造成 F11 —— 重复批次被重写且返回 >0)
//
// 契约(四处必须逐字一致,store-gates.test.ts 钉死):
//   1. 去重基线 = 表内既有**末根日期**(不是 stocks.last_data_update —— 那个戳
//      可被 putStock 覆盖成旧值/置空,采集链常规操作会踩到)。
//   2. 只接受 date > 基线的 bar;空结果 → 调用方不写库、返回 0。
//   3. 结果升序;同日期 keep last。
//   4. lastDataUpdate 只在真有新增时前移到 fresh 末根日期。
//
// 纯模块:零 node:/零 RN 依赖,type-only import 保证 --experimental-strip-types
// 下 child.mjs 也能引(架构断言 1/3 合规)。

import type { DailyBar } from './store.ts';

/** 只保留严格晚于基线日期的 bar。基线 null = 首次入库,全部接受。 */
export function freshDailyBars(lastDate: string | null, incoming: readonly DailyBar[]): DailyBar[] {
  return incoming.filter((b) => lastDate === null || b.date > lastDate);
}

export interface MergeBarsResult {
  /** 合并后的完整升序日K(fresh 为空时原样返回既有数组的浅拷贝)。 */
  merged: DailyBar[];
  /** 本次真正新增的 bar;空数组 = 全部重复,调用方不得写库/前移时间戳。 */
  fresh: DailyBar[];
}

/** 把 incoming 并入 existing。不修改入参。 */
export function mergeDailyBars(existing: readonly DailyBar[], incoming: readonly DailyBar[]): MergeBarsResult {
  // 不变式:existing 恒升序(由本函数自己维护),故末元素即最大日期。
  const baseline = existing.length ? existing[existing.length - 1].date : null;
  const fresh = freshDailyBars(baseline, incoming);
  if (!fresh.length) return { merged: [...existing], fresh: [] };
  const byDate = new Map<string, DailyBar>();
  for (const b of [...existing, ...fresh]) byDate.set(b.date, b); // 同日期 keep last
  const merged = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  return { merged, fresh };
}

/** 按日期并集，**overlay 胜**（P2 评审 2026-11-21）。
 *
 *  与 mergeDailyBars 的区别：后者用「已有集合的末日期」做基线，只收比基线更新的
 *  bar（增量采集语义）；而 hydrate 对账要的是全量并集 —— 磁盘历史 + 内存里「先写
 *  后 ready」的增量/修正，同日期以内存为准（内存那次写比磁盘旧内容新）。
 *  用 mergeDailyBars 会让磁盘末根日期的修正值被基线挡掉。 */
export function unionDailyBars(
  disk: readonly DailyBar[],
  overlay: readonly DailyBar[],
): DailyBar[] {
  const byDate = new Map<string, DailyBar>();
  for (const b of disk) byDate.set(b.date, b);
  for (const b of overlay) byDate.set(b.date, b); // overlay 胜
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
