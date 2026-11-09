// 流式文本渲染节流(评审 2026-11-09 P1-6)。
//
// 背景:analysisController 每 TOKEN_NOTIFY_MS(120ms) 广播一次快照,token 帧把
// 累积后的整串文本交给 react-native-markdown-display —— 该库每次渲染都新建
// markdown-it 解析器并全量重解析(react-native-markdown-display/src/index.js:185)。
// 3–5k 字报告 = 每帧数百节点重解析,安卓上表现为打字卡顿 + 滚动位置漂移。
//
// 做法:只节流"渲染用的那份文本"(尾部边沿,300ms),状态与持久化仍用原始文本。
// 300ms 在观感上仍是逐字出现,但解析次数降到约 1/2.5。
import { useEffect, useRef, useState } from 'react';

export function useThrottledText(text: string, ms: number = 300): string {
  const [shown, setShown] = useState(text);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef(text);

  useEffect(() => {
    pending.current = text;
    // 首次/空闲:立刻同步,避免出现"空白首帧"
    if (shown === text) return;
    if (timer.current !== null) return; // 窗口内:等尾部边沿统一落地
    timer.current = setTimeout(() => {
      timer.current = null;
      setShown(pending.current);
    }, ms);
    // shown 故意不进依赖:它只是本窗口是否已落地的判据
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, ms]);

  // 卸载时清定时器,防 setState after unmount
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  return shown;
}
