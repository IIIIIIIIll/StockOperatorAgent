// 主题 —— 对齐 Python core/ui/theme.py PALETTE(亮色板)
// 品牌色 A 股红色:#D32F2F;中性色沿用 Streamlit 官方默认。
// #101:暗色分支已删除——它此前永不激活(app.json userInterfaceStyle 恒 "light",
// 原生侧 useColorScheme 恒 light,死代码)。如需暗色支持:恢复 dark palette 并
// 改 userInterfaceStyle "automatic" 一并落地(原生重渲染代价需一并评估)。

export interface ThemeColors {
  primary: string; // 品牌红
  onPrimary: string; // primary 背景上的文字/图标
  background: string;
  surface: string; // 卡片/表头
  text: string;
  textSecondary: string;
  border: string;
  shadow: string; // 阴影色
  up: string; // 涨(A 股红)
  down: string; // 跌(绿)
  warn: string;
  error: string;
  ok: string;
}

export interface Theme {
  colors: ThemeColors;
  spacing: { xs: number; sm: number; md: number; lg: number };
  radius: { sm: number; md: number };
}

const light: Theme = {
  colors: {
    primary: '#D32F2F',
    onPrimary: '#FFFFFF',
    background: '#FFFFFF',
    surface: '#F6F7F8',
    text: '#31333F',
    textSecondary: '#6b7280',
    border: '#e5e7eb',
    shadow: '#000',
    up: '#D32F2F',
    down: '#1a8f3d',
    warn: '#b8860b',
    error: '#d33',
    ok: '#1a8f3d',
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16 },
  radius: { sm: 6, md: 8 },
};

/** 恒亮色(app.json userInterfaceStyle "light";暗色支持见文件头 #101 注释)。 */
export function useTheme(): Theme {
  return light;
}

export const THEME_HEADING = '做个好人AI股票分析系统 📈';
