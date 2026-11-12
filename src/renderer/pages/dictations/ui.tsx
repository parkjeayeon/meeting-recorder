// 받아쓰기 기록 (옛 pageDictations를 그대로 옮김: 같은 글자·같은 클래스).
// 목록은 이 화면이 본체에서 30개씩 이어 받는다(스크롤 끝 200px 전에 다음 묶음). 검색은 입력이 멈추고 0.3초 뒤 본체가 전체 기록에서.
// 기록이 바뀌면(주인의 version) 보던 만큼 다시 받는다. 고친 곳 표시·원문 펼침·지우기는 주인의 상태·명령.
import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import type { Issue } from '../../entities/issue/index.ts';
import { FolderEmpty } from '../../entities/issue/index.ts';
import { DictationItem } from '../../widgets/dictation-item/index.ts';
import { fmt, type Source } from '../../shared/lib/index.ts';
import { Num, SearchBox } from '../../shared/ui/index.tsx';
import { countLine, DICT_PAGE, dayGroups, footText, type DictPage } from './model.ts';

export interface DictationsInput {
  /** 기록이 바뀌면 달라지는 값 (바뀌면 다시 받는다) */
  readonly version: unknown;
  /** 녹음 폴더를 읽을 수 없음 */
  readonly folder: Issue | null;
  readonly freshId: string | null;
  readonly showMarks: boolean;
  readonly openRaw: ReadonlySet<string>;
}
export interface DictationsActions {
  readonly loadPage: (query: { readonly q: string; readonly before: string | null; readonly limit: number }) => Promise<DictPage>;
  readonly copy: (text: string) => unknown;
  readonly repaste: (text: string) => unknown;
  readonly toggleRaw: (id: string) => void;
  /** 확인 창을 거쳐 지우고 기록을 다시 읽는다 */
  readonly remove: (id: string) => void;
  readonly setShowMarks: (on: boolean) => void;
}

interface Listing extends DictPage {
  readonly q: string;
}

export function DictationsPage({ source, actions }: { readonly source: Source<DictationsInput>; readonly actions: DictationsActions }) {
  const input = useSyncExternalStore(source.subscribe, source.getSnapshot);
  const [list, setList] = useState<Listing | null>(null); // null: 아직 첫 답이 오지 않음
  const now = useRef<Listing | null>(null); // 늦게 온 답·스크롤 관찰자가 지금 목록을 보게
  now.current = list;
  const q = useRef('');
  const ticket = useRef(0); // 더 새로운 요청(검색어 바뀜·새 받아쓰기)이 오면 늦게 온 답은 버린다
  const loading = useRef(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const seeing = useRef<IntersectionObserver | null>(null);

  const load = useRef(async (reset: boolean) => {
    if (loading.current && !reset) return;
    const mine = ++ticket.current;
    loading.current = true;
    const cur = now.current;
    const shown = cur?.q === q.current ? cur.items : [];
    // 새 받아쓰기로 다시 그릴 때는 보던 만큼 다시 받는다 (스크롤이 위로 튀지 않게)
    const res = await actions.loadPage({ q: q.current, before: reset ? null : cur?.next ?? null, limit: reset ? Math.max(DICT_PAGE, shown.length) : DICT_PAGE });
    if (mine !== ticket.current) return;
    loading.current = false;
    const seen = new Set(reset ? [] : shown.map((r) => r.id));
    setList({ ...res, q: q.current, items: reset ? res.items : [...shown, ...res.items.filter((r) => !seen.has(r.id))] });
  }).current;

  useEffect(() => {
    load(true);
  }, [input.version, load]);

  // 스크롤 끝 200px 전에 다음 묶음. 목록을 다시 그릴 때마다 다시 관찰해 아직 보이면 바로 이어 받는다
  useEffect(() => {
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && now.current?.next && load(false), { root: document.getElementById('view'), rootMargin: '200px' });
    seeing.current = io;
    return () => io.disconnect();
  }, [load]);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !seeing.current) return;
    seeing.current.unobserve(el);
    seeing.current.observe(el);
  }, [list]);

  // 켜짐은 속성(checked)으로만 둔다 — 옛 화면처럼 HTML 속성을 남기지 않게
  const marks = useRef<HTMLInputElement>(null);
  useEffect(() => {
    marks.current!.checked = input.showMarks;
  }, [input.showMarks]);

  const typing = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(typing.current), []);
  const onSearch = (v: string) => {
    clearTimeout(typing.current);
    typing.current = setTimeout(() => {
      q.current = v.trim();
      load(true);
    }, 300);
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>받아쓰기<Num>{list?.total || ''}</Num></h1>
        <div className="head-tools">
          <label className="inline-switch" title="다듬기가 지운 말(취소선)과 넣은 말(밑줄) 표시">
            <span className="switch">
              <input ref={marks} type="checkbox" onChange={(e) => actions.setShowMarks(e.currentTarget.checked)} />
              <i />
            </span>
            고친 곳 표시
          </label>
          <SearchBox placeholder="받아쓴 말, 앱 이름 검색 (전체)" onInput={onSearch} />
        </div>
      </div>
      <div>{list ? <Listing list={list} input={input} actions={actions} sentinel={sentinel} /> : null}</div>
    </div>
  );
}

function Listing({ list, input, actions, sentinel }: { readonly list: Listing; readonly input: DictationsInput; readonly actions: DictationsActions; readonly sentinel: RefObject<HTMLDivElement | null> }) {
  if (!list.total && input.folder) return <FolderEmpty issue={input.folder} />;
  if (!list.total) {
    return (
      <div className="empty">
        <b>아직 받아쓴 글이 없습니다</b>아무 입력칸에 커서를 두고 <kbd>fn</kbd>을 꾹 누른 채 말해 보세요.
      </div>
    );
  }
  if (!list.items.length) {
    return list.q ? (
      <div className="empty">
        <b>찾는 글이 없습니다</b>
        {`"${list.q}"가 들어간 받아쓰기가 없습니다. 받아쓴 말·원문·앱 이름에서 전체 ${fmt.format(list.total)}개를 찾았습니다.`}
      </div>
    ) : <div />;
  }
  return (
    <>
      <p className="hint dict-count">{countLine(list.q, list.matched, list.total)}</p>
      {dayGroups(list.items, Boolean(list.next)).map((g) => [
        <div key={`h${g.key}`} className="day-head">{g.label}<Num>{g.count}</Num></div>,
        <div key={`l${g.key}`} className="dlist">
          {g.items.map((r) => (
            <DictationItem key={r.id} r={r} fresh={r.id === input.freshId} plain={!input.showMarks} rawOpen={input.openRaw.has(r.id)}
              onCopy={actions.copy} onRepaste={actions.repaste} onToggleRaw={actions.toggleRaw} onDelete={actions.remove} />
          ))}
        </div>,
      ])}
      <div ref={sentinel} className="load-more" aria-live="polite">{footText(list.q, list.items.length, list)}</div>
    </>
  );
}
