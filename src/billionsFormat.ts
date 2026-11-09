// 亿信(search / twitter)响应 → Markdown 片段的单源格式化层。
//
// 为什么单独成文件(P3,评审 2026-11-09):这三段逻辑此前在两处各存一份 ——
// src/billionsTools.ts(工具侧,有单测)与 src/agents.ts(信息面分析师的预抓路径),
// 且已经双向分叉:
//   - agents 版对非数组 result 返回 []，billionsTools 版会直接抛;
//   - billionsTools 版拒收数组型 entry/item，agents 版会收;
//   - date 判断一处用真值、一处用 `!== undefined/null/''`。
// 抽到这里后两处共用同一份"最保守"的实现(所有守卫取并集),避免改一处漏一处。
//
// 字段契约(对齐 Python billions_search._format_item / billions_twitter._format_tweet):
//   search: title / link / snippet(≤500) / date(YYYY-MM-DD 可空)
//           / extra{institution(仅 report), doc_id(仅 announcement)}
//   tweet : title("@user: 正文预览") / link / snippet(正文) / date
//           / extra{username, view_count, post_id, ...}
// 字段允许缺失,脏条目跳过(返回 null)。

/** 响应体 result[].content[] → 扁平条目数组。
 *  取两版守卫的并集:非数组 result → [];数组型 entry / item 一律跳过。 */
export function collectContentItems(data: Record<string, unknown>): Array<Record<string, unknown>> {
  const items: Array<Record<string, unknown>> = [];
  const result = data.result;
  if (!Array.isArray(result)) return items;
  for (const entry of result) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const content = (entry as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const item of content) {
      if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
        items.push(item as Record<string, unknown>);
      }
    }
  }
  return items;
}

function _extra(item: Record<string, unknown>): Record<string, unknown> {
  const e = item.extra;
  return typeof e === 'object' && e !== null && !Array.isArray(e) ? (e as Record<string, unknown>) : {};
}

function _str(v: unknown): string {
  return v === undefined || v === null ? '' : String(v);
}

/** 单条检索结果 → Markdown 行;无有效字段(无标题且无链接)→ null。 */
export function formatSearchItem(item: Record<string, unknown>): string | null {
  const title = _str(item.title);
  const link = _str(item.link);
  if (!(title || link)) return null;
  const extra = _extra(item);
  const parts: string[] = [];
  if (title && link) parts.push(`[${title}](${link})`);
  else if (link) parts.push(link);
  else parts.push(title);
  const date = _str(item.date);
  if (date) parts.push(date);
  if (extra.institution) parts.push(String(extra.institution)); // 研报机构名
  if (extra.doc_id) parts.push(`doc_id: ${extra.doc_id}`); // 公告全文 id
  let line = parts.join(' — ');
  if (item.snippet) line += `(${item.snippet})`;
  return `- ${line}`;
}

/** 单条推文 → Markdown 行;无正文 → null。
 *  title 形如 "@user: 正文预览" —— extra.username 缺失时取 @ 前缀兜底。 */
export function formatTweetItem(item: Record<string, unknown>): string | null {
  const snippet = _str(item.snippet);
  if (!snippet) return null;
  const extra = _extra(item);
  let username = _str(extra.username);
  if (!username) {
    const title = _str(item.title);
    // split 结果首段必然存在(split 至少返回一项),取 [0] 前后都不为空
    const head = title.split(':', 1)[0];
    if (title.startsWith('@') && head) username = head;
  }
  if (username && !username.startsWith('@')) username = `@${username}`;
  const parts: string[] = [];
  if (username) parts.push(username);
  if (extra.view_count !== undefined && extra.view_count !== null) parts.push(`${extra.view_count} 次浏览`);
  const date = _str(item.date);
  if (date) parts.push(date);
  let line = `${parts.join(' — ')} — ${snippet}`;
  if (item.link) line += ` [${item.link}]`;
  return `- ${line}`;
}
