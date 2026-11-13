// 공통 화면 부품. 옛 화면 코드의 h()·icon()과 같은 마크업을 내서 CSS·시험이 그대로 맞는다.
import type React from 'react';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';

export { el, icon } from './dom.ts';
export { glide, scrollSpy } from './scroll-spy.ts';
export { createToaster, confirmBox } from './feedback.ts';
export { installTooltips } from './tooltips.ts';

/** SVG 묶음(index.html의 <symbol id="i-…">)의 아이콘 하나 */
export function Icon({ id }: { readonly id: string }) {
  return (
    <svg>
      <use href={`#${id}`} />
    </svg>
  );
}

/** 숫자 글자 (고정폭 숫자 꼴, 옛 num()과 같은 span.num) */
export function Num({ children }: { readonly children: string | number }) {
  return <span className="num">{String(children)}</span>;
}

/** 복사 단추: 누르면 1.4초 동안 체크 표시 (옛 copyButton과 같은 마크업) */
export function CopyButton({ copy, label = '복사' }: { readonly copy: () => unknown; readonly label?: string }) {
  const [ok, setOk] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      className={ok ? 'icon-btn ok' : 'icon-btn'}
      title={label}
      aria-label={label}
      onClick={async (e) => {
        e.stopPropagation();
        await copy();
        setOk(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setOk(false), 1400);
      }}
    >
      <Icon id={ok ? 'i-check' : 'i-copy'} />
    </button>
  );
}

/** 요소에 직접 단 이벤트 처리기. React는 문서 뿌리에서 이벤트를 받으므로 거품이 안 오르는 이벤트
 *  (시험이 입력칸에 값을 넣고 보내는 new Event('input'))를 놓친다 — 입력칸의 input·change는 이것으로 받는다 */
export function useNativeEvent<E extends HTMLElement>(ref: { readonly current: E | null }, type: string, handler: (el: E, e: Event) => void) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const on = (e: Event) => latest.current(el, e);
    el.addEventListener(type, on);
    return () => el.removeEventListener(type, on);
  }, [ref, type]);
}

/** 검색 칸 (옛 searchBox와 같은 마크업). 값은 쥐지 않는다 */
export function SearchBox({ placeholder, hidden = false, onInput }: { readonly placeholder: string; readonly hidden?: boolean; readonly onInput: (value: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  useNativeEvent(input, 'input', (el) => onInput(el.value));
  return (
    <label className="search" hidden={hidden}>
      <Icon id="i-search" />
      {/* 옛 searchBox도 spellcheck: false를 주려 했지만 h()가 false 값을 건너뛰어 맞춤법 검사는 늘 켜져 있었다 — 동작을 그대로 두려고 같게 (docs/known-issues.md) */}
      <input ref={input} type="search" placeholder={placeholder} />
    </label>
  );
}

/** JobButton이 읽는 작업 목록 (shared/lib의 createJobs가 이 모양) */
export interface JobsView {
  readonly get: (key: string) => { readonly label: string } | undefined;
  readonly subscribe: (onChange: () => void) => () => void;
  readonly version: () => number;
}

/** 오래 걸리는 작업 버튼: 그 키의 작업이 돌고 있으면 돌아가는 표시(busy) + 누를 수 없게, 글은 작업 이름 (옛 markBusy와 같은 모양) */
export function JobButton({ jobs, jobKey, className, icon, label, title, onClick }: { readonly jobs: JobsView; readonly jobKey: string; readonly className: string; readonly icon: string; readonly label: string; readonly title?: string; readonly onClick: () => void }) {
  useSyncExternalStore(jobs.subscribe, jobs.version);
  const job = jobs.get(jobKey);
  return (
    <button className={job ? `${className} busy` : className} title={title} disabled={Boolean(job)} onClick={onClick}>
      <Icon id={icon} /><span>{job ? job.label : label}</span>
    </button>
  );
}

/** 값을 쥐지 않는 글자 입력칸: 처음 값은 속성으로만 넣고(HTML 속성을 남기지 않게), 입력·Enter는 직접 단 처리기로
 *  (시험이 보내는 거품 없는 이벤트도 받는다). Enter는 한글 조합 중이면 무시. 값은 ref로 읽는다 */
export function Field({ inputRef, initial, onInput, onEnter, ...attrs }: {
  readonly inputRef?: { current: HTMLInputElement | null };
  readonly initial?: string;
  readonly onInput?: (value: string) => void;
  readonly onEnter?: () => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onInput' | 'value' | 'defaultValue'>) {
  const own = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? own;
  useLayoutEffect(() => {
    const el = ref.current!;
    if (initial !== undefined) el.value = initial;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- 처음 한 번
  useNativeEvent(ref, 'input', (el) => onInput?.(el.value));
  useNativeEvent(ref, 'keydown', (_el, e) => {
    const k = e as KeyboardEvent;
    if (k.key === 'Enter' && !k.isComposing) onEnter?.();
  });
  return <input ref={ref} type="text" {...attrs} />;
}
