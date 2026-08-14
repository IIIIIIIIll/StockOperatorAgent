// 主题 —— 对齐 Python core/ui/theme.py PALETTE(亮/暗色板)
// 品牌色 A 股红色:亮 #D32F2F / 暗 #EF5350;中性色沿用 Streamlit 官方默认。
import { useColorScheme } from 'react-native';

export interface ThemeColors {
  primary: string; // 品牌红
  background: string;
  surface: string; // 卡片/表头
  text: string;
  textSecondary: string;
  border: string;
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
    background: '#FFFFFF',
    surface: '#F6F7F8',
    text: '#31333F',
    textSecondary: '#6b7280',
    border: '#e5e7eb',
    up: '#D32F2F',
    down: '#1a8f3d',
    warn: '#b8860b',
    error: '#d33',
    ok: '#1a8f3d',
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16 },
  radius: { sm: 6, md: 8 },
};

const dark: Theme = {
  colors: {
    primary: '#EF5350',
    background: '#0E1117',
    surface: '#262730',
    text: '#FAFAFA',
    textSecondary: '#9aa0ab',
    border: '#3a3f4b',
    up: '#EF5350',
    down: '#4caf6d',
    warn: '#e0b94e',
    error: '#ef5350',
    ok: '#4caf6d',
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16 },
  radius: { sm: 6, md: 8 },
};

/** 跟随系统亮/暗(Streamlit 同语义)。 */
export function useTheme(): Theme {
  const scheme = useColorScheme();
  return scheme === 'dark' ? dark : light;
}

export const THEME_HEADING = '超绝AI股票分析系统 📈';
