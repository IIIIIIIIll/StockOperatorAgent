// 分析编排控制器(E1 可测化)单元测试 —— 假 runner(emit 事件)+ InMemoryStore
// 注入驱动(仿 events.test.ts 的 runner 测试模式;签名不设默认实现,全 deps 显式)。
// 覆盖:start 编排(runner.run 单次调用/参数正确、北交所拦截、市场归一文案、采集
// 失败短路)、lastRun 恢复(bootstrap)、事件归约(token/retry/report/done)、
// D9(运行中不清错误横幅)、D15(hasDone 生命周期)、C1 侧(失败不打印成功耗时)。
import { describe, expect, it } from 'vitest';
import { InMemoryStore } from '../src/store-memory.ts';
import { LAST_RUN_KEY } from '../src/lastRun.ts';
import { DEMO_F10_KEY } from '../src/metaKeys.ts';
import type { FinalReport, PipelineEvent, PipelineRunner, RunOptions } from '../src/events.ts';
import {
  AnalysisController,
  type AnalysisDeps,
  type AnalysisSnapshot,
} from '../app/lib/analysisController.ts';
import { defaultSettings, type SettingsState } from '../app/lib/settings.ts';

type RunnerImpl = (ticker: string, opts?: RunOptions) => Promise<FinalReport | undefined>;

// ─── 假实现 ─────────────────────────────────────────────────────────────────

/** 假 runner:记录 run 调用;测试用 emit(...) 驱动事件(对齐真实 createPipelineRunner
 *  的 subscribe/run 面)。impl 可替换(run 默认 resolve undefined = 失败终态语义)。 */
function makeFakeRunner(impl?: RunnerImpl) {
  const listeners = new Set<(e: PipelineEvent) => void>();
  const runs: Array<{ ticker: string; opts?: RunOptions }> = [];
  const fake: PipelineRunner & {
    runs: typeof runs;
    emit(e: PipelineEvent): void;
    listenerCount(): number;
  } = {
    runs,
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    async run(ticker, opts) {
      runs.push({ ticker, opts });
      return impl ? impl(ticker, opts) : undefined;
    },
    emit(e) {
      for (const fn of [...listeners]) fn(e);
    },
    listenerCount() {
      return listeners.size;
    },
  };
  return fake;
}

/** 日志捕获(deps.log 注入面)。 */
interface LogCapture {
  info: string[];
  warn: string[];
  error: string[];
}

function makeHarness(
  opts: {
    settings?: SettingsState;
    runnerImpl?: RunnerImpl;
    overrides?: Partial<AnalysisDeps>;
  } = {},
) {
  const store = new InMemoryStore();
  const runner = makeFakeRunner(opts.runnerImpl);
  const log: LogCapture = { info: [], warn: [], error: [] };
  const collectCalls: Array<{ ticker: string; market: string; finnhub: { apiKey: string } | null }> = [];
  const keepAlive = { starts: [] as Array<[string, string]>, stops: 0 };
  let demoLoaded = 0;
  const deps: AnalysisDeps = {
    store,
    runner,
    platform: 'native',
    storeReady: async () => {},
    loadDemoData: () => {
      demoLoaded += 1;
    },
    loadSettings: () => opts.settings ?? defaultSettings(),
    saveSettings: () => {},
    applyCapabilitySwitches: () => {},
    buildLlm: () => ({ stub: 'llm' }),
    collect: async (ticker, market, finnhub) => {
      collectCalls.push({ ticker, market, finnhub });
      return {
        f10Text: '【主要财务指标】\n净资产收益率: 15.2',
        snapshot: { price: 38.8, high: 39.1, low: 38.48, open: 38.9, volume: 10000, amount: 380000 },
        name: '测试股',
        capital: null,
      };
    },
    fetchIntel: async () => ({}),
    makeBillionsClient: () => undefined,
    assembleTools: () => [],
    keepAliveStart: (title, body) => {
      keepAlive.starts.push([title, body]);
    },
    stopKeepAlive: () => {
      keepAlive.stops += 1;
    },
    log: {
      info: (m) => log.info.push(m),
      warn: (m) => log.warn.push(m),
      error: (m) => log.error.push(m),
    },
    nowMs: (() => {
      let t = 1_000_000;
      return () => (t += 1000);
    })(),
    isoNow: () => '2026-08-23T08:00:00.000Z',
    ...opts.overrides,
  };
  const ctrl = new AnalysisController(deps);
  let snap: AnalysisSnapshot = ctrl.snapshot();
  ctrl.subscribe((s) => {
    snap = s;
  });
  return {
    store,
    runner,
    log,
    ctrl,
    keepAlive,
    collectCalls,
    demoLoaded: () => demoLoaded,
    snap: () => snap,
  };
}

function makeReport(over: Partial<FinalReport> = {}): FinalReport {
  return {
    ticker: '600036',
    stock_information: '【采集数据】600036 测试股',
    final_decision: '持有观察',
    opinions: [{ key: 'fundamental_analysis', tabTitle: '基本面分析', content: 'FUND_REPORT' }],
    ...over,
  };
}

// ─── bootstrap:lastRun 恢复 / 演示上下文 / 就绪失败 ────────────────────────

describe('AnalysisController.bootstrap', () => {
  it('store 有 lastRun → 恢复 ticker/报告事件/chips/market 反推/标记', async () => {
    const h = makeHarness();
    const record = {
      ticker: '0700.HK',
      stock_information: '【采集数据】腾讯',
      final_decision: '持有',
      opinions: [
        { key: 'bullish_opinions', tabTitle: '看涨观点', content: 'BULL' },
        { key: 'bearish_opinions', tabTitle: '看跌观点', content: 'BEAR' },
      ],
      at: '2026-08-22T10:00:00.000Z',
      mode: 'real' as const,
    };
    h.store.setMeta(LAST_RUN_KEY, JSON.stringify(record));

    await h.ctrl.bootstrap();

    const s = h.snap();
    expect(s.lastRunTicker).toBe('0700.HK');
    expect(s.stockInformation).toBe('【采集数据】腾讯');
    expect(s.finalDecision).toBe('持有');
    // opinions → report 事件(App progress 派生不受影响;无 progress 型事件)
    expect(s.events.map((e) => e.type)).toEqual(['report', 'report']);
    expect(s.events[0]).toMatchObject({ type: 'report', key: 'bullish_opinions' });
    // 状态 chips:trader 角色初稿+修订节点均 done;经理非空 final_decision → done
    expect(s.statuses).toEqual({
      bullish_trader: 'done',
      bullish_revise: 'done',
      bearish_trader: 'done',
      bearish_revise: 'done',
      investment_manager: 'done',
    });
    // 恢复路径按 store 键反推市场(hk),不停留默认 cn
    expect(s.market).toBe('hk');
    expect(s.lastRunAt).toEqual({ at: '2026-08-22T10:00:00.000Z', mode: 'real' });
    expect(s.dataVersion).toBe(1);
    expect(h.demoLoaded()).toBe(1); // 有缓存也先无条件载 demo(空库守卫在 runner 层)
  });

  it('无缓存 → 演示上下文生成 + 设置加载', async () => {
    const h = makeHarness();
    h.store.setMeta(DEMO_F10_KEY, '【主要财务指标】\n净资产收益率: 15.2');

    await h.ctrl.bootstrap();

    const s = h.snap();
    expect(s.lastRunTicker).toBe('600036'); // 默认 demo 票
    expect(s.market).toBe('cn');
    expect(typeof s.stockInformation).toBe('string');
    expect(s.stockInformation.length).toBeGreaterThan(0);
    expect(s.settings).toEqual(defaultSettings());
    expect(s.dataVersion).toBe(1);
    expect(h.log.info.some((m) => m.includes('演示数据载入'))).toBe(true);
  });

  it('storeReady 失败 → 错误态并中止启动链(不载 demo/dataVersion 不动)', async () => {
    const h = makeHarness({
      overrides: {
        storeReady: async () => {
          throw new Error('IndexedDB 打不开');
        },
      },
    });

    await h.ctrl.bootstrap();

    expect(h.snap().error).toBe('IndexedDB 打不开');
    expect(h.demoLoaded()).toBe(0);
    expect(h.snap().dataVersion).toBe(0);
  });
});

// ─── start(ticker, market) 编排 ─────────────────────────────────────────────

describe('AnalysisController.start 编排', () => {
  it('调 runner.run 一次:ticker 归一化 + run 参数正确 + 状态收尾', async () => {
    const h = makeHarness({
      runnerImpl: async () => makeReport(),
    });

    await h.ctrl.start(' 600036 ', 'cn'); // 首尾空白由 trim 归一

    expect(h.runner.runs).toHaveLength(1);
    const { ticker, opts } = h.runner.runs[0];
    expect(ticker).toBe('600036');
    expect(opts?.market).toBe('cn');
    expect(opts?.llm).toEqual({ stub: 'llm' }); // 未配三键 → buildLlm(null) 分支产物
    expect(Array.isArray(opts?.tools)).toBe(true);
    expect(opts?.today).toBe('2026-08-23');
    expect(opts?.name).toBe('测试股');
    expect(opts?.f10Text).toContain('主要财务指标');
    expect(opts?.snapshot).toEqual({ price: 38.8, high: 39.1, low: 38.48, open: 38.9, volume: 10000, amount: 380000 });
    // 采集以归一化后 ticker 调用一次;lastRunTicker 跟随
    expect(h.collectCalls).toHaveLength(1);
    expect(h.collectCalls[0].ticker).toBe('600036');
    expect(h.collectCalls[0].finnhub).toBeNull(); // 非 us → 无 finnhub
    expect(h.snap().lastRunTicker).toBe('600036');
    // 保活成对启停;running 复位;成功路径打印耗时(C1 侧)
    expect(h.keepAlive.starts).toEqual([['正在分析 600036', 'AI 分析进行中,可切到后台等待完成']]);
    expect(h.keepAlive.stops).toBe(1);
    expect(h.snap().running).toBe(false);
    expect(h.log.info.some((m) => m.startsWith('分析结束:耗时'))).toBe(true);
  });

  it('us + finnhub key → collect 收到非空 finnhub 参数(空白 trim 后)', async () => {
    const settings = defaultSettings();
    settings.keys.finnhubApiKey = '  fh_key_aapl  ';
    const h = makeHarness({ settings });

    await h.ctrl.start('aapl', 'us');

    expect(h.collectCalls).toHaveLength(1);
    expect(h.collectCalls[0].market).toBe('us');
    // 仅美股增强:key 非空才传,且以 trim 后形态传入(空白不随行)
    expect(h.collectCalls[0].finnhub).toEqual({ apiKey: 'fh_key_aapl' });
  });

  it('us 无 finnhub key → collect 收到 null(零网络对照)', async () => {
    const h = makeHarness(); // 默认 settings:finnhubApiKey 为空串

    await h.ctrl.start('AAPL', 'us');

    expect(h.collectCalls[0].market).toBe('us');
    expect(h.collectCalls[0].finnhub).toBeNull();
  });

  it('北交所代码拦截:逐字文案,不发起采集与 runner.run', async () => {
    const h = makeHarness();

    await h.ctrl.start('830799', 'cn');

    expect(h.snap().error).toBe('北交所(BJ)股票暂不支持分析:TDX 数据源不覆盖 BJ 证券,请使用沪深 A 股代码');
    expect(h.collectCalls).toHaveLength(0);
    expect(h.runner.runs).toHaveLength(0);
    expect(h.keepAlive.starts).toHaveLength(0);
    expect(h.snap().running).toBe(false);
  });

  it('市场格式不符 → 按所选市场定制文案,不发起分析', async () => {
    const h = makeHarness();

    await h.ctrl.start('123456', 'hk');

    expect(h.snap().error).toBe('请输入有效的港股代码：一至五位数字');
    expect(h.runner.runs).toHaveLength(0);
  });

  it('采集失败 → 行情采集失败横幅短路:不调 runner.run,running 复位,无成功耗时', async () => {
    const h = makeHarness({
      overrides: {
        collect: async () => {
          throw new Error('连接超时');
        },
      },
    });

    await h.ctrl.start('600036', 'cn');

    expect(h.snap().error).toBe('行情采集失败:连接超时');
    expect(h.runner.runs).toHaveLength(0);
    expect(h.keepAlive.stops).toBe(1);
    expect(h.snap().running).toBe(false);
    expect(h.log.info.some((m) => m.startsWith('分析结束:耗时'))).toBe(false);
  });

  it('runner 失败(emit error + resolve undefined)→ 错误态 + hasDone=false + 不打印成功耗时', async () => {
    const report = makeReport();
    const h = makeHarness({
      runnerImpl: async () => {
        // U1 契约:runner 以 error 事件上报后 resolve(undefined),本身不抛。
        // 先发 progress+done 再失败,验证 done 后的 error 终态覆盖(hasDone 撤销)。
        h.runner.emit({ type: 'progress', message: '开始分析 600036...' });
        h.runner.emit({ type: 'done', report });
        h.runner.emit({ type: 'error', error: 'LLM 重试耗尽:429' });
        return undefined;
      },
    });

    await h.ctrl.start('600036', 'cn');

    expect(h.snap().error).toBe('LLM 重试耗尽:429');
    expect(h.snap().hasDone).toBe(false); // D15:error 终态撤销 done 标记
    expect(h.log.error).toContain('LLM 重试耗尽:429'); // error 事件监听的日志面
    expect(h.log.info.some((m) => m.startsWith('分析结束:耗时'))).toBe(false); // C1 侧
  });

  it('成功路径(done 事件 + resolve 报告)→ 打印耗时 + hasDone=true + lastRun 写缓存', async () => {
    const report = makeReport();
    const h = makeHarness({
      runnerImpl: async () => {
        h.runner.emit({
          type: 'roleStatus',
          roleKey: 'fundamental_analysis',
          node: 'fundamental_analysis_expert',
          status: 'running',
        });
        h.runner.emit({ type: 'done', report });
        return report;
      },
    });

    await h.ctrl.start('600036', 'cn');

    const s = h.snap();
    expect(s.hasDone).toBe(true);
    expect(s.finalDecision).toBe('持有观察');
    expect(s.stockInformation).toBe(report.stock_information);
    expect(s.statuses.fundamental_analysis_expert).toBe('running');
    expect(s.lastRunAt).toEqual({ at: '2026-08-23T08:00:00.000Z', mode: 'demo' }); // 未配三键 → demo 模式
    expect(h.log.info.some((m) => m.startsWith('分析结束:耗时'))).toBe(true);
    // done → saveLastRun(store meta)
    const raw = h.store.getMeta(LAST_RUN_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).final_decision).toBe('持有观察');
  });
});

// ─── runner 事件归约(token/retry/report)─────────────────────────────────────

describe('AnalysisController 事件归约', () => {
  it('token 追加 partial / retry 清空该节点 / report 清空启用角色双节点', () => {
    const h = makeHarness();
    h.runner.emit({ type: 'token', roleKey: 'fundamental_analysis', node: 'fundamental_analysis_expert', delta: '部分' });
    h.runner.emit({ type: 'token', roleKey: 'fundamental_analysis', node: 'fundamental_analysis_expert', delta: '文本' });
    expect(h.snap().partials.fundamental_analysis_expert).toBe('部分文本');

    h.runner.emit({ type: 'roleStatus', roleKey: 'fundamental_analysis', node: 'fundamental_analysis_expert', status: 'retry' });
    expect(h.snap().partials.fundamental_analysis_expert).toBe('');
    expect(h.snap().statuses.fundamental_analysis_expert).toBe('retry');

    // opinion 角色(reviseNodeName 存在):report 到达清初稿+修订两节点 partial
    h.runner.emit({ type: 'token', roleKey: 'bullish_opinions', node: 'bullish_trader', delta: '初稿流' });
    h.runner.emit({ type: 'token', roleKey: 'bullish_opinions', node: 'bullish_revise', delta: '修订流' });
    h.runner.emit({ type: 'report', key: 'bullish_opinions', tabTitle: '看涨观点', content: 'BULL_FINAL' });
    expect(h.snap().partials.bullish_trader).toBeUndefined();
    expect(h.snap().partials.bullish_revise).toBeUndefined();
    expect(h.snap().events).toHaveLength(6); // 每事件都追加
  });
});

// ─── D9:onSettingsChange 运行中保留错误横幅 ─────────────────────────────────

describe('AnalysisController.onSettingsChange(D9)', () => {
  it('运行中设置变更不清错误横幅;空闲时清空(既有行为保留)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const entered = Promise.withResolvers<void>();
    const h = makeHarness({
      runnerImpl: async () => {
        entered.resolve(); // 确定性信号:start 已推进到 runner.run 内部
        await gate; // 挂起,维持 running=true
        return undefined;
      },
    });
    const p = h.ctrl.start('600036', 'cn');
    await entered.promise;
    expect(h.snap().running).toBe(true);

    // 运行中错误信号到达(busy/失败语义),随后编辑设置
    h.runner.emit({ type: 'error', error: '运行中错误' });
    expect(h.snap().error).toBe('运行中错误');
    h.ctrl.onSettingsChange(defaultSettings());
    expect(h.snap().error).toBe('运行中错误'); // D9:保留横幅
    expect(h.snap().settings).toEqual(defaultSettings()); // 设置本身照常生效

    release();
    await p;
    expect(h.snap().running).toBe(false);

    // 空闲态:设置变更清空错误(抽取前既有行为)
    h.runner.emit({ type: 'error', error: '历史错误' });
    expect(h.snap().error).toBe('历史错误');
    h.ctrl.onSettingsChange(defaultSettings());
    expect(h.snap().error).toBeNull();
  });
});

// ─── D15:hasDone 生命周期 ────────────────────────────────────────────────────

describe('AnalysisController.hasDone(D15)', () => {
  it('初始 false;start 即撤销;done 置 true;后续 error 再置 false', async () => {
    let phase = 0;
    const report = makeReport();
    const h = makeHarness({
      runnerImpl: async () => {
        if (phase === 0) {
          h.runner.emit({ type: 'done', report });
          return report;
        }
        h.runner.emit({ type: 'error', error: '第二次失败' });
        return undefined;
      },
    });
    expect(h.snap().hasDone).toBe(false);

    await h.ctrl.start('600036', 'cn');
    expect(h.snap().hasDone).toBe(true); // done → true

    phase = 1;
    await h.ctrl.start('600036', 'cn');
    expect(h.snap().hasDone).toBe(false); // 第二次 start 重置,error 终态保持 false
    expect(h.snap().lastRunAt).toBeNull(); // R4:error 不写缓存,标记被 start 清除
  });
});
