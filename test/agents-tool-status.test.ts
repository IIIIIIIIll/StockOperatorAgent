// completeWithTools 收尾状态守卫(AL2 配合)单元测试 —— AgentNode + 脚本化链假件,
// 经注入 updater 断言 pushReport 内容与 roleStatus 终态(done/retry 两态)。
// 覆盖:收尾轮不服从(toolLoop 兜底标记 → retry)、空 content 早退(agents 空串
// 守卫 → 占位+retry)、正常结论(→ done,既有行为不变)。
import { describe, expect, it } from 'vitest';
import { AIMessage } from '@langchain/core/messages';
import { AgentNode } from '../src/agents.ts';
import type { RoleStatus } from '../src/progress.ts';

const toolCall = (name: string, args: Record<string, unknown>, id = 'call_1') =>
  new AIMessage({
    content: '',
    tool_calls: [{ name, args, id, type: 'tool_call' }],
  });

/** 脚本化链(LlmCallable 函数形态 + invoke 双面,同 tool-loop.test 模式)。 */
function scriptedChain(script: Array<() => AIMessage>) {
  const fn = async () => {
    const step = script.shift();
    if (!step) throw new Error('script exhausted');
    return step();
  };
  (fn as unknown as { invoke: unknown }).invoke = fn;
  return fn;
}

/** 注入 updater:捕获 pushReport/pushStatus 序列(deps 注入面,无 mock 框架)。 */
function makeUpdater() {
  const reports: Array<{ key: string; content: string }> = [];
  const statuses: Array<{ node: string; status: RoleStatus }> = [];
  return {
    reports,
    statuses,
    info: (_msg: string) => {},
    pushReport: (key: string, content: string) => {
      reports.push({ key, content });
    },
    pushStatus: (node: string, status: RoleStatus) => {
      statuses.push({ node, status });
    },
  };
}

/** 构造期 llm 假件(仅进 prompt.pipe 组合,不调用;invoke 挂载同 events.test 模式)。 */
function stubLlm(): never {
  const fn = async () => ({ content: '' });
  (fn as unknown as { invoke: unknown }).invoke = fn;
  return fn as never;
}

async function runComplete(script: Array<() => AIMessage>) {
  const updater = makeUpdater();
  // 真实调用走 chain 注入;构造期 llm 仅进 prompt.pipe 组合
  const agent = new AgentNode(stubLlm(), {}, updater, [{ name: 'web_search', invoke: () => 'r' }], '测试角色');
  const out = await agent.completeWithTools('查询', 'bullish_opinions', {
    startMsg: '开始',
    doneMsg: '结束',
    logLabel: 'Test',
    nodeName: 'bullish_trader',
    chain: scriptedChain(script),
    maxToolRounds: 2,
  });
  return { updater, out };
}

describe('completeWithTools 收尾状态守卫(AL2)', () => {
  it('收尾轮不服从(仍返 tool_calls)→ 报告为兜底占位文案,终态 retry(非 done)', async () => {
    const { updater, out } = await runComplete([
      () => toolCall('web_search', {}),
      () => toolCall('web_search', {}),
      () => toolCall('web_search', {}), // 收尾轮不服从强约束
    ]);
    expect(updater.reports).toEqual([
      { key: 'bullish_opinions', content: '搜索轮数已用尽，未能生成最终回答' },
    ]);
    const last = updater.statuses[updater.statuses.length - 1];
    expect(last).toEqual({ node: 'bullish_trader', status: 'retry' });
    expect(out.bullish_opinions).toBe('搜索轮数已用尽，未能生成最终回答');
  });

  it('轮内早退空 content(空白串)→ agents 空串守卫占位「（本轮未产出结论）」+ retry', async () => {
    const { updater, out } = await runComplete([
      () => new AIMessage({ content: '   ' }), // 无 tool_calls 且空白 → 首轮早退
    ]);
    expect(updater.reports).toEqual([
      { key: 'bullish_opinions', content: '（本轮未产出结论）' },
    ]);
    const last = updater.statuses[updater.statuses.length - 1];
    expect(last).toEqual({ node: 'bullish_trader', status: 'retry' });
    expect(out.bullish_opinions).toBe('（本轮未产出结论）');
  });

  it('正常结论 → 报告原文,终态 done(合规路径行为不变)', async () => {
    const { updater, out } = await runComplete([
      () => toolCall('web_search', {}),
      () => new AIMessage({ content: '看多结论' }),
    ]);
    expect(updater.reports).toEqual([{ key: 'bullish_opinions', content: '看多结论' }]);
    const last = updater.statuses[updater.statuses.length - 1];
    expect(last).toEqual({ node: 'bullish_trader', status: 'done' });
    expect(out.bullish_opinions).toBe('看多结论');
  });
});
