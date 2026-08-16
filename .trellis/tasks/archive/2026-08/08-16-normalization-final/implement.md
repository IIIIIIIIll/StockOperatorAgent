# 实施计划:归一化收尾(父)

## 执行顺序

1. **派发 3 个并行 trellis-implement**(一个 batch):desktop-node-backend / config-injection / convention-enforcement。各自读父 design.md(契约)+ 子 prd;skip 验证/commit。
2. **父统一验证**(design.md 验证矩阵):
   - vitest(含新增 5 组测试)
   - app tsc + 根 tsc(3 基线)
   - `node --experimental-transform-types tools/desktop-probe.mts`(Node 桌面路径实证)
   - web 冒烟(demo/恢复/拦截)
   - 模拟器重启恢复冒烟
3. **真实分析**:config-injection 改了委员会/开关装配面——端到端确认成本高(约 20 分钟+token)。默认:以 vitest 默认等价断言 + web 冒烟 + 模拟器恢复冒烟为回归门;**真实分析列为用户可选项**(批准后执行;不做则 AC7 明示范围)。
4. **提交**:单整合 commit(跨子文件交织,边界提交不现实)+ 任务树归档。

## 验证命令

```bash
npx vitest run
cd app && npx tsc --noEmit
cd .. && npx tsc --noEmit          # 3 基线
node --experimental-transform-types tools/desktop-probe.mts
# 冒烟:web 浏览器 + adb 模拟器(恢复路径)
```

## 回滚点

- 每子独立 commit;config-injection 是最大回滚点(revert 即恢复 process.env 通道)。
- store let 改动小,revert 低风险。

## 提交前检查

- [ ] 3 子完成,契约核对无越界
- [ ] 验证矩阵全绿(真实分析项按用户选择)
- [ ] process.env 零写入实证(grep)
- [ ] architecture 断言全绿
- [ ] spec 更新(switches/config/store 注入约定)+ 提交 + 归档
