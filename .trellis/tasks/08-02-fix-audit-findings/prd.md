# 修复代码库审计发现的问题（27 项）

## Goal

修复 2026-08-02 双代理审计发现的全部问题（3 高危 + 10 中危 + 14 低危），
按领域拆 4 个子任务独立实现与验收，父任务负责最终全量回归与集成审查。
修复后全量 pytest 保持 **0 failed / 67 passed / 20 skipped**，无行为回退。

## 子任务地图（依赖关系）

```
fix-data-correctness  ← 先建 utils 时区工具（Asia/Shanghai）
    ↓ 时区工具被 fix-tdx-correctness 复用
fix-tdx-correctness   （不依赖其他子任务的产出，可并行；时区工具若已合入则复用）
fix-env-robustness    （独立，路径锚定）
fix-dead-code-cleanup （独立，但 formatter NaN 渲染归 fix-tdx-correctness，勿重复）
```

- **执行顺序**：fix-data-correctness → fix-tdx-correctness → fix-env-robustness →
  fix-dead-code-cleanup（按优先级；环境稳健与死代码清理可穿插）
- 时区工具函数由 fix-data-correctness 产出（`utils/time_helper` 新增
  `asia_today()`/统一交易日日期），fix-tdx-correctness 直接复用，不重复实现

## 跨子任务验收（父任务级）

- [ ] 4 个子任务全部归档后，全量 `python3 -m pytest -q` **0 failed**
      （67 passed / 20 skipped 保持），2.5-3.5 分钟内完成
- [ ] 无新 spec 矛盾：architecture.md 的 key 检查断言与实现一致、data_source
      spec 的列序疑点更新为实测结论、TDX 派生契约修正同步
- [ ] deprecated 测试（akshare/qwen/DeepSeek live）零改动
- [ ] 冒烟：`get_stock_data('000001')` 纯 TDX 全链路正常（overview+历史+业绩）
- [ ] 审计清单逐项核对：27 项全部有处理结论（修复或标注"保留+理由"）

## Constraints（全局）

- 主流程纯 TDX 语义不变；akshare 备用路径修复不得影响主流程
- 位置构造规则：yjbb_em 业绩路径**授权例外**（按列名映射 + 列名断言），
  其余位置构造保持
- 新增工具函数进 `utils/`（time_helper），不重复实现
- 每项修复必须有对应测试（新增或扩展既有），不修无测
