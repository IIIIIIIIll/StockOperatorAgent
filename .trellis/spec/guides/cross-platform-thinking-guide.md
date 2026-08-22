# Cross-Platform Thinking Guide

> **Purpose**: RN 跨端(web / Android / iOS)行为差异的排查与预防。起于
> 2026-08-22 市场下拉「菜单看似透明」bug(Session 49→51 三连修),沉淀为
> 平台差异检查清单。

---

## The Problem

RN 的承诺是"learn once, write anywhere",但 **渲染层(层叠上下文/Modal/
安全区)在 web 与原生实现不同源**。同一 JSX 在 Chromium 与 Android 上可以
画出完全不同的层级结果,而 typecheck + 单测对此全部免疫——只有实机像素
能暴露。

---

## Case Study: 下拉菜单透明 bug(08-22)

**症状链**(三次修复才收敛,前两次都是表面修复):

| 尝试 | 做法 | 结果 |
|------|------|------|
| be37715 | 背板 `transparent` → 实心 `theme.colors.background` | web 看似修好,**Android 整屏全白**(Session 50 回退) |
| 纯 zIndex | 卡片/下拉wrap/form 提到 999999/3000 | 全部无效——**zIndex 只在同一层叠上下文内排序** |
| 2404d4b | 菜单改 RN `Modal`(transparent)portal 到 root 层 | 两端一致 ✓ |

**根因**:RN-web 层叠上下文 bug——表单里下拉之后渲染的警告/信息文字
View 被绘制到 absolute 定位的菜单卡片之上。判据实验:隐藏警告文字后
卡片恢复实心 → 是**层叠**而非**透明度**。

**教训**:同一个视觉症状至少有三个候选根因(透明度 / 覆盖 / 层叠),
先做区分实验再动手;平台差异 bug 在 A 端验证通过 ≠ B 端通过。

---

## 排查规则(按序执行)

### 1. 视觉症状先做区分实验,再选修法

- 怀疑透明?→ DevTools 读目标元素 computed `opacity`/`backgroundColor`
  (web);原生用 hierarchy inspector。
- 怀疑覆盖/层叠?→ 隐藏嫌疑元素看是否恢复(本例判据);或临时加高对比
  边框看清谁画在谁上面。
- **禁止跳过区分直接改样式**——be37715 就是把层叠当透明度修,引入新 bug。

### 2. zIndex 无效 = 层叠上下文隔离,别再调数字

纯 zIndex 提升(999999/3000)无效时,说明元素不在同一 stacking context,
继续调数字是浪费时间。出路:

- **RN `Modal`(`transparent`)portal 到 root 层**,天然脱离表单层叠
  上下文,web/原生行为一致(下拉/浮层/toast 类 UI 的默认选项);
- 或重构父级样式消除意外创建的 stacking context(transform/opacity/
  filter/elevation 都会建)。Modal 方案已写入 [chart-ui.md](../ts/chart-ui.md)
  「市场下拉(Modal 弹层)」约定。

### 3. Modal 化的连带检查项

- **Android 返回键**:`onRequestClose` 必须给(否则返回键被吞/警告);
- **定位**:absolute 浮层坐标来自触发按钮 `measureInWindow` 快照——旋转/
  分屏/键盘弹出后是陈旧坐标;菜单开着时布局变化需重测或关闭;
- **点击层**:全屏透明 `Pressable` 点外关闭;浮层本体要挡住点击穿透
  (`stopPropagation` / 内层容器背景不透明);
- **双端都要验**:web(DevTools 像素采样)+ Android 模拟器各一轮,
  一端绿不算过。

### 4. 已知平台差异清单(本项目)

| 差异点 | 正确做法 | 出处 |
|--------|----------|------|
| 状态栏高度:`RNStatusBar.currentHeight` android-only,Android 15+ edge-to-edge 会盖顶部控件 | 统一走 `useSafeAreaInsets()` | chart-ui.md 安全区节 |
| 层叠上下文:RN-web 表单内 absolute 浮层可能被后续兄弟 View 盖住 | 浮层用 RN `Modal` 渲染,zIndex 只作同上下文微调 | 本指南 §2 |
| Hermes 缺口(Buffer/timers/crypto/zlib/GBK) | polyfill.ts + shim 族 + metro resolveRequest 重定向 | rn-runtime.md |
| `EXPO_PUBLIC_*` 内联 | 必须 `process.env.X` 直接成员访问 | rn-runtime.md |

新发现一条就追加一行;修完平台 bug 不留记录 = 下次重查一遍。

---

## Checklist for Cross-Platform UI Changes

- [ ] 改动涉及浮层/弹窗?→ 默认 Modal 方案,检查 onRequestClose/定位快照/点击穿透
- [ ] 视觉异常先做过区分实验(透明度 vs 覆盖 vs 层叠),记录判据
- [ ] web 与 native 双端实测(截图/vision 目检),单端通过不收工
- [ ] 用到的平台 quirk 是否已在上面清单里?不在 → 修复后补录
- [ ] spec(chart-ui.md 等)是否需要同步方案约束(如「禁止 marginTop 推移」)?
