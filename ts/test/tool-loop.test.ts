import { describe, expect, it } from 'vitest';
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { invokeWithTools } from '../src/toolLoop.ts';

// 脚本化 LLM：按调用序返回预置响应（函数形式，Runnable 兼容）
function scriptedLlm(script: Array<() => AIMessage>) {
  const fn = async (payload: unknown) => {
    const p = payload as { query: Array<[string, string] | BaseMessage> };
    void p; // 脚本化响应，不消费输入
    const step = script.shift();
    if (!step) throw new Error('script exhausted');
    return step();
  };
  (fn as unknown as { invoke: unknown }).invoke = fn;
  return fn;
}

const toolCall = (name: string, args: Record<string, unknown>, id = 'call_1') =>
  new AIMessage({
    content: '',
    tool_calls: [{ name, args, id, type: 'tool_call' }],
  });

function humanMessages(messages: Array<[string, string] | BaseMessage>): BaseMessage[] {
  return messages
    .filter((m): m is BaseMessage => !Array.isArray(m))
    .map((m) => m as BaseMessage);
}

describe('tool loop (AC3)', () => {
  it('message sequence: human → AIMessage(tool_calls) → ToolMessage → final', async () => {
    const llm = scriptedLlm([
      () => toolCall('web_search', { query: 'q1' }),
      () => new AIMessage({ content: '最终回答' }),
    ]);
    const { response, messages } = await invokeWithTools(llm, '查询', {}, {
      tools: [{ name: 'web_search', invoke: () => '搜索结果' }],
    });
    expect(response.content).toBe('最终回答');
    expect(messages[0]).toEqual(['human', '查询']);
    expect((messages[1] as AIMessage).tool_calls?.[0].name).toBe('web_search');
    expect(messages[2] instanceof ToolMessage).toBe(true);
    expect((messages[2] as ToolMessage).content).toBe('搜索结果');
    expect((messages[3] as AIMessage).content).toBe('最终回答');
  });

  it('unknown tool → placeholder ToolMessage, loop continues', async () => {
    const llm = scriptedLlm([
      () => toolCall('no_such_tool', {}),
      () => new AIMessage({ content: '回答' }),
    ]);
    const { messages } = await invokeWithTools(llm, 'q', {}, { tools: [] });
    const toolMsg = humanMessages(messages).find((m) => m instanceof ToolMessage) as ToolMessage;
    expect(toolMsg.content).toBe('（未找到工具 no_such_tool）');
  });

  it('tool exception → placeholder, does not raise', async () => {
    const llm = scriptedLlm([
      () => toolCall('web_search', {}),
      () => new AIMessage({ content: '回答' }),
    ]);
    const { messages } = await invokeWithTools(llm, 'q', {}, {
      tools: [{
        name: 'web_search',
        invoke: () => { throw new Error('boom'); },
      }],
    });
    const toolMsg = humanMessages(messages).find((m) => m instanceof ToolMessage) as ToolMessage;
    expect(String(toolMsg.content)).toBe('（联网搜索失败：boom）');
  });

  it('rounds exhausted → final round instruction appended (bounded +1 call)', async () => {
    const llm = scriptedLlm([
      () => toolCall('web_search', {}),
      () => toolCall('web_search', {}),
      () => new AIMessage({ content: '收尾回答' }),
    ]);
    const { response, messages } = await invokeWithTools(llm, 'q', {}, {
      tools: [{ name: 'web_search', invoke: () => 'r' }],
      maxToolRounds: 2, // 两轮都要求工具 → 收尾轮
    });
    expect(response.content).toBe('收尾回答');
    const lastHuman = messages.filter((m) => Array.isArray(m)).pop() as [string, string];
    expect(lastHuman[1]).toContain('工具调用轮数已用尽');
  });

  it('empty tools → single direct call', async () => {
    let calls = 0;
    const fn = async (_payload?: unknown) => { calls++; return new AIMessage({ content: '直调' }); };
    (fn as unknown as { invoke: unknown }).invoke = fn;
    const { response } = await invokeWithTools(fn, 'q', {}, { tools: [] });
    expect(response.content).toBe('直调');
    expect(calls).toBe(1);
  });
});
