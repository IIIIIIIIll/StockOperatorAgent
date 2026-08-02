# Implement：F10 季度数据修复

## 执行顺序

### 1. 新解析器 `data_source/chinese_mainland/tdx/f10_parser.py`

- `parse_finance_indicators_all_tables(text) -> pd.DataFrame`
  （列：metric/period/value_raw/value_num，纯函数）。
- 自实现 cell 切分（U+FF5C 全角竖线）、日期正则、`亿/万` 归一、
  NaN 映射——不 import vendor 内部函数。
- 多日期头行处理：首个设 periods，后续子表并入（关键：不 break）。
- 去重：dict 以 (metric, period) 为键（后写覆盖）。

### 2. `tdx_source.py` 加 `fetch_company_finance_raw`

- 读 `parquet_root/company_info_raw/ts_code=<TS>/data.parquet` 的
  `text` 列；缺/坏 → None 不 raise。
- ts_code 映射：复用 vendor `market_code_to_ts_code`（局部 import，
  与既有 vendor 封装同模式）。

### 3. `reports.build_reports` 改造

- 首选 raw 路径（含季度）→ 失败/缺失回退 vendor 路径（现状）。
- `compose_reports` 零改动。

### 4. 测试

- 新文件 `test/data_source/test_f10_parser.py`（纯函数离线：
  合成文本表 1 只/表 1+表 2/单位/NaN/无节）+ 真实 raw 文本切片
  （000001）9 期断言。
- `test_tdx_reports.py`：`compose_reports` 含季度输入 → QoQ 断言
  （2025 Q2 vs Q1 环比、跨年边界 2024-12-31→2025-03-31）；既有
  用例因真实缓存 9 期变化 → 更新 golden。
- `build_reports` 回退路径：monkeypatch `fetch_company_finance_raw`
  返回 None → 走 vendor df。

### 5. 重灌脚本 `scripts/backfill_f10_quarters.py`

- 遍历 `company_info_raw/*/data.parquet` → `build_reports` → 批量
  写 ZODB（add_performance_reports 去重 + put_stock + commit）。
- 支持 `--ticker` 单只；默认全量。
- 脚本测试：对 000001 重灌 → ZODB 出现 20250331/20250630/20250930；
  幂等重跑。

### 6. 验证与收尾

- 全量回归（注意：**先确认无 streamlit run 在跑**——flock 互斥，
  testing spec 环境互斥段）。
- vendor 子树零改动确认：`git diff --stat data_source/chinese_mainland/tdx/vendor` 为空。
- spec 更新：data_source/index.md（F10 两张子表契约 + 非 vendor
  解析器 + build_reports 双路径）+ VENDOR.md 不动。
- journal + commit + 归档。

## 验证命令

```bash
python -m pytest test/data_source/test_f10_parser.py test/data_source/test_tdx_reports.py -v
python -m pytest test/core/data_acquisition/ -v  # build_reports 消费者回归
python -m scripts/backfill_f10_quarters.py --ticker 000001  # 重灌单只
python -m pytest  # 全量（确认无 app 在跑）
git diff --stat data_source/chinese_mainland/tdx/vendor  # 空
```

## 评审门

- [ ] 新解析器 9 期断言绿（真实文本）
- [ ] QoQ 含季度正确（含跨年边界）
- [ ] 回退路径测试绿
- [ ] 000001 重灌后 ZODB 9 期
- [ ] vendor 零改动
- [ ] 全量 0F/169P/20S（基线）+新用例

## 回滚点

- 每步独立提交；vendor 未动 → 出问题直接 revert 非 vendor 文件即可。
