# 发布报告:v0.1.6(2026-08-29)

## 结果

- **流水线**:run 33253196580 · 10m29s · **4/4 job 全绿**(desktop ubuntu/windows/
  macos + android apk)。
- **版本门**:四文件 0.1.6 一致(root/app/desktop package.json + app/app.json
  expo.version),tag v0.1.6 通过三文件 == tag 校验。
- **产物**(GitHub Release v0.1.6):
  - soa-0.1.6.apk(78.4MB)+ soa-0.1.6.aab
  - StockOperatorAgent-0.1.6-amd64.deb / -x86_64.AppImage / -arm64.dmg /
    Setup-0.1.6.exe
- **APK 签名验证**(apksigner v2):`CN=SOA Release, OU=Release,
  O=StockOperatorAgent` —— **正式签名**(非 debug;68b40a3 的 ANDROID_*
  secrets 注入实证生效;v0.1.3/v0.1.5 曾为 debug 签名)。

## 内容

f958a7b(亿信/TDX-MCP 同源代理 + fetch 绑定 + tsconfig 防复发)+ 806d533
(闭环验证)+ 版本 bump 92632bc。

## 备注

- Actions Node 20 deprecation 警告(actions/checkout/setup-node/gh-release
  将在 2025-09 后强制 Node 24)——非阻塞,后续可顺手升 action 版本。
- S4 keystore 轮换仍为遗留(process-only,release 机执行)。
