// S5-4(评审 2026-11-08):安卓硬件返回键的页面转移。App 里 app.json 关了
// predictiveBackGestureEnabled 且此前全无 BackHandler —— 抽屉开着按返回直接退出 App。
// 转移规则抽成纯函数,不引入 React 测试环境也能钉住。
import { describe, expect, it } from 'vitest';
import { nextDrawerPageOnBack, type DrawerPage } from '../app/hooks/useDrawer.ts';

describe('useDrawer 返回键转移(S5-4)', () => {
  it('二级页 → 菜单;菜单 → 收起;收起 → 不接管', () => {
    const table: Array<[DrawerPage, DrawerPage | null]> = [
      ['closed', null],
      ['menu', 'closed'],
      ['settings', 'menu'],
      ['history', 'menu'],
    ];
    for (const [from, expected] of table) {
      expect(nextDrawerPageOnBack(from), from).toBe(expected);
    }
  });

  it('逐层叠退:历史 → 菜单 → 收起,第三次才交回系统', () => {
    let page: DrawerPage = 'history';
    const steps: Array<DrawerPage | null> = [];
    for (let i = 0; i < 3; i++) {
      const next = nextDrawerPageOnBack(page);
      steps.push(next);
      if (next !== null) page = next;
    }
    expect(steps).toEqual(['menu', 'closed', null]);
  });
});
