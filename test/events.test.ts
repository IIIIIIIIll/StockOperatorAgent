import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { AIMessage } from '@langchain/core/messages';
import { Store, type DailyBar } from '../src/store.ts';
import { createPipelineRunner, describeError, type PipelineEvent } from '../src/events.ts';
import { MissingLlmConfigError } from '../src/llm.ts';

const fixtureRaw = JSON.parse(fs.readFileSync('test/fixtures/600036_daily.json', 'utf8')).raw as DailyBar[];
const bars = fixtureRaw.map((b) => ({ ...b, date: b.date.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') }));
const f10Text = fs.readFileSync('test/fixtures/f10_tdx.txt', 'utf8');

// 按 system 消息路由的假 LLM(对齐 Python FakeListChatModel 约定)
const PHRASES: Array<[string, string]> = [
  ['对抗修订轮的多方交易员', 'BULL_REV'],
  ['对抗修订轮的空方交易员', 'BEAR_REV'],
  ['精于计算公司的基本面数据', 'FUND'],
  ['给出高准确度的客观趋势分析', 'TREND'],
  ['技术指标信号解读与择时判断', 'TECH'],
  ['整合公告、研报、新闻与推特', 'INFO'],
  ['坚定看多的股票交易员', 'BULL'],
  ['坚定看空的股票交易员', 'BEAR'],
  ['精于价值与趋势结合的投资策略', 'FINAL'],
];

function stubLlm(opts: { fundFailOnce?: boolean } = {}) {
  const fundCalls = { n: 0 };
  const fn = async (payload: unknown) => {
    // AgentNode 经 prompt.pipe 包装：收到 ChatPromptValue({messages}) 或消息数组
    const list = Array.isArray(payload)
      ? (payload as Array<{ _getType?: () => string; content?: unknown }>)
      : (((payload as { messages?: Array<{ _getType?: () => string; content?: unknown }> }).messages) ?? []);
    const sys = list.find((m) => m._getType?.() === 'system');
    const content = sys?.content;
    const text = typeof content === 'string' ? content : JSON.stringify(content ?? '');
    const hit = PHRASES.find(([p]) => text.includes(p));
    const tag = hit ? hit[1] : 'UNROUTED';
    // retry 注入:基本面专家首次调用抛 429(可恢复)→ streamWithRetry 内部重试
    if (opts.fundFailOnce && tag === 'FUND') {
      fundCalls.n++;
      if (fundCalls.n === 1) {
        const err = new Error('rate limited') as Error & { status?: number };
        err.status = 429;
        throw err;
      }
    }
    return new AIMessage({ content: `${tag}_REPORT` });
  };
  (fn as unknown as { invoke: unknown }).invoke = fn;
  return fn;
}

function seededStore(): Store {
  const store = new Store();
  store.putStock({ ticker: '600036', name: '招商银行', overview: null, overviewLastUpdate: null, lastDataUpdate: null });
  store.addDatas('600036', bars);
  return store;
}

describe('pipeline runner (AC2/AC3 事件流)', () => {
  it('event sequence: progress → reports → done with final report', async () => {
    const store = seededStore();
    const runner = createPipelineRunner(store);
    const events: PipelineEvent[] = [];
    runner.subscribe((e) => events.push(e));

    const report = await runner.run('600036', {
      f10Text,
      snapshot: { price: 38.8, high: 39.1, low: 38.48, open: 38.9 },
      today: '2026-08-09',
      llm: stubLlm(),
    });

    const types = events.map((e) => e.type);
    expect(types[0]).toBe('progress');
    expect(types).toContain('report');
    expect(types[types.length - 1]).toBe('done');
    // report 事件带 tabTitle 映射
    const reportEvt = events.find((e) => e.type === 'report' && e.key === 'fundamental_analysis');
    expect(reportEvt).toBeTruthy();
    expect((reportEvt as { tabTitle: string }).tabTitle).toBe('基本面分析');

    // 流式事件:每节点 roleStatus running→done + token(单 chunk 全量,roleKey 映射)
    const fundStatus = events.filter(
      (e): e is Extract<PipelineEvent, { type: 'roleStatus' }> => e.type === 'roleStatus' && e.node === 'fundamental_analysis_expert',
    );
    expect(fundStatus.map((e) => e.status)).toEqual(['running', 'done']);
    const fundTokens = events.filter(
      (e): e is Extract<PipelineEvent, { type: 'token' }> => e.type === 'token' && e.node === 'fundamental_analysis_expert',
    );
    expect(fundTokens.map((e) => e.delta)).toEqual(['FUND_REPORT']);
    expect(fundTokens[0].roleKey).toBe('fundamental_analysis');
    // 修订节点(reviseNodeName)→ 同 stateKey 映射
    const revTokens = events.filter(
      (e): e is Extract<PipelineEvent, { type: 'token' }> => e.type === 'token' && e.node === 'bullish_revise',
    );
    expect(revTokens.map((e) => e.delta)).toEqual(['BULL_REV_REPORT']);
    expect(revTokens[0].roleKey).toBe('bullish_opinions');
    // token 总量 = 9 节点(4 专家 + 2 初稿 + 2 修订 + 经理)各 1 全量 delta
    expect(events.filter((e) => e.type === 'token')).toHaveLength(9);
    expect(events.filter((e) => e.type === 'roleStatus')).toHaveLength(18); // 9 节点 × (running+done)

    expect(report.final_decision).toBe('FINAL_REPORT');
    // 专家 4(含信息面) + 多空各 2(初稿+修订) = 8;经理不入 opinions
    expect(report.opinions).toHaveLength(8);
    expect(report.opinions.map((o) => o.content)).toContain('FUND_REPORT');
    expect(report.opinions.map((o) => o.content)).toContain('INFO_REPORT');
    expect(report.opinions.map((o) => o.content)).toContain('BULL_REPORT');
    expect(report.stock_information).toContain('【技术指标（');
    expect(report.stock_information).toContain('（未配置 TDX_API_KEY，跳过实时市场情报）');
  });

  it('error path: missing LLM keys → error event + throw', async () => {
    const store = seededStore();
    const runner = createPipelineRunner(store);
    const events: PipelineEvent[] = [];
    runner.subscribe((e) => events.push(e));

    const saved = { ...process.env };
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_MODEL;
    delete process.env.LLM_BASE_URL;
    try {
      await expect(runner.run('600036', { today: '2026-08-09' })).rejects.toThrow(MissingLlmConfigError);
    } finally {
      process.env.LLM_API_KEY = saved.LLM_API_KEY;
      process.env.LLM_MODEL = saved.LLM_MODEL;
      process.env.LLM_BASE_URL = saved.LLM_BASE_URL;
    }
    expect(events.some((e) => e.type === 'error')).toBe(true);
    const err = events.find((e) => e.type === 'error') as { error: string };
    expect(err.error).toContain('缺少 LLM 配置');
  });

  it('unsubscribe stops delivery', async () => {
    const store = seededStore();
    const runner = createPipelineRunner(store);
    let count = 0;
    const off = runner.subscribe(() => count++);
    off();
    await runner.run('600036', { today: '2026-08-09', llm: stubLlm() });
    expect(count).toBe(0);
  });

  it('retry 注入 → roleStatus 序列 running→retry→done,后续 token 全量重来', async () => {
    const store = seededStore();
    const runner = createPipelineRunner(store);
    const events: PipelineEvent[] = [];
    runner.subscribe((e) => events.push(e));

    await runner.run('600036', {
      f10Text,
      snapshot: { price: 38.8, high: 39.1, low: 38.48, open: 38.9 },
      today: '2026-08-09',
      llm: stubLlm({ fundFailOnce: true }),
    });

    const fundStatus = events.filter(
      (e): e is Extract<PipelineEvent, { type: 'roleStatus' }> => e.type === 'roleStatus' && e.node === 'fundamental_analysis_expert',
    );
    expect(fundStatus.map((e) => e.status)).toEqual(['running', 'retry', 'done']);
    const fundTokens = events.filter(
      (e): e is Extract<PipelineEvent, { type: 'token' }> => e.type === 'token' && e.node === 'fundamental_analysis_expert',
    );
    // 首次尝试在产出 chunk 前失败 → 重试后单次全量 delta(无残留部分文本)
    expect(fundTokens.map((e) => e.delta)).toEqual(['FUND_REPORT']);
  });
});

describe('describeError(聚合异常解包)', () => {
  it('superstep 聚合错误 → 底层具体原因', () => {
    const agg = { name: 'GraphRecursionError', message: 'Multiple errors occurred during superstep 1. See the "errors" field of this exception for more details.', errors: [{ message: 'AuthenticationError: 401 Invalid API key.' }, { message: 'AuthenticationError: 401 Invalid API key.' }] };
    const out = describeError(agg);
    expect(out).toContain('401 Invalid API key');
    expect(out).not.toContain('Multiple errors occurred');
  });
  it('普通 Error → message', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
  });
  it('非对象 → String', () => {
    expect(describeError('raw')).toBe('raw');
  });
});
