// 节点内工具调用循环 —— 移植自 Python core/llms/tool_loop.py
// 契约：≤15 轮；LLM 返回带 tool_calls → 执行工具 → ToolMessage 回流；
// 轮数耗尽且仍在要工具 → 追加"收尾轮"（强约束不再调用；若仍要工具或内容
// 为空 → 两态占位兜底,不执行该轮工具——AL2）；未知工具占位；
// 工具异常 → 占位不 raise（图不中断）；空 tools → 单轮直调
// 08-11-ts-streaming-output:每轮(含收尾轮)改 streamWithRetry 流式;轮末
// tool_calls 非空 → onReset(回滚该轮已流出文本,UI 清 partial)。
import { AIMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { invokeWithRetry, streamWithRetry, type StreamableLlm } from './retry.ts';
import { safeProgress, type ProgressUpdater } from './progress.ts';
import { error, warn } from './log.ts';

export const MAX_TOOL_ROUNDS = 15;

const FINAL_ROUND_INSTRUCTION =
  '工具调用轮数已用尽。请基于以上全部信息（包括联网搜索结果）直接给出完整、明确的最终回答，不要再调用任何工具。';

export interface ToolLike {
  name: string;
  invoke(args: Record<string, unknown>): unknown;
  /** JSON Schema(OpenAI function parameters 形态;bindTools 序列化用,可选——现有 fake/调用方零改动)。 */
  schema?: Record<string, unknown>;
  /** OpenAI function description(bindTools 序列化用,可选)。 */
  description?: string;
}

export interface InvokeWithToolsOptions {
  tools: ToolLike[];
  maxToolRounds?: number;
  progressUpdater?: ProgressUpdater | null;
  /** 每轮文本增量(逐 chunk 透传;UI 按 token 序追加)。 */
  onDelta?: (delta: string) => void;
  /** 每轮 LLM 重试(退避前回调;调用方转 roleStatus 'retry' 复位)。 */
  onRetry?: (attempt: number, err: unknown) => void;
  /** 轮末 tool_calls 非空 → 回滚该轮已流出文本(调用方经 'retry' 通道清 partial)。 */
  onReset?: () => void;
}

export type LlmCallable =
  | {
      invoke(payload: unknown, config?: unknown): Promise<{ content: unknown }>;
      stream?(payload: unknown, config?: unknown): Promise<AsyncIterable<unknown>> | AsyncIterable<unknown>;
    }
  | ((payload: unknown, config?: unknown) => Promise<{ content: unknown }>);

/** 收尾轮非合规两态占位文案(AL2;agents.ts 空串守卫复用同一单源)。 */
export const EXHAUSTED_NO_ANSWER_TEXT = '搜索轮数已用尽，未能生成最终回答';
export const NO_CONCLUSION_TEXT = '（本轮未产出结论）';

/** invokeWithTools 结果:response 是对外结论载体(content 恒可用——收尾轮非合规
 *  时已替换为占位文案);messages 是真实对话轨迹(真实消息实例,LangGraph 消息
 *  coercion 依赖,不做占位改写)。 */
export interface InvokeWithToolsResult {
  response: { content: unknown };
  messages: Array<[string, string] | BaseMessage>;
  /** AL2 兜底标记:'tool_calls'=收尾轮仍请求工具;'empty'=内容为空(trim 归一);
   *  null=正常结束(轮内自然终止/空 tools 直调/合规收尾)。 */
  closingFallback: 'tool_calls' | 'empty' | null;
}

export async function invokeWithTools(
  llm: LlmCallable,
  query: string,
  config: unknown,
  { tools, maxToolRounds = MAX_TOOL_ROUNDS, progressUpdater, onDelta, onRetry, onReset }: InvokeWithToolsOptions,
): Promise<InvokeWithToolsResult> {
  // Python 以 ("human", query) tuple 起始；后续追加 AIMessage/ToolMessage 对象
  const messages: Array<[string, string] | BaseMessage> = [['human', query]];
  let response: { content: string; tool_calls?: unknown } | null = null;

  /** 单轮 LLM 调用:有 .stream() → streamWithRetry(逐 chunk onDelta);
   *  无 .stream()(离线测试脚本式假件)→ invokeWithRetry + 单次全量 delta。 */
  const roundCall = async (payload: unknown): Promise<{ content: unknown; tool_calls?: unknown }> => {
    const streamable = (llm as { stream?: StreamableLlm['stream'] }).stream;
    if (typeof streamable === 'function') {
      return streamWithRetry(llm as StreamableLlm, payload, config, { onDelta, onRetry });
    }
    const out = (await invokeWithRetry(llm, payload, config)) as { content: unknown; tool_calls?: unknown };
    const text = typeof out.content === 'string' ? out.content : String(out.content);
    if (text) onDelta?.(text);
    return out;
  };

  for (let round = 0; round < maxToolRounds; round++) {
    response = (await roundCall({ query: messages })) as { content: string; tool_calls?: unknown };
    const toolCalls = response.tool_calls as
      | Array<{ name: string; args: Record<string, unknown>; id: string }>
      | undefined;
    const finalContent = typeof response.content === 'string' ? response.content : String(response.content);
    if (!toolCalls?.length) {
      void finalContent;
      return { response, messages: [...messages, response as BaseMessage], closingFallback: null };
    }
    // 轮末 tool_calls 非空 → 回滚该轮已流出文本(经 roleStatus 'retry' 通道清 partial);
    // 先 warn 记录原因(轮次 + 该轮全部工具名,逗号连接),对齐 retry warn 可读性
    const toolNames = toolCalls.map((c) => c.name).join(', ');
    warn(`工具轮 ${round + 1}:模型请求工具 ${toolNames},回滚该轮中间文本`);
    onReset?.();
    safeProgress(progressUpdater, '正在联网搜索。。。');
    messages.push(response as BaseMessage);
    const toolByName = new Map(tools.map((t) => [t.name, t]));
    for (const call of toolCalls) {
      const tool = toolByName.get(call.name);
      let content: unknown;
      if (!tool) {
        content = `（未找到工具 ${call.name}）`;
      } else {
        try {
          // 工具 invoke 可为 async(如 web_search 的 fetch searcher)——必须 await,
          // 否则 Promise 未解包直接 String() 成 "[object Promise]";rejection 同样
          // 在此 catch(异步工具异常 → 占位不 raise,对齐 Python try/except 语义)。
          content = await tool.invoke(call.args);
          if (Array.isArray(content)) content = content[0]; // content_and_artifact 形态
        } catch (err) {
          content = `（联网搜索失败：${(err as Error).message}）`;
        }
      }
      messages.push(new ToolMessage({ content: String(content), tool_call_id: call.id }));
    }
    safeProgress(progressUpdater, '联网搜索完成。。。');
  }

  // 轮数耗尽且模型仍在要工具：追加收尾轮（有界 +1 次 LLM 调用,同样流式）。
  // 收尾轮不执行任何工具——执行会突破「+1 次」上界(整改审计否决)。模型不服从
  // 强约束(仍返 tool_calls)或交白卷(content 经 String().trim() 归一后为空,
  // 覆盖空白串/非字符串形态)→ 两态占位兜底(AL2):error 先记录再降级,onReset
  // 清该轮已流出文本('retry' 通道),以占位 content 替代 response(messages
  // 保持真实轨迹),closingFallback 标记供调用方调整 roleStatus(agents.ts
  // 非合规终态不再无条件标 'done')。
  if (response !== null && ((response as { tool_calls?: Array<unknown> }).tool_calls?.length ?? 0) > 0) {
    safeProgress(progressUpdater, '搜索轮数已用尽，正在整理最终回答。。。');
    messages.push(['human', FINAL_ROUND_INSTRUCTION]);
    const final = await roundCall({ query: messages });
    const finalToolCalls = final.tool_calls as Array<{ name: string }> | undefined;
    const finalText = typeof final.content === 'string' ? final.content : String(final.content ?? '');
    const disobeyed = (finalToolCalls?.length ?? 0) > 0;
    const names = (finalToolCalls ?? []).map((c) => c.name).join(', ');
    if (disobeyed || !finalText.trim()) {
      error(
        `收尾轮未产出最终回答(${disobeyed ? `仍请求工具:${names}` : '内容为空'}),已以占位文案兜底`,
      );
      onReset?.();
      return {
        response: { content: disobeyed ? EXHAUSTED_NO_ANSWER_TEXT : NO_CONCLUSION_TEXT },
        messages: [...messages, final as BaseMessage],
        closingFallback: disobeyed ? 'tool_calls' : 'empty',
      };
    }
    return { response: final, messages: [...messages, final as BaseMessage], closingFallback: null };
  }
  return { response: response as { content: string }, messages, closingFallback: null };
}
