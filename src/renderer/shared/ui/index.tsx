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
