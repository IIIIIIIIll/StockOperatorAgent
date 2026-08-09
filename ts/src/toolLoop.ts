// 节点内工具调用循环 —— 移植自 Python core/llms/tool_loop.py
// 契约：≤15 轮；LLM 返回带 tool_calls → 执行工具 → ToolMessage 回流；
// 轮数耗尽且仍在要工具 → 追加"收尾轮"（强约束不再调用）；未知工具占位；
// 工具异常 → 占位不 raise（图不中断）；空 tools → 单轮直调
import { AIMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { invokeWithRetry } from './retry';
import { safeProgress, type ProgressUpdater } from './progress';

export const MAX_TOOL_ROUNDS = 15;

const FINAL_ROUND_INSTRUCTION =
  '工具调用轮数已用尽。请基于以上全部信息（包括联网搜索结果）直接给出完整、明确的最终回答，不要再调用任何工具。';

export interface ToolLike {
  name: string;
  invoke(args: Record<string, unknown>): unknown;
}

export interface InvokeWithToolsOptions {
  tools: ToolLike[];
  maxToolRounds?: number;
  progressUpdater?: ProgressUpdater | null;
}

export type LlmCallable =
  | { invoke(payload: unknown, config?: unknown): Promise<{ content: unknown }> }
  | ((payload: unknown, config?: unknown) => Promise<{ content: unknown }>);

export async function invokeWithTools(
  llm: LlmCallable,
  query: string,
  config: unknown,
  { tools, maxToolRounds = MAX_TOOL_ROUNDS, progressUpdater }: InvokeWithToolsOptions,
): Promise<{ response: { content: unknown }; messages: Array<[string, string] | BaseMessage> }> {
  // Python 以 ("human", query) tuple 起始；后续追加 AIMessage/ToolMessage 对象
  const messages: Array<[string, string] | BaseMessage> = [['human', query]];
  let response: { content: string; tool_calls?: unknown } | null = null;

  for (let round = 0; round < maxToolRounds; round++) {
    response = (await invokeWithRetry(llm, { query: messages }, config)) as {
      content: string;
      tool_calls?: unknown;
    };
    const toolCalls = (response as { tool_calls?: Array<{ name: string; args: Record<string, unknown>; id: string }> })
      .tool_calls;
    const finalContent = typeof response.content === 'string' ? response.content : String(response.content);
    if (!toolCalls?.length) {
      void finalContent;
      return { response, messages: [...messages, response as BaseMessage] };
    }
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
          content = tool.invoke(call.args);
          if (Array.isArray(content)) content = content[0]; // content_and_artifact 形态
        } catch (err) {
          content = `（联网搜索失败：${(err as Error).message}）`;
        }
      }
      messages.push(new ToolMessage({ content: String(content), tool_call_id: call.id }));
    }
    safeProgress(progressUpdater, '联网搜索完成。。。');
  }

  // 轮数耗尽且模型仍在要工具：追加收尾轮（有界 +1 次 LLM 调用）
  if (response !== null && ((response as { tool_calls?: Array<unknown> }).tool_calls?.length ?? 0) > 0) {
    safeProgress(progressUpdater, '搜索轮数已用尽，正在整理最终回答。。。');
    messages.push(['human', FINAL_ROUND_INSTRUCTION]);
    const final = (await invokeWithRetry(llm, { query: messages }, config)) as {
      content: string;
    };
    return { response: final, messages: [...messages, final as BaseMessage] };
  }
  return { response: response as { content: string }, messages };
}
