// 재생 막대 (div.player 안): 화자별 색 띠 위에서 누르거나 끌어 원하는 곳부터 듣는다.
// 색은 스크립트와 같게 녹취 줄 기준(다음 줄까지, 최대 30초). 화자 구분 결과를 그대로 그리면 줄 화자와 어긋나서(실측 2시간 회의 27%) 쓰지 않는다.
// 말소리는 있는데 녹취 글이 없는 구간만 빗금으로 (누르면 다음 구간으로).
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { clock, type ScriptLine } from '../../../core/script.mts';
import { speakerOrder } from '../../entities/minutes/index.ts';
import { Icon, useNativeEvent } from '../../shared/ui/index.tsx';
import type { Playback } from './playback.ts';

export interface PlayerProps {
  readonly playback: Playback;
  readonly raw: readonly ScriptLine[];
  /** 화자 색 (CSS 값, var(--sN) 포함) */
  readonly color: (who: string) => string;
  /** 녹음 길이를 아직 모를 때 */
  readonly durationSec: number;
  /** 말소리는 있는데 녹취 글이 없는 구간 (speech.json) */
  readonly missing: readonly { readonly start: number; readonly end: number }[];
}

/** 같은 사람이 이어서 말한 구간은 한 덩어리로 합쳐, 2시간짜리도 누가 언제 말했는지 읽히게 한다 */
export function speakerRuns(raw: readonly ScriptLine[], total: number): { who: string; start: number; end: number }[] {
  const runs: { who: string; start: number; end: number }[] = [];
  raw.forEach((l, i) => {
    if (l.at === null || !l.who) return;
    const next = raw.slice(i + 1).find((n) => n.at !== null)?.at ?? total;
    const end = Math.min(next, l.at + 30);
    const last = runs.at(-1);
    if (last && last.who === l.who && l.at - last.end < 8) last.end = end;
    else runs.push({ who: l.who, start: l.at, end });
  });
  return runs;
}

export function PlayerBody({ playback, raw, color, durationSec, missing }: PlayerProps) {
  const s = useSyncExternalStore(playback.subscribe, playback.getSnapshot);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scrub = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; text: string } | null>(null);
  const dragging = useRef(false);
  const total = () => (Number.isFinite(playback.audio.duration) ? playback.audio.duration : durationSec);
  const T = total() || 1;
  const order = speakerOrder(raw);

  // 색 띠 칠하기: 그린 다음 프레임에, 창 크기가 바뀌면 다시
  useLayoutEffect(() => {
    const paint = () => {
      const c = canvas.current;
      if (!c) return;
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth;
      const hh = c.clientHeight;
      if (!w) return;
      c.width = w * dpr;
      c.height = hh * dpr;
      const ctx = c.getContext('2d')!;
      ctx.scale(dpr, dpr);
      const css = getComputedStyle(document.documentElement);
      const resolve = (v: string) => (v.startsWith('var(') ? css.getPropertyValue(v.slice(4, -1)) : v);
      ctx.fillStyle = css.getPropertyValue('--panel-3');
      ctx.beginPath();
      ctx.roundRect(0, 0, w, hh, 4);
      ctx.fill();
      const tt = total() || 1;
      for (const run of speakerRuns(raw, tt)) {
        ctx.fillStyle = resolve(color(run.who));
        ctx.fillRect((run.start / tt) * w, 0, Math.max(1, ((run.end - run.start) / tt) * w), hh);
      }
      // 녹취 없음: 그 구간을 비우고 강조색 빗금
      const accent = css.getPropertyValue('--accent').trim();
      for (const g of missing) {
        const x = (g.start / tt) * w;
        const gw = Math.max(3, ((g.end - g.start) / tt) * w);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, 0, gw, hh);
        ctx.clip();
        ctx.fillStyle = css.getPropertyValue('--panel');
        ctx.fillRect(x, 0, gw, hh);
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.5;
        for (let k = -hh; k < gw + hh; k += 4) {
          ctx.beginPath();
          ctx.moveTo(x + k, hh);
          ctx.lineTo(x + k + hh, 0);
          ctx.stroke();
        }
        ctx.restore();
      }
    };
    const id = requestAnimationFrame(paint);
    window.addEventListener('resize', paint);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener('resize', paint);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- 그릴 때 한 번 (페이지가 다시 그릴 때마다 새로 그린다)

  const at = (clientX: number) => {
    const rect = scrub.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * (total() || 0);
  };
  // 화살표 키로 5초씩 (요소에 직접 — 거품 없는 키도 받게)
  useNativeEvent(scrub, 'keydown', (_el, e) => {
    const k = (e as KeyboardEvent).key;
    if (k === 'ArrowRight') playback.skip(5);
    if (k === 'ArrowLeft') playback.skip(-5);
  });
  const missingAt = (t: number) => missing.find((g) => t >= g.start && t < g.end);
  // 녹취 없음 범례는 누를 때마다 다음 구간으로 이동한다
  const nextMissing = () => {
    const g = missing.find((x) => x.start > playback.audio.currentTime + 1) ?? missing[0];
    if (g) playback.audio.currentTime = g.start;
  };
  return (
    <div className="player-inner">
      <button className="play" aria-label={s.paused ? '재생' : '일시 정지'} onClick={playback.toggle}><Icon id={s.paused ? 'i-play' : 'i-pause'} /></button>
      <button className="icon-btn" aria-label="10초 뒤로" title="10초 뒤로" onClick={() => playback.skip(-10)}><Icon id="i-back10" /></button>
      <button className="icon-btn" aria-label="10초 앞으로" title="10초 앞으로" onClick={() => playback.skip(10)}><Icon id="i-fwd10" /></button>
      <div
        ref={scrub}
        className="scrub"
        role="slider"
        aria-label="재생 위치"
        tabIndex={0}
        aria-valuenow={Math.round(s.time)}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          dragging.current = true;
          playback.audio.currentTime = at(e.clientX);
        }}
        onPointerUp={() => (dragging.current = false)}
        onPointerMove={(e) => {
          if (dragging.current) {
            playback.audio.currentTime = at(e.clientX);
            return;
          }
          const rect = scrub.current!.getBoundingClientRect();
          const t = at(e.clientX);
          setHover({ x: e.clientX - rect.left, text: missingAt(t) ? `${clock(t)} · 녹취 없음` : clock(t) });
        }}
        onPointerLeave={() => setHover(null)}
      >
        <canvas ref={canvas} />
        <div className="head" style={{ left: `${(s.time / T) * 100}%` }} />
        <div className="hover" hidden={!hover} style={hover ? { left: `${hover.x}px` } : undefined}>{hover?.text}</div>
      </div>
      <span className="ptime">{`${clock(s.time)} / ${clock(T)}`}</span>
      <div style={{ display: 'flex', gap: '2px' }}>
        <button className="btn small ghost speed" title="재생 속도" onClick={playback.nextRate}>{`${s.rate}×`}</button>
        <button className="btn small ghost follow" aria-pressed={s.follow} title="재생 중인 줄을 따라 화면을 옮깁니다" onClick={() => playback.setFollow(!s.follow)}>따라가기</button>
      </div>
      {order.length > 1 || missing.length > 0 ? (
        <div className="player-legend">
          {order.length > 1 ? order.slice(0, 6).map((who) => <span key={who}><i style={{ background: color(who) }} />{who}</span>) : null}
          {missing.length > 0 ? (
            <button className="legend-missing" title="말소리는 있는데 녹취 글이 없는 구간입니다. 누르면 다음 구간으로 이동합니다" onClick={nextMissing}><i className="hatch" />{`녹취 없음 ${missing.length}곳`}</button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
