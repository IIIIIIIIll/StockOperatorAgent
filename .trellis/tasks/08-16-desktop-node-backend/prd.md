# desktop-node-backend:桌面 Node store/设置后端(P3)

## Target
新 `src/store-node.ts`(Node-only,不进 app 图)、`app/lib/runner.ts`(store → export let + setStore())、`app/lib/settingsStore.ts`(node 分支经注入面)、新 `tools/desktop-probe.mts`(接线示范)。

## Change
按父 design.md 契约 1:**node:fs 禁令**(metro 无 fs shim,凡进 app 图的文件禁静态/动态 node:fs;适配器只在 store-node.ts,经注入传入)。setStore 注入点 + ESM live binding;settingsStore node 分支(注入 node fs 适配);desktop-probe 示范 Node 桌面全接线(store 读改写 + 设置读改写)。

## Acceptance
- vitest:store-node round-trip、setStore live binding、settingsStore node 分支单测
- desktop-probe 跑通(父验证)
- skip 验证/commit(父统一)
