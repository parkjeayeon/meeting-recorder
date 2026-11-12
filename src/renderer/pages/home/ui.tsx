// 홈 (옛 pageHome을 그대로 옮김: 같은 글자·같은 클래스). 값은 상태 주인이 준 창구(source)로 읽고, 할 일은 주인이 준 명령(actions)으로.
import { useSyncExternalStore, type ReactNode } from 'react';
import { BUSY, canCompressNow, JobCard, meetTitle, RowState, type MeetingItem } from '../../entities/meeting/index.ts';
import { DictationItem } from '../../widgets/dictation-item/index.ts';
import { clock, dayLabel, fmt, sizeLabel, TIME, WEEKDAY, type Source } from '../../shared/lib/index.ts';
import { Icon, Num } from '../../shared/ui/index.tsx';
import { homeView, type HomeInput, type Issue, type MeetFilter, type Step, type Storage, type TodoRow } from './model.ts';

export interface HomeActions {
  readonly openSettings: (sec: string) => void;
  readonly openMeetingStart: () => void;
  /** 회의 화면을 그 갈래로 연다 */
  readonly openMeetings: (filter: MeetFilter) => void;
  readonly dismissIssue: (key: string) => void;
  readonly copy: (text: string) => unknown;
  readonly repaste: (text: string) => unknown;
}

const meetingHref = (id: string) => `#meeting/${encodeURIComponent(id)}`;

function Section({ title, more, children }: { readonly title: string; readonly more?: readonly [string, string]; readonly children: ReactNode }) {
  return (
    <section className="hsec">
      <div className="section-head">
        <h2>{title}</h2>
        {more ? <a href={more[0]}>{more[1]}</a> : null}
      </div>
      {children}
    </section>
  );
}

function Issues({ issues, dismiss }: { readonly issues: HomeInput['issues']; readonly dismiss: (key: string) => void }) {
  if (!issues.length) return null;
  return (
    <div className="issues">
      {issues.map(([key, i]: readonly [string, Issue]) => (
        <div className="issue" key={key}>
          <Icon id="i-alert" />
          <div className="issue-text">
            <b>{i.title}</b>
            {i.detail ? <span>{i.detail}</span> : null}
          </div>
          {i.action ? <button className="btn small" onClick={i.onAction}>{i.action}</button> : null}
          {i.dismiss ? <button className="icon-btn" aria-label="닫기" onClick={() => dismiss(key)}><Icon id="i-x" /></button> : null}
        </div>
      ))}
    </div>
  );
}

function Todo({ rows, actions }: { readonly rows: readonly TodoRow[]; readonly actions: HomeActions }) {
  if (!rows.length) return <div className="todo-empty"><Icon id="i-check" />챙길 일이 없습니다</div>;
  return (
    // 'todo'는 회의록 할 일 줄(li.todo)이 쓰는 이름이라 겹치지 않게
    <div className="todo-list">
      {rows.map((t) => (
        <button key={t.title} className={`todo-row ${t.mark}`} onClick={() => (t.go === 'meeting' ? (location.hash = meetingHref(t.id)) : actions.openMeetings(t.filter))}>
          <span className="todo-n"><Num>{t.n}</Num></span>
          <span className="todo-text"><b>{t.title}</b><span>{t.sub}</span></span>
          <Icon id="i-right" />
        </button>
      ))}
    </div>
  );
}

function MeetRow({ r }: { readonly r: MeetingItem }) {
  const d = new Date(r.startedAt);
  return (
    <a className="hrow" href={meetingHref(r.id)}>
      <span className="hrow-day"><b><Num>{`${d.getMonth() + 1}.${String(d.getDate()).padStart(2, '0')}`}</Num></b><span>{WEEKDAY[d.getDay()]}</span></span>
      <span className="hrow-text">
        <b>{meetTitle(r)}</b>
        <span>{`${TIME.format(d)} · ${clock(r.durationSec)}${r.minutes?.speakers ? ` · 화자 ${r.minutes.speakers}명` : ''}`}</span>
      </span>
      <RowState r={r} />
    </a>
  );
}

function Steps({ steps, actions }: { readonly steps: readonly Step[]; readonly actions: HomeActions }) {
  const on: Record<Step['key'], () => void> = { perms: () => actions.openSettings('perms'), dictate: () => actions.openSettings('general'), meeting: actions.openMeetingStart };
  return (
    <ol className="checklist">
      {steps.map((s) => (
        <li key={s.key} className={s.done ? 'done' : ''}>
          <span className="ck">{s.done ? <Icon id="i-check" /> : null}</span>
          <span className="ck-text"><b>{s.title}</b><span>{s.text}</span></span>
          {s.done ? null : <button className="btn small" onClick={on[s.key]}>{s.action}</button>}
        </li>
      ))}
    </ol>
  );
}

function StoragePanel({ s }: { readonly s: Storage }) {
  const { wav, packed, save } = s;
  return (
    <Section title="녹음 공간">
      <div className="store">
        <div className="store-sum">
          <b><Num>{sizeLabel(s.total)}</Num></b>
          <span>{`원본 WAV ${wav.n}개 ${sizeLabel(wav.bytes)} · 압축 ${packed.n}개${packed.n ? ` ${sizeLabel(packed.bytes)}` : ''}`}</span>
        </div>
        {/* 막대: 압축한 것 · 원본 중 압축해도 남는 크기 · 압축하면 줄어드는 크기 */}
        <div className="store-bar" role="img" aria-label={`압축 ${sizeLabel(packed.bytes)}, 원본 ${sizeLabel(wav.bytes - save)}${save ? `, 압축하면 줄어드는 크기 ${sizeLabel(save)}` : ''}`}>
          {packed.n > 0 ? <i className="aac" style={{ flex: packed.bytes }} /> : null}
          {wav.n > 0 ? <i className="wav" style={{ flex: wav.bytes - save }} /> : null}
          {save > 0 ? <i className="save" style={{ flex: save }} /> : null}
        </div>
        <div className="store-legend">
          {packed.n > 0 ? <span><i className="aac" />압축함</span> : null}
          {wav.n > 0 ? <span><i className="wav" />원본</span> : null}
          {save > 0 ? <span><i className="save" />{`압축하면 약 ${sizeLabel(save)} 줄어듦`}</span> : null}
        </div>
        {s.todoCount ? (
          <div className="store-list">
            <p className="store-cap">{`압축할 수 있는 녹음 ${s.todoCount}개`}</p>
            {s.shown.map((r) => {
              const now = canCompressNow(r);
              const estimate = sizeLabel(r.audio?.estimate ?? 0);
              return (
                <a key={r.id} className="srow" href={meetingHref(r.id)}>
                  <span className="sname"><b>{meetTitle(r)}</b><span>{`${dayLabel(r.startedAt)} · ${clock(r.durationSec)}`}</span></span>
                  <span className="ssize">
                    <Num>{sizeLabel(r.audio?.bytes ?? 0)}</Num>
                    <span className={now ? 'snote ok' : 'snote'}>{now ? `지금 압축 → 약 ${estimate}` : BUSY.includes(r.minutes?.status ?? '') ? '회의록 만드는 중' : `확인 마치면 → 약 ${estimate}`}</span>
                  </span>
                </a>
              );
            })}
            {s.todoCount > s.shown.length ? <p className="store-foot">{`외 ${s.todoCount - s.shown.length}개`}</p> : null}
          </div>
        ) : (
          <div className="todo-empty"><Icon id="i-check" />압축할 녹음이 없습니다</div>
        )}
        {s.keep > 0 ? <p className="store-foot">{`원본 ${s.keep}개는 압축하지 않습니다 — 16kHz 녹음·그대로 두기로 고른 것·회의록이 없는 녹음`}</p> : null}
      </div>
    </Section>
  );
}

export function HomePage({ source, actions }: { readonly source: Source<HomeInput>; readonly actions: HomeActions }) {
  const input = useSyncExternalStore(source.subscribe, source.getSnapshot);
  const v = homeView(input);
  const st = v.summary;
  return (
    <div className="page home">
      <header className="hello">
        <h1>{v.greeting}</h1>
        <p>
          {st.todayCount ? (
            <>
              {'오늘 '}<b><Num>{fmt.format(st.today)}</Num>자</b>를 말로 썼어요
              {st.wpm ? <>{' · 평균 '}<b><Num>{st.wpm}</Num></b>{' WPM'}</> : null}
              {st.streak > 1 ? <>{' · '}<b><Num>{st.streak}</Num>일</b>{' 연속'}</> : null}
            </>
          ) : (
            <><kbd>fn</kbd>을 꾹 누른 채 말하면 지금 커서 위치에 글이 들어갑니다.</>
          )}
          {v.todayMeets ? <>{' · 오늘 회의 '}<b><Num>{v.todayMeets}</Num>건</b></> : null}
        </p>
      </header>
      <Issues issues={input.issues} dismiss={actions.dismissIssue} />
      <div className="home-grid">
        <div className="home-main">
          {v.busy.length > 0 ? <div className="home-jobs">{v.busy.map((r) => <JobCard key={r.id} r={r} />)}</div> : null}
          <Section title="챙길 일"><Todo rows={v.todo} actions={actions} /></Section>
          {v.recentMeets.length > 0 ? (
            <Section title="최근 회의" more={['#meetings', '모두 보기']}>
              <div className="hrows">{v.recentMeets.map((r) => <MeetRow key={r.id} r={r} />)}</div>
            </Section>
          ) : null}
          {/* 받아쓰기는 글이 길어 넓은 왼쪽에 (오른쪽 좁은 칸에선 줄마다 두세 번 꺾였다) */}
          {v.recentDicts.length > 0 ? (
            <Section title="최근 받아쓰기" more={['#dictations', '모두 보기']}>
              <div className="dlist">
                {v.recentDicts.map((r) => (
                  <DictationItem key={r.id} r={r} fresh={r.id === input.freshId} plain={!input.showMarks} rawOpen={input.openRaw.has(r.id)} onCopy={actions.copy} onRepaste={actions.repaste} />
                ))}
              </div>
            </Section>
          ) : null}
        </div>
        <aside className="home-side">
          {v.steps ? <Section title="시작하기"><Steps steps={v.steps} actions={actions} /></Section> : null}
          {v.storage ? <StoragePanel s={v.storage} /> : null}
        </aside>
      </div>
    </div>
  );
}
