// 抽屉二级页状态机 —— ☰ 打开一级菜单(设置/历史),点进去在同一抽屉内换成
// 二级页(← 返回菜单,✕ 关闭)。评审 R-11:这段 UI 逻辑原来住在 App.tsx,
// 违反 `.trellis/spec/ts/chart-ui.md:89-90`「后续 UI 逻辑(新页面/新入口)一律
// 进 hooks/ 或 components/,不回流 App.tsx」。视图(样式/布局)仍留在 App.tsx,
// 这里只保存页面状态与转移,便于单测与后续复用。
import React from 'react';

export type DrawerPage = 'closed' | 'menu' | 'settings' | 'history';

export interface DrawerController {
  /** 当前页;'closed' = 抽屉收起。 */
  page: DrawerPage;
  /** 是否展开(任何一级/二级页都算展开)。 */
  isOpen: boolean;
  /** ✕ / 遮罩:收起抽屉(任何页都可直接关)。 */
  close(): void;
  /** ← 或 ☰ 首次打开:回到一级菜单。 */
  showMenu(): void;
  /** 菜单 →「设置」。 */
  showSettings(): void;
  /** 菜单 →「历史」。 */
  showHistory(): void;
  /** ☰ 切换:收起 → 菜单;展开 → 收起(保持原有 toggle 语义)。 */
  toggle(): void;
}

export function useDrawer(): DrawerController {
  const [page, setPage] = React.useState<DrawerPage>('closed');
  const close = React.useCallback(() => setPage('closed'), []);
  const showMenu = React.useCallback(() => setPage('menu'), []);
  const showSettings = React.useCallback(() => setPage('settings'), []);
  const showHistory = React.useCallback(() => setPage('history'), []);
  const toggle = React.useCallback(
    () => setPage((p) => (p === 'closed' ? 'menu' : 'closed')),
    [],
  );
  return { page, isOpen: page !== 'closed', close, showMenu, showSettings, showHistory, toggle };
}
