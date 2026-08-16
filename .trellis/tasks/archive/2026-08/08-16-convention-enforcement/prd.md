# convention-enforcement:架构静态断言测试

## Target
新 `test/architecture.test.ts`(读源码文本断言,零新依赖)。

## Change
按父 design.md 契约 3 的 7 条断言:src 无 node:(store-node 白名单)/react-native import;better-sqlite3 仅 type(白名单 probe/test);无 declare global DOM 名;meta 键无裸字面量;process.env 零写入 + 读取仅 env.ts(白名单 settings.ts EXPO_PUBLIC);app 无 lib/log 残留。

## Acceptance
- 断言全绿(vitest);误报率低(先跑现状,把当前合法用例写进白名单)
- 断言失败信息可读(指明文件与违规行)
- skip 验证/commit(父统一)
