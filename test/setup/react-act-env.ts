// React 19 的 act() 需要显式告知「处于测试环境」，否则每个用例都会打
// "The current testing environment is not configured to support act(...)"，
// 并且 act 内的更新不会被同步冲刷（hook 直测会假红）。
// 这是一个全局标记，且只影响测试进程（vitest setupFiles）。
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
