// 事件桥 runner 绑定 —— App 与业务层(ts/src)的唯一接线点
// 数据:演示模式载入 demo.json;真模式留注入点(真机走 TCP 采集)。
// LLM:三键齐(设置面板)→ 真 LLM;缺 → 演示 stub(图全链跑通)。
import { InMemoryStore } from '../../src/store-memory.ts';
import { createPipelineRunner, type PipelineEvent, type FinalReport } from '../../src/events.ts';
import { createLlm, MissingLlmConfigError, type LlmConfig } from '../../src/llm.ts';
import { AIMessage } from '@langchain/core/messages';
import demo from '../data/demo.json';

export const store = new InMemoryStore();

// 演示数据载入(600036:250 根日K + 指标 + F10)
export function loadDemoData(): void {
  store.putStock({
    ticker: demo.ticker,
    name: demo.name,
    overview: null,
    overviewLastUpdate: null,
    lastDataUpdate: demo.bars[demo.bars.length - 1].date,
  });
  store.addDatas(demo.ticker, demo.bars as never);
  store.setMeta('demo:f10', demo.f10_text);
}

export const runner = createPipelineRunner(store);

// ─── 设置持久化(web:localStorage;RN 真机后续接 AsyncStorage) ──────────────

const CFG_KEY = 'soa:llm-config';

export function readSavedConfig(): LlmConfig | null {
  try {
    const raw = globalThis.localStorage?.getItem(CFG_KEY);
    if (!raw) return null;
    const cfg = JSON.parse(raw) as LlmConfig;
    if (cfg.apiKey && cfg.model && cfg.baseUrl) return cfg;
    return null;
  } catch {
    return null;
  }
}

export function saveConfig(cfg: LlmConfig): void {
  try {
    globalThis.localStorage?.setItem(CFG_KEY, JSON.stringify(cfg));
  } catch {
    /* web 外无 localStorage */
  }
}

export function clearConfig(): void {
  try {
    globalThis.localStorage?.removeItem(CFG_KEY);
  } catch {
    /* noop */
  }
}

// ─── 演示 stub LLM(无三键时;按 system 消息路由角色) ─────────────────────

function demoLlm(): unknown {
  const fn = async (payload: unknown) => {
    const list = Array.isArray(payload)
      ? (payload as Array<{ _getType?: () => string; content?: unknown }>)
      : (((payload as { messages?: Array<{ _getType?: () => string; content?: unknown }> }).messages) ?? []);
    const sys = list.find((m) => m._getType?.() === 'system');
    const text = typeof sys?.content === 'string' ? sys.content : '';
    // 互斥独有短语(对齐 committee.test 路由约定)——经理消息开头含'投资经理',
    // 修订轮含'对抗修订轮',角色描述互不包含
    const PHRASES: Array<[string, string]> = [
      ['对抗修订轮的多方交易员', '看涨'],
      ['对抗修订轮的空方交易员', '看跌'],
      ['坚定看多的股票交易员', '看涨'],
      ['坚定看空的股票交易员', '看跌'],
      ['精于计算公司的基本面数据', '基本面'],
      ['给出高准确度的客观趋势分析', '趋势'],
      ['技术指标信号解读与择时判断', '指标'],
      ['整合公告、研报、新闻与推特', '信息面'],
      ['投资经理', '投资经理'],
    ];
    let tag = '占位';
    let tagIdx = text.length;
    for (const [phrase, label] of PHRASES) {
      const i = text.indexOf(phrase);
      if (i >= 0 && i < tagIdx) {
        tag = label;
        tagIdx = i;
      }
    }
    return new AIMessage({
      content: `[演示·${tag}] 演示模式报告:未配置 LLM 三键,本报告为占位文本。真实分析请在设置中填写 LLM_API_KEY/LLM_MODEL/LLM_BASE_URL 后重跑。`,
    });
  };
  (fn as unknown as { invoke: unknown }).invoke = fn;
  return fn;
}

export type { PipelineEvent, FinalReport, LlmConfig };

/** 执行分析:三键齐 → 真 LLM;缺 → 演示 stub。抛 MissingLlmConfigError 由调用方渲染。 */
export function buildLlm(cfg: LlmConfig | null): unknown {
  if (cfg) return createLlm(cfg);
  return demoLlm();
}

export function configError(cfg: LlmConfig | null): string | null {
  if (cfg) return null;
  return '未配置 LLM 三键——将使用演示占位报告。';
}
