// eventReduce 单测(B6:handleEvent 的纯折叠部分抽出后可直接钉分支)。
// 这里钉的是**容易写错**的四条:
//   1) 看门狗中止后只接受 done(孤儿 token/progress 不得再写 UI);
//   2) report 事件按 stateKey 清掉初稿+修订两个节点的 partial;
//   3) token 走合并广播且**不进** events(否则快照数组 O(n²) 膨胀);
//   4) roleStatus 'retry' 复位该节点已流出文本。
import { describe, expect, it } from 'vitest';
import { reduceEvent, type ReducibleState } from '../app/lib/eventReduce.ts';

function state(): ReducibleState {
  return {
    events: [],
    finalDecision: '',
    stockInformation: '',
    partials: {},
    statuses: {},
    hasDone: false,
    error: null,
  };
}

const ctx = (over: { timedOut?: boolean } = {}) => ({
  timedOut: over.timedOut ?? false,
  roleNodesFor: (key: string) =>
    key === 'bullish_opinions' ? ['bullish_trader', 'bullish_revise'] : ['fundamental_analysis_expert'],
});

describe('reduceEvent', () => {
  it('看门狗中止后:非 done 一律丢弃,且不写状态', () => {
    const s = state();
    const r = reduceEvent(s, { type: 'token', roleKey: 'k', node: 'n', delta: 'x' }, ctx({ timedOut: true }));
    expect(r.outcome.kind).toBe('dropped');
    expect(s.partials).toEqual({});
    expect(s.events).toHaveLength(0);
  });

  it('看门狗中止后仍接受 done', () => {
    const s = state();
    const r = reduceEvent(
      s,
      { type: 'done', report: { ticker: '600036', stock_information: 'si', final_decision: '买入', opinions: [] } },
      ctx({ timedOut: true }),
    );
    expect(r.outcome.kind).toBe('done');
  });

  it('report:按 stateKey 清掉初稿与修订两个 partial', () => {
    const s = state();
    s.partials['bullish_trader'] = '初稿片段';
    s.partials['bullish_revise'] = '修订片段';
    s.partials['unrelated'] = '别的节点';
    reduceEvent(s, { type: 'report', key: 'bullish_opinions', tabTitle: '看涨观点', content: '全文' }, ctx());
    expect(s.partials['bullish_trader']).toBeUndefined();
    expect(s.partials['bullish_revise']).toBeUndefined();
    expect(s.partials['unrelated']).toBe('别的节点'); // 不误删
    expect(s.events).toHaveLength(1); // report 进 events
  });

  it('token:走合并广播且不进 events', () => {
    const s = state();
    const r1 = reduceEvent(s, { type: 'token', roleKey: 'k', node: 'n', delta: '一' }, ctx());
    const r2 = reduceEvent(s, { type: 'token', roleKey: 'k', node: 'n', delta: '二' }, ctx());
    expect(r1.outcome).toEqual({ kind: 'applied', notify: 'coalesced' });
    expect(r2.outcome).toEqual({ kind: 'applied', notify: 'coalesced' });
    expect(s.partials['n']).toBe('一二');
    expect(s.events).toHaveLength(0);
  });

  it("roleStatus 'retry':复位该节点已流出文本,状态照写", () => {
    const s = state();
    s.partials['bullish_trader'] = '半截工具轮输出';
    reduceEvent(s, { type: 'roleStatus', roleKey: 'k', node: 'bullish_trader', status: 'retry' }, ctx());
    expect(s.partials['bullish_trader']).toBe('');
    expect(s.statuses['bullish_trader']).toBe('retry');
  });

  it("roleStatus 'degraded':保留文本(终态,不是重试)", () => {
    const s = state();
    s.partials['n'] = '兜底文案';
    reduceEvent(s, { type: 'roleStatus', roleKey: 'k', node: 'n', status: 'degraded' }, ctx());
    expect(s.partials['n']).toBe('兜底文案');
    expect(s.statuses['n']).toBe('degraded');
  });

  it('error 终态:写 error、清 chips、撤销 hasDone', () => {
    const s = state();
    s.hasDone = true;
    s.statuses['n'] = 'done';
    reduceEvent(s, { type: 'error', error: 'LLM 鉴权失败' }, ctx());
    expect(s.error).toBe('LLM 鉴权失败');
    expect(s.statuses).toEqual({});
    expect(s.hasDone).toBe(false);
    expect(s.events).toHaveLength(1);
  });
});
