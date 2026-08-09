import { describe, expect, it } from 'vitest';
import { decodeDdgUrl, decodeEntities, parseDdgHtml, stripTags } from '../src/webSearch.ts';

const SAMPLE_HTML = `
<div class="result results_links results_links_deep web-result ">
  <div class="links_main links_deep result__body">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fnews%3Fid%3D1">招商银行 &amp; 业绩</a>
    </h2>
    <a class="result__snippet" href="//duckduckgo.com/l/?uddg=...">净利润 <b>增长 10%</b>，营收创纪录</a>
  </div>
</div>
<div class="result results_links results_links_deep web-result ">
  <h2 class="result__title">
    <a rel="nofollow" class="result__a" href="https://plain.example/2">第二条结果</a>
  </h2>
  <a class="result__snippet" href="...">摘要二</a>
</div>
`;

describe('DDG html 解析(免 key 联网搜索,对齐 Python ddgs)', () => {
  it('提取标题/链接/摘要;实体与标签清理', () => {
    const results = parseDdgHtml(SAMPLE_HTML);
    expect(results).toHaveLength(2);
    expect(results[0].title).toBe('招商银行 & 业绩'); // &amp; 解码
    expect(results[0].link).toBe('https://example.com/news?id=1'); // uddg 解码
    expect(results[0].snippet).toBe('净利润 增长 10%，营收创纪录'); // <b> 剥离
    expect(results[1].link).toBe('https://plain.example/2');
  });

  it('空 HTML → 空数组', () => {
    expect(parseDdgHtml('<html><body></body></html>')).toHaveLength(0);
    expect(parseDdgHtml('')).toHaveLength(0);
  });

  it('无 snippet 的条目 → 空摘要', () => {
    const html = '<a class="result__a" href="https://x/1">标题</a>';
    expect(parseDdgHtml(html)[0].snippet).toBe('');
  });
});

describe('HTML 工具', () => {
  it('decodeEntities 覆盖常见实体', () => {
    expect(decodeEntities('a &amp; b &lt;c&gt; &quot;q&quot; &#39;x&#39;')).toBe('a & b <c> "q" \'x\'');
  });

  it('stripTags 剥标签 + 归一空白', () => {
    expect(stripTags('<b>净</b>利<i>润</i>  增长')).toBe('净利润 增长');
    expect(stripTags('<b>净</b> 利 <i>润</i>')).toBe('净 利 润'); // 原文空格保留
  });

  it('decodeDdgUrl 解析 uddg 重定向;普通 URL 原样', () => {
    expect(decodeDdgUrl('//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.com%2Fp%3Fx%3D1%26y%3D2')).toBe('https://a.com/p?x=1&y=2');
    expect(decodeDdgUrl('https://plain.example/2')).toBe('https://plain.example/2');
  });
});
