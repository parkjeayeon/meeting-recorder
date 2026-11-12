// 찾을 범위: 조건 칩(최근 몇 개·기간)과 그 팝오버. 바깥을 누르거나 Esc면 닫힌다.
// 입력칸 값은 쥐지 않고(옛 화면처럼 속성으로만) 입력은 직접 단 처리기로 받는다.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ASK_COUNTS, askDatePresets, rangeText, ymdOf, type AskScope } from '../../entities/ask/index.ts';
import { Icon, useNativeEvent } from '../../shared/ui/index.tsx';

type Pop = 'count' | 'range' | null;

export function CondBar({ scope, setScope }: { readonly scope: AskScope; readonly setScope: (s: AskScope) => void }) {
  const [open, setOpen] = useState<Pop>(null);
  // 팝오버가 열려 있으면: 조건 줄 밖을 누르거나 Esc(다른 Esc 처리보다 먼저)로 닫는다
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (!(e.target as Element | null)?.closest?.('.conds-bar')) setOpen(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(null);
      }
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key, true);
    };
  }, [open]);

  const chip = (key: 'count' | 'range', label: string, value: string | null, cleared: AskScope) => (
    <button
      type="button"
      className={`cchip${value ? ' set' : ''}`}
      data-chip={key}
      aria-expanded={open === key}
      onClick={() => {
        // 비어 있는 기간을 열면 최근 7일(오늘 포함)을 먼저 채운다
        if (key === 'range' && open !== key && !scope.from && !scope.to) {
          const [, from, to] = askDatePresets()[0]!;
          setScope({ ...scope, from, to });
        }
        setOpen(open === key ? null : key);
      }}
    >
      {value ? (
        <>
          {value}
          <span className="x" role="button" aria-label={`${label} 지우기`} onClick={(e) => {
            e.stopPropagation();
            setScope(cleared);
            setOpen(null);
          }}><Icon id="i-x" /></span>
        </>
      ) : <><Icon id="i-plus" />{label}</>}
    </button>
  );
  return (
    <div className="conds-bar">
      {chip('count', '최근 몇 개', scope.count ? `최근 ${scope.count}개` : null, { ...scope, count: null })}
      {chip('range', '기간', scope.from || scope.to ? rangeText(scope.from, scope.to) : null, { ...scope, from: '', to: '' })}
      {open === 'count' ? <CountPop scope={scope} setScope={setScope} close={() => setOpen(null)} /> : null}
      {open === 'range' ? <RangePop scope={scope} setScope={setScope} close={() => setOpen(null)} /> : null}
    </div>
  );
}

function CountPop({ scope, setScope, close }: { readonly scope: AskScope; readonly setScope: (s: AskScope) => void; readonly close: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef(scope);
  latest.current = scope;
  useLayoutEffect(() => {
    input.current!.value = scope.count ? String(scope.count) : '';
    const t = setTimeout(() => input.current?.focus());
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- 열 때 한 번
  useNativeEvent(input, 'input', (el) => {
    const v = el.value.replace(/\D/g, '').replace(/^0+/, '');
    if (v !== el.value) el.value = v; // 숫자만
    setScope({ ...latest.current, count: v ? Number(v) : null });
  });
  return (
    <div className="cpop">
      <h4>최근 몇 개 회의에서 찾을까요</h4>
      <p>최신 회의부터 셉니다</p>
      <div className="opts">
        {ASK_COUNTS.map((n) => (
          <button key={n} type="button" className="num" aria-pressed={scope.count === n} onClick={() => {
            setScope({ ...scope, count: n });
            close();
          }}>{String(n)}</button>
        ))}
      </div>
      <label className="field">
        <input ref={input} type="text" inputMode="numeric" placeholder="직접 입력" maxLength={5} aria-label="최근 몇 개" onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            close();
          }
        }} />
        개
      </label>
    </div>
  );
}

function RangePop({ scope, setScope, close }: { readonly scope: AskScope; readonly setScope: (s: AskScope) => void; readonly close: () => void }) {
  const today = ymdOf(new Date());
  const from = useRef<HTMLInputElement>(null);
  const to = useRef<HTMLInputElement>(null);
  const latest = useRef(scope);
  latest.current = scope;
  useLayoutEffect(() => {
    from.current!.value = scope.from;
    to.current!.value = scope.to;
  }, [scope.from, scope.to]);
  const sync = () => setScope({ ...latest.current, from: from.current!.value, to: to.current!.value });
  useNativeEvent(from, 'change', sync);
  useNativeEvent(to, 'change', sync);
  return (
    <div className="cpop">
      <h4>언제 한 회의에서 찾을까요</h4>
      <div className="opts">
        {askDatePresets().map(([label, f, t]) => (
          <button key={label} type="button" aria-pressed={scope.from === f && scope.to === t} onClick={() => {
            setScope({ ...scope, from: f, to: t });
            close();
          }}>{label}</button>
        ))}
      </div>
      <div className="dates">
        <label className="field"><small>부터</small><input ref={from} type="date" max={scope.to || today} aria-label="시작일" /></label>
        <label className="field"><small>까지</small><input ref={to} type="date" min={scope.from || ''} max={today} aria-label="끝일" /></label>
      </div>
    </div>
  );
}
