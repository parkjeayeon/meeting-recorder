// 찾는 중인 질문의 걸린 시간: 1초마다 글자만 바뀐다 (찾는 중일 때만 시계를 돌림)
import { useEffect, useState } from 'react';
import { askSecs, type AskJob } from './model.ts';

export function LiveSecs({ t, className }: { readonly t: AskJob; readonly className?: string }) {
  const running = t.status === 'running';
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [running]);
  return <span className={className} data-ask-time={t.id}>{askSecs(t)}</span>;
}
