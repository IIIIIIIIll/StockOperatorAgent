# rn-env-keys:RN env 键位(P5)

## Target
`src/webSearch.ts:82`(TAVILY_API_KEY)、`src/tdx/deviceCollect.ts:29`(TDX_HOST)、`app/.env.example`(文档)。

## Change
按父 design.md「跨子契约 6」:EXPO_PUBLIC_ 前缀优先 fallback(webSearch:`EXPO_PUBLIC_TAVILY_API_KEY ?? TAVILY_API_KEY`;deviceCollect:`EXPO_PUBLIC_TDX_HOST ?? TDX_HOST ?? 默认`);.env.example 补注释(真机可达,默认不启用)。

## Acceptance
- env 读取单测(注入 _env 验证优先级)
- 默认行为不变(无 EXPO_PUBLIC 键时回退现状)
- skip 验证/commit(父统一)
