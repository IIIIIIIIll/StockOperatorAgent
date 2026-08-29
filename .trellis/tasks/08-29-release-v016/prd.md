# PRD: 发布 v0.1.6(修复版)

## Goal

把 f958a7b(亿信/TDX-MCP 代理 + fetch 绑定 + tsconfig 防复发)与 806d533
(闭环验证)发入正式版本:版本 bump 0.1.5 → 0.1.6,tag v0.1.6 push 触发
release 流水线(桌面三平台 + Android APK/AAB + web bundle),监控产物落地。

## Acceptance Criteria

- **AC-V1** 四文件版本一致 0.1.6(root/app/desktop package.json + app/app.json)。
- **AC-V2** tag v0.1.6 指向最新提交并 push;版本门(三文件 == tag)通过。
- **AC-V3** Actions release 流水线全 job 成功:desktop ubuntu/windows/macos +
  android(APK/AAB)+ web bundle;GitHub Release v0.1.6 产物齐全。
- **AC-V4** 产物冒烟:release 页面 APK 可下载(大小合理)。

## Constraints

- 密钥纪律:不触碰 CI secrets;本任务无本地密钥操作(S4 keystore 轮换不在
  本任务——release 用现有 keystore secrets)。
- 若流水线失败:读取失败步骤日志定位;环境性重试(重推 tag)与代码性修复
  区分——代码性失败则停止并报告。

## Out of scope

S4 keystore 轮换、后续功能开发。
