import { describe, expect, it } from 'vitest';
import { AIMessage } from '@langchain/core/messages';
import { BullishTrader } from '../src/agents.ts';

function stubLlm() {
  const fn = async () => new AIMessage({ content: 'ok' });
  (fn as unknown as { invoke: unknown }).invoke = fn;
  return fn as unknown as { invoke(): Promise<AIMessage>; bindTools?: (t: unknown[]) => unknown };
}

describe('bind_tools fallback (AC5)', () => {
  it('llm without bindTools → no binding, construction does not throw', () => {
    const llm = stubLlm() as unknown as { invoke(): Promise<AIMessage> }; // 无 bindTools
    const agent = new BullishTrader(llm as never, {});
    expect(agent).toBeTruthy();
  });

  it('bindTools throws (NotImplementedError-style) → fallback to direct call', async () => {
    const llm = stubLlm();
    llm.bindTools = () => { throw new Error('bindTools not supported'); };
    const agent = new BullishTrader(llm as never, {}, null, [{ name: 'web_search', invoke: () => 'r' }]);
    expect(agent).toBeTruthy();
  });

  it('bindTools works → tools bound for tool roles', () => {
    let bound: unknown = null;
    const llm = stubLlm();
    llm.bindTools = (tools) => { bound = tools; return llm; };
    const tools = [{ name: 'web_search', invoke: () => 'r' }];
    const agent = new BullishTrader(llm as never, {}, null, tools);
    expect(agent).toBeTruthy();
    expect(bound).toBe(tools);
  });

  it('expert ignores tools (no bindTools path)', () => {
    const llm = stubLlm();
    const agent = new BullishTrader(llm as never, {}, null, []);
    expect(agent).toBeTruthy();
  });
});
