// 内存历史归档后端 —— 测试夹具(R-18:原来住在 app/lib/runArchive.ts 里,
// 生产模块不该带测试专用分支;testing.md 把 test-only 分支列为反模式)。
// 契约与 app/lib/runArchive.ts 的 RunArchive 一致;所有读操作返回副本,
// 便于断言「读写不共享可变对象」。
import type { RunArchive } from '../../app/lib/runArchive.ts';
import { sortSummaries, toSummary, type AnalysisRun } from '../../src/runHistory.ts';

export function createMemoryRunArchive(
  seed: readonly AnalysisRun[] = [],
): RunArchive & { size(): number } {
  const runs = new Map<string, AnalysisRun>(seed.map((r) => [r.id, r]));
  return {
    async list() {
      return sortSummaries([...runs.values()].map(toSummary));
    },
    async load(id) {
      const run = runs.get(id) ?? null;
      return run ? { ...run, opinions: run.opinions.map((o) => ({ ...o })) } : null;
    },
    async put(run) {
      runs.set(run.id, run);
    },
    async remove(ids) {
      let n = 0;
      for (const id of ids) if (runs.delete(id)) n += 1;
      return n;
    },
    async clear() {
      runs.clear();
    },
    size() {
      return runs.size;
    },
  };
}
