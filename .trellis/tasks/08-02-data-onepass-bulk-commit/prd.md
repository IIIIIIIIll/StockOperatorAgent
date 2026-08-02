# fix(data): 数据链路单遍拉取 + 批量提交（review #2+#3）

## Goal

review #2: get_stock_data 各源拉一次（daily/capital/F10 复用给 overview+history+reports，纯函数已就绪只缺管道）。#3: ChinaStock 批量 API（add_datas 单 commit）替代逐行 commit——首建全量回填数千事务；需 spec 修订（mutator 单 commit 规则）。

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
