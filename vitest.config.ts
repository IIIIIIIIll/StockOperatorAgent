import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // RN 侧的 hook/组件 import 的是 `app/node_modules/react`，而 react-test-renderer
  // （hook 直测用）装在根 —— 两份 React 副本让 hook 直测一律报 "Invalid hook call"
  // （2026-11-21）。两边统一解析到**根**那一份（react-test-renderer 自己也是从根
  // 解析 react 的，指到根才是真正的单实例；指到 app 那份无效）。
  // src/ 不 import react，服务端套件不受影响。
  resolve: {
    alias: {
      react: fileURLToPath(new URL('./node_modules/react', import.meta.url)),
      // RN 专属模块在 Node/vitest 下不可解析(Flow 源码/native 模块)。
      // app/ 下的 hook 直测只需要 AppState 这一小块 —— 用最小替身替换,
      // 见 test/fixtures/react-native-stub.ts 里的来由说明。
      'react-native': fileURLToPath(new URL('./test/fixtures/react-native-stub.ts', import.meta.url)),
      'react-native-webview': fileURLToPath(
        new URL('./test/fixtures/react-native-webview-stub.ts', import.meta.url),
      ),
    },
  },
  test: {
    // React 19 act() 需要全局标记，否则 hook 直测每个用例都告警且更新不同步
    setupFiles: ['./test/setup/react-act-env.ts'],
    // 让 Vite 处理 react-test-renderer（否则它从自身 node_modules 解析 react，
    // 上面的 alias 不生效，依旧是两份副本 → Invalid hook call）。
    server: { deps: { inline: ['react-test-renderer', 'react'] } },
    // 默认 5s 对 mock-LLM 编排套件(committee/events 全图流式)余量不足:
    // 高负载下批量假超时(2026-08-22 实证 6 agent 并行跑 → 9 例 final_decision
    // '' 形态失败,串行全绿)。上调只放宽挂死判定上限,不改变任何断言语义。
    testTimeout: 15_000,
    // 覆盖率门（评审 2026-11-21 第 5 项）：本仓此前**没有**任何覆盖率门，于是
    // 「整模块零测试」可以无声无息地长期存在（app/hooks/*、analysisState 等）。
    // 基线来自 2026-11-21 实测（statements 87.21 / branches 80.2 / functions 90.12
    // / lines 89.33），阈值取略低一档作为**防回退**下限，不做硬指标。
    // 注意 all:false（默认）：**从未被 import 的文件不计入**——所以门只能防「已
    // 覆盖区域退化」，防不了「新模块没人测」。新模块请自己补测试。
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'text'],
      thresholds: {
        statements: 85,
        branches: 78,
        functions: 87,
        lines: 87,
      },
    },
  },
});
