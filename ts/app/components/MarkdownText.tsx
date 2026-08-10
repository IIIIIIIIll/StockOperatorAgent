// Markdown 渲染包装(react-native-markdown-display;RN 原生 + web 通用,
// 对齐 Python st.markdown 渲染 LLM 报告)。主题色驱动,暗/亮自动。
import React from 'react';
import { StyleSheet } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { useTheme, type Theme } from '../theme';

export default function MarkdownText({ content }: { content: string }) {
  const theme = useTheme();
  return <Markdown style={markdownStyles(theme)}>{content}</Markdown>;
}

function markdownStyles(theme: Theme) {
  const c = theme.colors;
  return StyleSheet.create({
    body: { color: c.text, fontSize: 13, lineHeight: 20 },
    heading1: { color: c.text, fontSize: 17, fontWeight: '700', marginTop: 10, marginBottom: 4 },
    heading2: { color: c.text, fontSize: 16, fontWeight: '700', marginTop: 10, marginBottom: 4 },
    heading3: { color: c.text, fontSize: 15, fontWeight: '600', marginTop: 8, marginBottom: 3 },
    heading4: { color: c.text, fontSize: 14, fontWeight: '600', marginTop: 6, marginBottom: 3 },
    strong: { color: c.text, fontWeight: '700' },
    em: { fontStyle: 'italic' },
    s: { textDecorationLine: 'line-through' },
    link: { color: c.primary, textDecorationLine: 'underline' },
    blockquote: { borderLeftWidth: 3, borderLeftColor: c.border, paddingLeft: 10, color: c.textSecondary },
    bullet_list_icon: { color: c.textSecondary },
    ordered_list_icon: { color: c.textSecondary },
    list_item: { marginVertical: 1 },
    code_inline: { fontFamily: 'monospace', backgroundColor: c.surface, color: c.text, fontSize: 12 },
    code_block: { fontFamily: 'monospace', backgroundColor: c.surface, color: c.text, fontSize: 12, padding: 8, borderRadius: 4 },
    fence: { fontFamily: 'monospace', backgroundColor: c.surface, color: c.text, padding: 8, borderRadius: 4 },
    table: { borderWidth: 1, borderColor: c.border, marginVertical: 6 },
    tableHeaderCell: { borderWidth: 1, borderColor: c.border, padding: 5, backgroundColor: c.surface, fontWeight: '700' },
    tableCell: { borderWidth: 1, borderColor: c.border, padding: 5 },
    hr: { backgroundColor: c.border, height: 1, marginVertical: 8 },
    paragraph: { marginVertical: 3 },
  });
}
