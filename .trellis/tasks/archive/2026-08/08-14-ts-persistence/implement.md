# Implement：TS 本地数据持久化

## 执行顺序

1. **IdbStore（store-idb.ts）**：内存镜像 + 写穿透队列（设计 §7 决策 C）；语义对齐 InMemoryStore（addDatas 去重/replaceDatas 空早退/getDatas 新数组/meta）
2. **FileStore（store-file.ts）**：RN expo-file-system，baseDir 注入 + 内存缓存双写；单测用 os.tmpdir
3. **接线**：runner.ts store 工厂按 Platform 选择；App.tsx 启动链 await store.ready()；loadDemoData 空库才载入
4. **测试**：fake-indexeddb 单测 IdbStore；FileStore 临时目录单测；store-gates 扩展跨会话判定
5. **验证**：vitest + tsc + 浏览器实测（采集→刷新→数据保留 + 同日跳过日志）

## 验证命令

```bash
cd ts && npx vitest run && npx tsc --noEmit
# 浏览器实测：expo web 起 server → 采集 600036 → 刷新页面 → 确认数据保留 + 日志「跳过采集」
```

## 风险

- RN 端无模拟器不可真机实测——FileStore 以单测 + 类型检查覆盖，报告注明待真机验证
- IDB 写穿透崩溃丢最近写入（可接受：采集即落盘）
- fake-indexeddb 需加入 ts/devDependencies

## start 前 follow-up

- [ ] prd/design/implement 齐备
- [ ] implement.jsonl/check.jsonl 有真实条目
- [ ] 用户批准最终规划总结
