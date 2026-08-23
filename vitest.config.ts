import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 默认 5s 对 mock-LLM 编排套件(committee/events 全图流式)余量不足:
    // 高负载下批量假超时(2026-08-22 实证 6 agent 并行跑 → 9 例 final_decision
    // '' 形态失败,串行全绿)。上调只放宽挂死判定上限,不改变任何断言语义。
    testTimeout: 15_000,
  },
});
