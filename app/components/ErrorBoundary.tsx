// 内容区渲染错误边界(N-3,08-29-full-golive-review)——DataScreen/ReportContent
// 渲染崩溃(LLM markdown / 图表等)不再卸载整棵 App 树:仅内容区降级为错误卡,
// 提供「重试」重挂载子树(子组件先前状态已随崩溃丢弃,重试即全新渲染)。
// 类组件不能调用 hook(useTheme),主题经 props 注入(AppContent 已持有 theme)。
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { error as logError } from '../../src/log.ts';
import type { Theme } from '../theme';

interface Props {
  theme: Theme;
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // 全端日志统一经 src/log.ts(web 上报 /logs 汇聚;禁 console 直出)
    const detail = error instanceof Error ? error.message : String(error);
    const frame = info.componentStack?.split('\n').find((l) => l.trim())?.trim() ?? '';
    logError(`内容区渲染崩溃:${detail}${frame ? ` @ ${frame}` : ''}`);
  }

  private handleRetry = (): void => {
    this.setState({ error: null });
  };

  render() {
    const { theme, children } = this.props;
    const { error } = this.state;
    if (error) {
      const styles = makeStyles(theme);
      return (
        <View style={styles.container}>
          <Text style={styles.title}>内容渲染出错</Text>
          <Text style={styles.message}>{error instanceof Error ? error.message : String(error)}</Text>
          <Pressable style={styles.retry} onPress={this.handleRetry} accessibilityRole="button">
            <Text style={styles.retryText}>重试</Text>
          </Pressable>
        </View>
      );
    }
    return children;
  }
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
      alignItems: 'center',
      justifyContent: 'center',
      padding: theme.spacing.lg,
    },
    title: { fontSize: 15, fontWeight: '700', color: theme.colors.text, marginBottom: theme.spacing.sm },
    message: { fontSize: 12, color: theme.colors.textSecondary, textAlign: 'center', marginBottom: theme.spacing.md },
    retry: {
      backgroundColor: theme.colors.primary,
      borderRadius: theme.radius.sm,
      paddingVertical: theme.spacing.sm,
      paddingHorizontal: theme.spacing.lg,
    },
    retryText: { color: theme.colors.onPrimary, fontSize: 14, fontWeight: '600' },
  });
}
