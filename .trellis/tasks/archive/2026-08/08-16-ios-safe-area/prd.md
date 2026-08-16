# ios-safe-area:iOS 安全区(P4-UI)

## Target
`app/App.tsx`(头部 paddingTop)、`app/package.json`(新依赖 react-native-safe-area-context)。

## Change
按父 design.md「跨子契约 5」:`npx expo install react-native-safe-area-context`;App.tsx 用 `useSafeAreaInsets()` 替换 `RNStatusBar.currentHeight`(移除 RNStatusBar import);paddingTop = `insets.top + theme.spacing.lg`。Android 行为必须不变(insets.top 在 Android 与 currentHeight 语义一致,模拟器验证)。

## Acceptance
- 新依赖就位;App.tsx 无 RNStatusBar 引用
- Android 模拟器重编后头部布局无回归(父验证)
- skip 验证/commit(父统一)
