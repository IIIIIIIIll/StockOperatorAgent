# Design: 数据链路单遍拉取 + 批量提交（review #2+#3）

## 1. 现状与问题

`get_stock_data(ticker)`（core/data_acquisition.py:402）顺序调用三个消费者，
各拉各的源：

```
ensure_stock ────────────► build_overview（snapshot + daily(250) + capital + F10 + name）
acquire_historical_data_tdx ► capital + daily(gap|None) + xdxr → qfq → 逐行 add_data（逐行 commit）
acquire_performance_report_tdx ► F10 → 逐行 add_performance_report（逐行 commit）
```

- 首建（gap > 120）：daily ×2（250 + 全量）、capital ×2、F10 ×2 —— 7 次拉取。
- 常日（两门都 stale，#1 之后每天必现）：daily ×2（250 + gap）、capital ×2、
  F10 ×2 —— 6 次拉取。
- 首建全量回填（max_bars=None）：老股票数千根 bar → add_data 数千次
  FileStorage 事务（tpc + 索引更新 + 每条事务记录）。

## 2. 目标设计

### 2.1 FetchScope（拉取去重，DataAcquisition 内新私有类）

```python
class FetchScope:
    """单次 get_stock_data 调用的拉取去重：每源每 ticker 只拉一次。

    daily 大小感知复用：缓存满足请求（len >= 请求根数）→ 复用；
    否则按本次请求重拉（首建全量请求时缓存必空 → 全量恰拉一次）。
    """
    def __init__(self, src: TdxSource):
        self._src = src
        self._cache: dict[tuple[str, str], pd.DataFrame] = {}

    def fetch_daily(self, ticker, max_bars=None) -> pd.DataFrame:
        key = ("daily", ticker)
        if key in self._failed:
            return pd.DataFrame()
        cached = self._cache.get(key)   # (df, requested_bars)
        if cached is not None:
            df, cached_bars = cached
            if cached_bars is None or (max_bars is not None and cached_bars >= max_bars):
                return df
        ...fetch 并缓存 (df, max_bars)...
```

**实现注记（与初稿差异）**：复用判定按**请求尺寸**（cached_bars）而非实际
行数——max_bars=250 的拉取对短历史股票返回 <250 行（服务器已给全部），
按 len 判定会错误重拉；按请求尺寸判定正确且零额外调用。failed 标记对
daily 同样生效（fetch_daily 顶部短路返回空 DataFrame）。

    def snapshot(self, ticker): ...        # 单消费者，统一走 scope
    def finance_capital(self, ticker): ...  # 复用规则同 daily（无大小概念，直缓存）
    def company_finance(self, ticker): ...
    def xdxr(self, ticker): ...
```

复用判定的正确性论证：
- `max_bars=250` 请求 + 缓存 250 → `len >= 250` → 复用 ✓
- `max_bars=gap`（≤120）请求 + 缓存 250 → `250 >= gap` → 复用 ✓
- `max_bars=None`（全量）请求：缓存必为空（全量请求只出现在首建，此时
  scope 内无 daily 缓存；即便有 250，`max_bars is None` 分支也直接重拉）✓
- 边界：缓存 250 但市场只有 100 根 → `len=100 < 250` → 每次请求都重拉
  （拉回仍 100 根）。无害但多一次调用——可接受（单页成本；且该情形只影响
  新上市股票的常日路径，频次低）。PRD 不承诺处理。

### 2.2 预播种（协调器决策，get_stock_data）

门判定提取为三个私有 helper（消费者方法同步改用，单点来源）：

```python
def _overview_stale(self, stock) -> bool:
    return stock.overview_last_update.date() < get_last_business_day(asia_today())

def _history_gap(self, stock) -> int:      # 0 = fresh
    last_bd = get_last_business_day(asia_today())
    return max((last_bd - stock.last_data_update).days, 0)

def _reports_stale(self, stock) -> bool:
    q = self._latest_past_quarter_end(asia_today())
    return not (stock.performance_reports and stock.performance_reports[-1].report_date == q)
```

`get_stock_data` 流程：

```python
def get_stock_data(self, ticker, _scope=None):
    scope = _scope or FetchScope(TdxSource())
    if not self.ensure_stock(ticker, _scope=scope):
        return None
    stock = self.storage.get_stock(ticker)
    # 预播种：daily 一次拉取，尺寸覆盖所有消费者
    gap = self._history_gap(stock)
    if self._overview_stale(stock) or gap > 0:
        scope.daily(ticker, max_bars=None if gap > 120 else max(250, gap))
    self.acquire_historical_data_tdx(ticker, _scope=scope)
    self.acquire_performance_report_tdx(ticker, _scope=scope)
    return self.storage.get_stock(ticker)
```

预播种尺寸论证：
- gap > 120（首建/大缺口）→ None：全量一次覆盖 history + overview 250 窗口
- gap ∈ (0, 120] → max(250, gap) = 250：覆盖 history gap + overview 250
- gap = 0 且 overview stale → 250（仅 overview 用）
- 两门都 fresh → 不拉 daily（保持 #1 前的零拉取行为）

消费者内的门判定保留（防 scope 外的独立调用路径），与预播种共用 helper。
预播种后消费者请求必命中缓存（same-size 或 superset）。

### 2.3 消费者签名（默认 None = 现状直拉）

- `ensure_stock(ticker, _build_overview=None, _scope=None)`：`_scope` 给出时
  build_overview 请求走 `_scope.daily(...)` 等；`_build_overview`（#1 注入点）
  优先级最高（测试注入完整替换）。
- `overview.build_overview(ticker, _scope=None)` /
  `reports.build_reports(ticker, _scope=None)`：内部 TdxSource 拉取全部改走
  `_scope or 新 TdxSource()` 的对应方法。纯函数 `compose_overview` /
  `compose_reports` 不动。
- `acquire_historical_data_tdx(ticker, _scope=None)`：capital/daily/xdxr 走
  scope；qfq 与构造逻辑不变；末尾改批量提交（见 2.4）。
- `acquire_performance_report_tdx(ticker, _fetch_reports=None, _scope=None)`：
  F10 走 scope（`_fetch_reports` 注入点语义保留：测试传则完全替换）。

### 2.4 批量 mutator（ChinaStock）

```python
def add_datas(self, datas: list[ChinaStockData]) -> int:
    """批量追加（review #3）：date > last_data_update 的行全量追加，单次 commit。
    返回实际追加数；0 = 全部重复（不 commit）。输入须 date 升序（数据链路保证）。"""
    fresh = [d for d in datas if d.date > self.last_data_update]
    if not fresh:
        logger.debug(...)
        return 0
    self.datas.extend(fresh)
    self.last_data_update = fresh[-1].date
    transaction.commit()
    return len(fresh)

def add_performance_reports(self, reports: list[StockPerformanceReport]) -> int:
    """批量追加：report_date 递增去重（仅 > 最后一份者），单次 commit。输入升序。"""
    fresh = [r for r in reports
             if not self.performance_reports
             or r.report_date > self.performance_reports[-1].report_date]
    if not fresh:
        return 0
    self.performance_reports.extend(fresh)
    transaction.commit()
    return len(fresh)
```

- 单行版 `add_data` / `add_performance_report` 保留并委托批量版（行为逐行
  等价：单行列表 → 同去重 → 0 或 1 commit）。
- 消费者：`acquire_historical_data_tdx` 先 `rows = [...]` 收集再
  `stock.add_datas(rows)`；`acquire_performance_report_tdx` 同款。put_stock
  的 commit 仍在（spec：get → mutate → put → commit 模式的既有语义）。
- 事务数：首建 = 1（批量）+ 1（put_stock，若对象已被 add_datas 修改仍需
  put 持久化引用——现状如此，不变）。

### 2.5 边界与兼容

- **独立调用不变**：三个消费者无 `_scope` 时走直拉（现有 18 个
  test_data_acquisition_tdx 用例 + #1 的 3 个 gate 用例全绿即验证）。
- **错误降级不变**：capital/xdxr 失败 → 换手率 NaN / 未复权（scope 内抛
  异常同样被消费者 catch；scope 不吞异常——缓存只存成功结果，失败不缓存，
  下次请求重试）。
- **daily 失败**：`acquire_historical_data_tdx` 的 catch 位置不变（scope
  fetch 抛 ValueError/ConnectionError → 消费者 catch → False）。
- 预播种的 daily 拉取失败：抛到 get_stock_data —— 首建时 history 失败语义
  现为"不阻断"（返回已构建 stock）。预播种后失败会提前到 overview 刷新前
  抛。**决策**：预播种包 try/except → 失败记 warning + scope 标记该源
  failed（后续消费者请求直接返回 None，各自降级路径接管）→ 保首建不阻断
  语义。FetchScope 增加 `_failed: set`，failed 源请求直接返回空 DataFrame
  （与 _fetch_degraded 的 None 语义对齐：消费者按空/None 降级）。
  此点实现时验证 test_get_stock_data_pure_tdx_full_chain 的既有断言。

## 3. 测试设计（house style：无 mock，注入点 + 真实 ZODB）

### 3.1 FetchScope 单元（离线，假 src）

`_FakeSrc`：计数 + 返回合成 DataFrame（借 test_tdx_overview.py 的
`_make_snapshot/_make_capital/_make_f10/_make_daily` 形状）。断言：
- daily 250 请求后 gap 请求复用（fetch_daily 恰 1 次）
- None 请求重拉（2 次，全量场景）
- capital/f10 同 key 复用

### 3.2 主链路单遍（注入计数 scope，真实 ZODB + 假数据）

`get_stock_data("999998", _scope=counting_scope)`：
- 新 stock（首建）：daily/capital/f10/snapshot/xdxr 各恰 1 次；overview、
  datas、reports 落库。
- 已有 stock 双 stale（#1 门命中 + history gap>0 + 报告门 miss）：各源仍
  各 1 次。
- 双 fresh：零拉取（纯门短路）。

### 3.3 批量 mutator（test_ChinaStock.py）

- `add_datas`：新行全追加 + last_data_update 前进 + 返回 len；重复行 → 0
  不 commit（构造事务计数不可行 → 用行为断言：重复调用后 datas 长度不变）。
- `add_performance_reports`：递增去重 + 返回追加数；单行版委托行为不变
  （既有用例全绿）。

### 3.4 回归

- test/core/data_acquisition/ 全文件（19 用例）、test/data_structure/
  test_ChinaStock.py、全量 pytest 0 新增失败。

## 4. 回滚形状

- 消费者 `_scope` 默认 None → 删除协调器预播种与批量调用即回滚到现状
  （FetchScope 与批量 mutator 可独立保留或一并撤）。
- 批量 mutator 与单行版并存 → 单行版行为不变的兼容层本身就是回滚点。

## 5. 与既有 spec 的关系（修订点）

- data_structure/index.md：mutator commit 规则增补批量例外（单次 commit
  整批；逐行 commit = anti-pattern）。
- core/index.md：`get_stock_data` + 三消费者条目更新（FetchScope、预播种、
  `_scope` 参数、门 helper）。
- data_source/index.md：thin wrapper 契约不变，无修订（`build_overview` /
  `build_reports` 的 `_scope` 透传在 core 条目说明即可）。
