// 「决策价位」抽取测试(2026-11-22 决策价位 Tab)。
// 用例文本取**真实 600036 报告样式**(表格 + 编号动作表 + 列表项 + 长句结论),
// 2026-11-22 一次真实运行的《最终结论》节选 —— 这里钉死的是"从这种写法里
// 抽出的到底是哪几个数",防止规则调整时静默抽错价位(错价位会直接误导交易)。
import { describe, expect, it } from 'vitest';
import { extractLevels, levelDeltaPct } from '../src/levels.ts';

/** 真实报告节选(结构/措辞与 2026-11-06 600036 运行一致,篇幅压缩)。 */
const REAL_REPORT = `# 招商银行（600036）最终投资决策书
**基准：2026-11-06 收盘 42.88 元｜PB 0.915｜静态PE 7.52｜股息率 4.79%**

### 方向：**不做空；以"低价位分批的中期持有多头"为主，现价不追高**

| 维度 | 决策 | 主要依据（报告中可复核项） |
|---|---|---|
| 是否做空 | **否（明确否决）** | 空头目标 41.80/41.00 需先击穿 42.44 |
| 主要买入带 | **42.64 以下三档 + 40.45–40.36 终极档** | 基第十节"40 元以下（PB≤0.85）为较好买入区" |
| 中期目标 | **44.5（第一）→ 46.0（第二）→ 46.6（技术量度）** | PB 0.95×46.87=44.53；量度 44.01+2.59=46.60 |
| 主要减仓区 | **49.5 元以上（PB≥1.06）；47.6 为次减仓点** | 基第十节"减仓区 49.5 以上" |

- **未持仓**：现价 42.88 **零买入**。挂单 **42.64–42.44** 承接首笔 **20%** 计划额度。
- **短线止损**：交易仓**收盘跌破 42.44** → 减半；**跌破 41.80** → 交易仓清空。
- **中期失效（触发即降级）**：①收盘跌破 **41.01/41.19** 且三日不收回 → 中期仓减半。

| 信号 | 动作 |
|---|---|
| **尚未买入** | **0 买入**，不设现价市价单 | 42.64 以下四档挂单；或 43.55 带量追 20%（二选一） |
| 收盘 ≥43.55 + 量 >1,260,378.40 lots + MACD 金叉 | 追 20%，止损 42.64 |
| ≥49.5（PB≥1.06） | 主要减仓，仅留 20–30% 底仓 |
| 收盘跌破 41.01 且三日不收回 | 中期仓减半，等 40.45–40.36 回补 |

## 七、信心度

**策略整体信心度：65%**

**一句话结论**：**在 42.88 元，最优解是把全部风险预算移到 42.64 以下的支撑带，把 42.88–43.55 让给追高者，把 44.5/46.0 作为兑现带，把 49.5 以上作为强制减持带。**
`;

const prices = (levels: Array<{ price: number }>) => levels.map((l) => l.price);

describe('extractLevels (真实报告节选)', () => {
  const r = extractLevels(REAL_REPORT, 42.88);

  it('方向取方向行的首个分句,信心度取整体策略值', () => {
    expect(r.direction).toBe('不做空');
    expect(r.confidence).toBe(65);
  });

  it('买入带:表格 + 列表项各取到,升序', () => {
    expect(prices(r.entry)).toEqual([40.36, 40.45, 42.44, 42.64, 43.55]);
  });

  it('目标带:44.5/46.0/46.6/47.6/49.5,全部在现价上方', () => {
    expect(prices(r.target)).toEqual([44.5, 46, 46.6, 47.6, 49.5]);
    expect(r.target.every((l) => l.price > 42.88)).toBe(true);
  });

  it('防守带:41.01/41.19/41.80/42.44/42.64,全部在现价下方', () => {
    expect(prices(r.stop)).toEqual([41.01, 41.19, 41.8, 42.44, 42.64]);
    expect(r.stop.every((l) => l.price < 42.88)).toBe(true);
  });

  it('每条价位都带可回溯的原文片段', () => {
    for (const lv of [...r.entry, ...r.target, ...r.stop]) {
      expect(lv.source.length).toBeGreaterThan(0);
      expect(lv.source.length).toBeLessThanOrEqual(48);
    }
  });

  it('现价本身不进价位列表(报告里「现价 42.88」是引用不是买点)', () => {
    for (const lv of [...r.entry, ...r.target, ...r.stop]) expect(lv.price).not.toBe(42.88);
  });
});

describe('extractLevels 噪声过滤', () => {
  it('百分比/千分位/单位后缀不被当价位', () => {
    const text = [
      '| 目标 | **46.0** | PE 7.52、成交量 1,260,378.40 lots、股息率 4.79% |',
      '- 止损 41.80 元，仓位 20%，量能 1,260,378.40 手',
    ].join('\n');
    const r = extractLevels(text, 42.88);
    expect(prices(r.target)).toEqual([46]);
    // 20%(%)、7.52/4.79(量级过低)、1,260,378.40(千分位) 都不该出现
    expect(prices(r.stop)).toEqual([41.8]);
  });

  it('超出 0.5x–1.6x 现价的数字丢弃(极端锚不参与画图)', () => {
    const text = '| 中期目标 | **46.0** | 悲观锚 12.3 / 90.0 |\n| 防守 | **41.5** |';
    const r = extractLevels(text, 42.88);
    expect(prices(r.target)).toEqual([46]);
    expect(prices(r.stop)).toEqual([41.5]);
  });

  it('散文段落不参与解析(避免一整句杂数字变成价位)', () => {
    const prose = '**一句话结论**：最优解是把全部风险预算移到 42.64 以下的支撑带，把 44.5/46.0 作为兑现带。';
    const r = extractLevels(prose, 42.88);
    expect([...r.entry, ...r.target, ...r.stop]).toEqual([]);
  });

  it('含「空头/做空」的行整行跳过(空方方案不是本报告的执行价位)', () => {
    const text = '- 空头方案：43.03–43.55 挂空，44.01 平半\n- 止损：42.64';
    const r = extractLevels(text, 42.88);
    expect(prices(r.stop)).toEqual([42.64]);
  });

  it('目标只保留现价上方、防守只保留现价下方', () => {
    const text = '| 目标 | **46.0 / 38.0** |\n| 止损 | **41.8 / 44.0** |';
    const r = extractLevels(text, 42.88);
    expect(prices(r.target)).toEqual([46]);
    expect(prices(r.stop)).toEqual([41.8]);
  });

  it('每类最多 5 条,保留离现价最近的', () => {
    const text = '| 目标 | **43.0 / 43.2 / 43.4 / 43.6 / 44.0 / 52.0** |';
    const r = extractLevels(text, 42.88);
    expect(prices(r.target)).toEqual([43, 43.2, 43.4, 43.6, 44]);
  });
});

describe('extractLevels 边界', () => {
  it('空文本 → 全空,不抛错', () => {
    expect(extractLevels('', 42.88)).toEqual({
      direction: null, confidence: null, entry: [], target: [], stop: [],
    });
  });

  it('现价缺失/非法 → 仍给方向与信心度,价位为空(没有基准就不猜)', () => {
    const r = extractLevels(REAL_REPORT, Number.NaN);
    expect(r.direction).toBe('不做空');
    expect(r.confidence).toBe(65);
    expect([...r.entry, ...r.target, ...r.stop]).toEqual([]);
    expect(extractLevels('- 目标 46.0', 0).target).toEqual([]);
  });

  it('演示占位报告(无任何价位关键词)→ 全空,不告警刷屏', () => {
    const demo = '[演示·投资经理] 演示模式报告:未配置 LLM 三键,本报告为占位文本。';
    const r = extractLevels(demo, 42.88);
    expect([...r.entry, ...r.target, ...r.stop]).toEqual([]);
    expect(r.direction).toBeNull();
    expect(r.confidence).toBeNull();
  });

  it('信心度越界/无百分号 → null', () => {
    expect(extractLevels('信心度：120%', 10).confidence).toBeNull();
    expect(extractLevels('信心度：65 分', 10).confidence).toBeNull();
  });

  it('方向行过长 → 截断到 24 字以内', () => {
    const long = '### 方向：**这是一段特别特别长的方向描述，用来确认截断逻辑确实生效且不会溢出卡片布局**';
    const d = extractLevels(long, 42.88).direction!;
    expect(d.length).toBeLessThanOrEqual(24);
    expect(d.endsWith('…')).toBe(true);
  });
});

describe('levelDeltaPct', () => {
  it('相对现价百分比(带符号)', () => {
    expect(levelDeltaPct(46, 42.88)).toBeCloseTo(7.276, 2);
    expect(levelDeltaPct(41.8, 42.88)).toBeCloseTo(-2.519, 2);
  });

  it('现价非法 → NaN', () => {
    expect(Number.isNaN(levelDeltaPct(46, 0))).toBe(true);
    expect(Number.isNaN(levelDeltaPct(Number.NaN, 42.88))).toBe(true);
  });
});
