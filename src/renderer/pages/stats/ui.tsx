// 통계 화면 (옛 pageStats를 그대로 옮김: 같은 글자·같은 클래스). 값은 상태 주인이 준 창구(source)로 읽는다.
import { Fragment, useSyncExternalStore } from 'react';
import { clock, fmt, PROVIDER_NAME, seconds, type Source } from '../../shared/lib/index.ts';
import { Num } from '../../shared/ui/index.tsx';
import { BarChart } from './bar-chart.tsx';
import { statsView, type StatsInput } from './model.ts';

const LANG_NAME: Readonly<Record<string, string>> = { ko: '한국어', en: 'English', ja: '日本語' };

export function StatsPage({ source }: { readonly source: Source<StatsInput> }) {
  const v = statsView(useSyncExternalStore(source.subscribe, source.getSnapshot));
  const maxApp = v.apps[0]?.[1] || 1;
  const langTotal = v.languages.reduce((n, l) => n + l.chars, 0) || 1;
  return (
    <div className="page">
      <div className="page-head">
        <div style={{ flex: 1 }}>
          <h1>통계</h1>
          <p className="lead">받아쓰기와 회의 기록에서 계산합니다. 음성은 남기지 않고 글과 숫자만 씁니다.</p>
        </div>
      </div>
      <div className="stat-row">
        <div className="stat"><span>말로 쓴 글자</span><b>{fmt.format(v.summary.total)}<small>자</small></b></div>
        <div className="stat"><span>평균 속도</span><b>{v.summary.wpm ?? '–'}<small>WPM</small></b></div>
        <div className="stat"><span>연속 사용</span><b>{v.summary.streak}<small>일</small></b></div>
        <div className="stat"><span>회의 녹음</span><b>{clock(v.meetSec)}<small>{`${v.meetCount}건`}</small></b></div>
      </div>
      {v.empty ? (
        <div className="empty locked">
          <b>받아쓰기를 해 보면 통계가 쌓입니다</b>
          <kbd>fn</kbd>을 꾹 누른 채 말한 글자 수, 속도, 자주 쓰는 앱이 여기에 나타납니다.
        </div>
      ) : (
        <>
          <div className="card" style={{ marginTop: '12px' }}>
            <h3>최근 14일 받아쓴 글자</h3>
            <p className="sub">막대에 마우스를 올리면 그날의 글자 수와 횟수가 보입니다.</p>
            <BarChart days={v.days} />
          </div>
          <div className="two">
            <div className="card">
              <h3>어디에 썼나</h3>
              <p className="sub">받아쓴 글자 수, 입력한 앱 기준</p>
              <div className="hbars">
                {v.apps.map(([app, n]) => (
                  <div className="hbar" key={app}>
                    <span title={app}>{app}</span>
                    <div className="track"><i style={{ width: `${(n / maxApp) * 100}%` }} /></div>
                    <Num>{fmt.format(n)}</Num>
                  </div>
                ))}
              </div>
            </div>
            <div className="card">
              <h3>걸린 시간</h3>
              <p className="sub">손을 뗀 뒤부터의 평균</p>
              <dl className="kv">
                {v.asrMs !== null && (<><dt>음성 인식 (Whisper turbo)</dt><dd>{seconds(v.asrMs)}</dd></>)}
                {v.cleanup.map((c) => (
                  <Fragment key={c.provider}>
                    <dt>{`다듬기 · ${PROVIDER_NAME[c.provider] ?? c.provider}`}</dt>
                    <dd>{`${seconds(c.avgMs)} · ${c.count}회`}</dd>
                  </Fragment>
                ))}
                {v.perHourSec !== null && (<><dt>회의록 (녹음 1시간당)</dt><dd>{`${Math.round(v.perHourSec / 60)}분`}</dd></>)}
              </dl>
            </div>
          </div>
          {v.languages.length > 0 && (
            <div className="card" style={{ marginTop: '12px' }}>
              <h3>어떤 언어로 썼나</h3>
              <p className="sub">받아쓴 글자 수 기준 · 자동이면 고른 언어</p>
              <div className="hbars lang">
                {v.languages.map((l) => (
                  <div className="hbar" key={l.language}>
                    <span title={l.language}>{LANG_NAME[l.language] ?? l.language}</span>
                    <div className="track"><i style={{ width: `${(l.chars / langTotal) * 100}%` }} /></div>
                    <Num>{`${Math.round((l.chars / langTotal) * 100)}% · ${fmt.format(l.count)}회`}</Num>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
