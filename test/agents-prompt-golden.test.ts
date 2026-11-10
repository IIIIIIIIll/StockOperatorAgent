// R2 回归钉子:多/空交易员与投资经理的 query 文本**逐字节**锁定。
//
// 为什么单独一个文件:`src/agents.ts` 三处 query 块此前是复制粘贴(440/466 逐字
// 相同,494 差 `\n${info}\n` 缩进),去重时任何一位空白漂移都会改写发给 LLM 的
// 提示词。这里用重构前实测的字符串当 golden —— 断言是 `toBe`(全等),不是
// `toContain`,所以多一个空格也会红。
//
// house style:无 `vi.mock`。捕获点用子类覆写 `completeWithTools`(与
// `CapturingAnalyst` 同一手法),注入点即覆写点。
import { describe, expect, it } from 'vitest';
import { BearishTrader, BullishTrader, InvestmentManager } from '../src/agents.ts';

function stubLlm() {
  const fn = async () => ({ content: 'ok' });
  (fn as unknown as { invoke: unknown }).invoke = fn;
  return fn;
}

const STATE = {
  target_stock_ticker: '600036',
  fundamental_analysis: 'FUND',
  trend_analysis: 'TREND',
  technical_indicator_analysis: 'TECH',
  information_analysis: 'INFO',
};

/** 无信息面素材时 infoSection 返回 ''（对照分支，尾随缩进不同）。 */
const STATE_NO_INFO = {
  target_stock_ticker: '600036',
  fundamental_analysis: 'FUND',
  trend_analysis: 'TREND',
  technical_indicator_analysis: 'TECH',
};

async function captureBullish(state: Record<string, unknown>): Promise<string> {
  let captured = '';
  class Cap extends BullishTrader {
    async completeWithTools(q: string): Promise<Record<string, unknown>> {
      captured = q;
      return {};
    }
  }
  await new Cap(stubLlm() as never, {}).bullish_trader(state);
  return captured;
}

async function captureBearish(state: Record<string, unknown>): Promise<string> {
  let captured = '';
  class Cap extends BearishTrader {
    async completeWithTools(q: string): Promise<Record<string, unknown>> {
      captured = q;
      return {};
    }
  }
  await new Cap(stubLlm() as never, {}).bearish_trader(state);
  return captured;
}

async function captureInvestment(state: Record<string, unknown>): Promise<string> {
  let captured = '';
  class Cap extends InvestmentManager {
    async completeWithTools(q: string): Promise<Record<string, unknown>> {
      captured = q;
      return {};
    }
  }
  await new Cap(stubLlm() as never, {}).investment_manager(state);
  return captured;
}

// 重构前实测基线（2026-11-10，`HEAD = 86f24ee`）。
const GOLDEN_TRADER =
  '\n        现在请基于以下信息，给出你对股票代码600036的看法：\n        基本面报告: \n        FUND\n        \n        趋势报告: \n        TREND\n        \n        技术指标分析报告: \n        TECH\n        \n        \n        信息面分析报告: \n        INFO\n        ';
const GOLDEN_TRADER_NO_INFO =
  '\n        现在请基于以下信息，给出你对股票代码600036的看法：\n        基本面报告: \n        FUND\n        \n        趋势报告: \n        TREND\n        \n        技术指标分析报告: \n        TECH\n        \n        ';
const GOLDEN_INVESTMENT =
  '\n        现在请基于以下信息，给出你对股票代码600036的最终投资建议：\n        基本面报告: \n        FUND\n        \n        趋势报告: \n        TREND\n        \n        技术指标分析报告: \n        TECH\n        \n\n        信息面分析报告: \n        INFO\n        \n        多头观点: \n        BULL\n        \n        空头观点: \n        BEAR\n        \n';

describe('R2 query 文本逐字节锁定(重构前后必须全等)', () => {
  it('多头交易员:带信息面素材', async () => {
    expect(await captureBullish(STATE)).toBe(GOLDEN_TRADER);
  });

  it('空头交易员:与多头逐字相同(仅 stateKey 不同)', async () => {
    expect(await captureBearish(STATE)).toBe(GOLDEN_TRADER);
    expect(await captureBearish(STATE)).toBe(await captureBullish(STATE));
  });

  it('多头交易员:无信息面素材 → infoSection 为空串,尾部只剩缩进', async () => {
    expect(await captureBullish(STATE_NO_INFO)).toBe(GOLDEN_TRADER_NO_INFO);
  });

  it('投资经理:三专家块 + \\n${info}\\n(缩进与交易员不同,不可共用尾部)', async () => {
    const q = await captureInvestment({
      ...STATE,
      bullish_opinions: [{ content: 'BULL' }],
      bearish_opinions: [{ content: 'BEAR' }],
    });
    expect(q).toBe(GOLDEN_INVESTMENT);
  });

  it('投资经理:多空观点缺失 → 空串占位,不产生 undefined', async () => {
    const q = await captureInvestment(STATE);
    expect(q).toContain('多头观点: \n        \n');
    expect(q).not.toContain('undefined');
  });
});
