// E11:app/lib/runner.ts 演示兜底 —— buildLlm(null) 契约 + demoLlm PHRASES 路由矩阵。
// 可测性:store-gates.test.ts / yahoo-collect.test.ts 已同链导入 runner.ts
// (store-idb/store-file/langchain/demo.json 全图)并全绿,Node 下无需 stub/resetModules。
// fixtures 直接用 src/prompt.ts 的真实角色提示词开头:若某角色提示词改写导致
// 独有短语漂移,本矩阵即失败——正好钉住「提示词 ↔ demoLlm 路由」的耦合。
import { describe, expect, it } from 'vitest';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { buildLlm } from '../app/lib/runner.ts';
import {
  bearish_revise_message,
  bearish_trader_message,
  bullish_revise_message,
  bullish_trader_message,
  fundamental_analysis_expert_message,
  information_analyst_message,
  investment_manager_message,
  technical_indicator_analyst_message,
  trend_analysis_expert_message,
} from '../src/prompt.ts';

/** buildLlm 按 unknown 契约返回;测试视图窄化为演示可调用形状。 */
type DemoFn = ((payload: unknown) => Promise<{ content: string }>) & { invoke: unknown };

const makeDemo = (): DemoFn => buildLlm(null) as DemoFn;

describe('buildLlm(null) 兜底契约', () => {
  it('返回可直接 await 调用的函数,且挂 .invoke 属性', async () => {
    const fn = makeDemo();
    expect(typeof fn).toBe('function');
    expect(typeof fn.invoke).toBe('function');
    const res = await fn([new SystemMessage(investment_manager_message)]);
    expect(res).toBeInstanceOf(AIMessage);
    expect(res.content).toContain('[演示·投资经理]');
    // 占位报告的用户可见声明(三键未配置提示)
    expect(res.content).toContain('未配置 LLM 三键');
  });
});

describe('demoLlm 角色路由矩阵(system 独有短语 → 标签)', () => {
  const CASES: Array<[string, string, string]> = [
    ['对抗修订轮的多方交易员 → 看涨', bullish_revise_message, '看涨'],
    ['对抗修订轮的空方交易员 → 看跌', bearish_revise_message, '看跌'],
    ['坚定看多的股票交易员 → 看涨', bullish_trader_message, '看涨'],
    ['坚定看空的股票交易员 → 看跌', bearish_trader_message, '看跌'],
    ['基本面分析师 → 基本面', fundamental_analysis_expert_message, '基本面'],
    ['趋势分析师 → 趋势', trend_analysis_expert_message, '趋势'],
    ['技术指标分析师 → 指标', technical_indicator_analyst_message, '指标'],
    ['信息面分析师 → 信息面', information_analyst_message, '信息面'],
    ['投资经理 → 投资经理', investment_manager_message, '投资经理'],
  ];
  for (const [name, prompt, label] of CASES) {
    it(name, async () => {
      const res = await makeDemo()([new SystemMessage(prompt)]);
      expect(res.content).toContain(`[演示·${label}]`);
    });
  }
});

describe('payload 形态与路由边界', () => {
  it('{messages:[...]} 包裹形态与数组形态同路由', async () => {
    const wrapped = await makeDemo()({ messages: [new SystemMessage(bullish_trader_message)] });
    expect(wrapped.content).toContain('[演示·看涨]');
  });

  it('数组混入 human 消息:human 含短语不参与路由,只认 system', async () => {
    const res = await makeDemo()([
      new HumanMessage('请以投资经理视角总结'),
      new SystemMessage(fundamental_analysis_expert_message),
    ]);
    expect(res.content).toContain('[演示·基本面]');
  });

  it('无匹配短语 → [演示·占位]', async () => {
    const res = await makeDemo()([new SystemMessage('一段与任何角色提示词都无关的话')]);
    expect(res.content).toContain('[演示·占位]');
  });

  it('两条短语共存取文中更早者(空方早于表序首位的多方 → 看跌)', async () => {
    const text = '空方先行:你是一位专业的对抗修订轮的空方交易员。随后才是:你是一位专业的对抗修订轮的多方交易员。';
    const res = await makeDemo()([new SystemMessage(text)]);
    expect(res.content).toContain('[演示·看跌]');
  });

  it('共存反向:投资经理早于坚定看多(表序靠后者胜出)→ 投资经理', async () => {
    const text = '你是一位专业的投资经理,同时引用了坚定看多的股票交易员的观点';
    const res = await makeDemo()([new SystemMessage(text)]);
    expect(res.content).toContain('[演示·投资经理]');
  });

  it('system.content 非 string(LangChain 内容块)→ 占位', async () => {
    const res = await makeDemo()([
      new SystemMessage([{ type: 'text', text: investment_manager_message }]),
    ]);
    expect(res.content).toContain('[演示·占位]');
  });

  it('无 system 消息(仅 human)→ 占位', async () => {
    const res = await makeDemo()([new HumanMessage('只有人类消息')]);
    expect(res.content).toContain('[演示·占位]');
  });

  it('{} 缺 messages 键 → 占位且不抛', async () => {
    const res = await makeDemo()({});
    expect(res.content).toContain('[演示·占位]');
  });
});
