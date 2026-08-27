import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { AIMessage } from '@langchain/core/messages';
import { Store, type DailyBar } from '../src/store.ts';
import { createPipelineRunner, type PipelineEvent } from '../src/events.ts';
import { fromEnv, setCapabilitySwitches } from '../src/switches.ts';

// F21 离线隔离(本文件此前零 env 治理):联网搜索强制关 + 亿信 key 删除
// (client 主闸关)——防本机 env 残留触真网(20s fetch vs 15s testTimeout
// 抖动窗;CI 亦无网)。信息面角色仍运行,素材落固定回退文本(零网络)。
beforeEach(() => {
  process.env.WEB_SEARCH_DISABLED = '1';
  delete process.env.BILLIONS_API_KEY;
  setCapabilitySwitches(fromEnv()); // env 修改后配置面反推同步(agents.test 同款)
});

const fixtureRaw = JSON.parse(fs.readFileSync('test/fixtures/600036_daily.json', 'utf8')).raw as DailyBar[];
const bars = fixtureRaw.map((b) => ({ ...b, date: b.date.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') }));
const f10Text = fs.readFileSync('test/fixtures/f10_tdx.txt', 'utf8');

// 按 system 消息路由的假 LLM(对齐 events.test.ts stubLlm 用法)
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

function stubLlm() {
  const fn = async (payload: unknown) => {
    // AgentNode 经 prompt.pipe 包装:收到 ChatPromptValue({messages}) 或消息数组。
    // 经 in/typeof 窄化读取(禁内联对象 cast)。
    const list = Array.isArray(payload)
      ? payload
      : typeof payload === 'object' && payload !== null && 'messages' in payload && Array.isArray(payload.messages)
        ? payload.messages
        : [];
    const sys = list.find(
      (m) => typeof m === 'object' && m !== null && '_getType' in m && typeof m._getType === 'function' && m._getType() === 'system',
    );
    const content = sys?.content;
    const text = typeof content === 'string' ? content : JSON.stringify(content ?? '');
    const hit = PHRASES.find(([p]) => text.includes(p));
    return new AIMessage({ content: `${hit ? hit[1] : 'UNROUTED'}_REPORT` });
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

function runOpts() {
  return {
    f10Text,
    snapshot: { price: 38.8, high: 39.1, low: 38.48, open: 38.9 },
    today: '2026-08-09',
    llm: stubLlm(),
  };
}

describe('runner 并发守卫 (C2)', () => {
  it('busy: 同 tick 二次 run(不 await)被拒 —— 同步置位,首次事件流完整不交错', async () => {
    const store = seededStore();
    const runner = createPipelineRunner(store);
    const events: PipelineEvent[] = [];
    runner.subscribe((e) => events.push(e));

    // 第一次 run 立即发起(不 await);第二次同 tick 再调 —— 守卫在入口同步
    // 置位,第二次调用必须立刻看到 running=true。
    const p1 = runner.run('600036', runOpts());
    const p2 = runner.run('600036', runOpts());

    // 同步确定性:两次调用后、任何 await 之前 —— p1 同步前缀(开始分析+富化进度)
    // 已入列,p2 被 busy 拒绝('开始分析' 恰 1 条 => 第二个 pipeline 未启动)。
    const syncTypes = events.map((e) => e.type);
    expect(syncTypes[syncTypes.length - 1]).toBe('error');
    expect(events.filter((e) => e.type === 'progress' && e.message.startsWith('开始分析'))).toHaveLength(1);
    const busyErrors = events.filter((e): e is Extract<PipelineEvent, { type: 'error' }> => e.type === 'error');
    expect(busyErrors).toHaveLength(1);
    expect(busyErrors[0].error).toContain('上一次分析仍在进行中');

    // busy 拒绝:resolve(undefined),不抛
    expect(await p2).toBeUndefined();

    // 首次运行不受影响:完整事件流 + 报告
    const report = await p1;
    expect(report).toBeTruthy();
    expect(report!.final_decision).toBe('FINAL_REPORT');
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('progress');
    expect(types[types.length - 1]).toBe('done');
    // 第二个 pipeline 未启动:progress/error/done 各恰一条;token/roleStatus 全量
    expect(events.filter((e) => e.type === 'progress' && e.message.startsWith('开始分析'))).toHaveLength(1);
    expect(events.filter((e) => e.type === 'error')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'done')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'token')).toHaveLength(9);
    expect(events.filter((e) => e.type === 'roleStatus')).toHaveLength(18);
  });

  it('失败终态复位:首运行失败(error 事件)后,同 runner 复用正常(catch 路径复位)', async () => {
    const store = seededStore();
    const runner = createPipelineRunner(store);
    const events: PipelineEvent[] = [];
    runner.subscribe((e) => events.push(e));

    const badLlm = async () => {
      throw new Error('boom');
    };
    (badLlm as unknown as { invoke: unknown }).invoke = badLlm;

    const first = await runner.run('600036', { ...runOpts(), llm: badLlm });
    expect(first).toBeUndefined();
    const errs = events.filter((e) => e.type === 'error');
    expect(errs.length).toBeGreaterThan(0);
    expect(errs.some((e) => e.error.includes('boom'))).toBe(true);

    // catch 路径已复位 → 正常 run 从头执行:done + 无 error
    const second = await runner.run('600036', runOpts());
    expect(second).toBeTruthy();
    expect(second!.final_decision).toBe('FINAL_REPORT');
    const tail = events.filter((e) => e.type === 'error');
    expect(tail.some((e) => e.error.includes('进行中'))).toBe(false);
  });

  it('复位回归:一次完整运行后,后续 run 正常执行(无 busy 拒绝)', async () => {
    const store = seededStore();
    const runner = createPipelineRunner(store);
    const events: PipelineEvent[] = [];
    runner.subscribe((e) => events.push(e));

    const first = await runner.run('600036', runOpts());
    expect(first).toBeTruthy();
    expect(first!.final_decision).toBe('FINAL_REPORT');

    // done 路径已复位 → 第二次 run 从头正常执行:progress→…→done,无 error
    const n = events.length;
    const second = await runner.run('600036', runOpts());
    expect(second).toBeTruthy();
    expect(second!.final_decision).toBe('FINAL_REPORT');
    const tail = events.slice(n);
    expect(tail[0].type).toBe('progress');
    expect(tail[tail.length - 1].type).toBe('done');
    expect(tail.some((e) => e.type === 'error')).toBe(false);
  });
});
