// 공통 화면 부품. 옛 화면 코드(legacy/app.js)의 h()·icon()과 같은 마크업을 내서 CSS·시험이 그대로 맞는다.
import { useEffect, useRef, useState } from 'react';

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

/** 검색 칸 (옛 searchBox와 같은 마크업). 값은 쥐지 않는다. 입력은 칸에 직접 단 처리기로 받는다 —
 *  React는 문서 뿌리에서 이벤트를 받으므로 거품이 안 오르는 input 이벤트(시험이 값을 넣고 보내는 것)를 놓친다 */
export function SearchBox({ placeholder, hidden = false, onInput }: { readonly placeholder: string; readonly hidden?: boolean; readonly onInput: (value: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef(onInput);
  latest.current = onInput;
  useEffect(() => {
    const el = input.current!;
    const on = () => latest.current(el.value);
    el.addEventListener('input', on);
    return () => el.removeEventListener('input', on);
  }, []);
  return (
    <label className="search" hidden={hidden}>
      <Icon id="i-search" />
      {/* 옛 searchBox도 spellcheck: false를 주려 했지만 h()가 false 값을 건너뛰어 맞춤법 검사는 늘 켜져 있었다 — 동작을 그대로 두려고 같게 (docs/known-issues.md) */}
      <input ref={input} type="search" placeholder={placeholder} />
    </label>
  );
}
