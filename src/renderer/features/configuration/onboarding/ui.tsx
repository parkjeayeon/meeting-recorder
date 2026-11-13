import { useCallback } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { commit } from '../../../shared/page-host/index.tsx';
import { Icon, useNativeEvent } from '../../../shared/ui/index.tsx';
import type { Control, OnboardingView, ResultView, StepView } from './view.ts';

const roots = new WeakMap<HTMLElement, Root>();

export function onboardingRenderer(host: HTMLElement) {
  let root = roots.get(host);
  if (!root) {
    root = createRoot(host);
    roots.set(host, root);
  }
  const mounted = root;
  return (view: OnboardingView) => {
    commit(() => mounted.render(<OnboardingPage key={view.instance} view={view} />));
    host.querySelector<HTMLElement>('.ob-main')!.scrollTop = 0;
    if (document.activeElement instanceof HTMLElement && host.contains(document.activeElement)) document.activeElement.blur();
  };
}

// 화면에서 떨어진 뒤에도 이전 주인의 비동기 작업·타이머가 이 요소를 쓴다.
function useRetainedRef<T extends HTMLElement>(control: Control<T>, restore: (node: T, previous: T | null) => void) {
  return useCallback((node: T | null) => {
    if (!node || node === control.current) return;
    restore(node, control.current);
    control.current = node;
  }, [control, restore]);
}

function Password({ input, placeholder, keydown }: { input: Control<HTMLInputElement>; placeholder: string; keydown: (e: KeyboardEvent) => void }) {
  const ref = useRetainedRef(input, (node, previous) => {
    // React가 type을 마지막에 붙이므로 옛 속성 순서(type·placeholder·autocomplete)로 맞춘다.
    node.removeAttribute('placeholder');
    node.removeAttribute('autocomplete');
    node.setAttribute('placeholder', placeholder);
    node.setAttribute('autocomplete', 'off');
    if (previous) {
      node.value = previous.value;
      node.setSelectionRange(previous.selectionStart, previous.selectionEnd, previous.selectionDirection ?? undefined);
    }
  });
  useNativeEvent(input, 'keydown', (_el, e) => keydown(e as KeyboardEvent));
  return <input ref={ref} type="password" placeholder={placeholder} autoComplete="off" />;
}

function Result({ value }: { value: ResultView }) {
  const ref = useRetainedRef(value.ref, (node, previous) => {
    if (previous) {
      node.className = previous.className;
      node.textContent = previous.textContent;
    }
  });
  return <p ref={ref} className={value.className}>{value.text}</p>;
}

function MicSelect({ v }: { v: Extract<StepView, { kind: 'mic' }> }) {
  const ref = useRetainedRef(v.select, (node, previous) => {
    node.value = previous ? previous.value : v.initialMic;
  });
  useNativeEvent(v.select, 'change', v.change);
  return <select ref={ref} aria-label="마이크"><option value="">시스템 기본값</option>{v.mics.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>;
}

function Meter({ bars }: { bars: Control<HTMLDivElement> }) {
  const ref = useRetainedRef(bars, (node, previous) => {
    if (previous) [...previous.children].forEach((bar, i) => {
      const classes = bar.getAttribute('class');
      if (classes !== null) node.children[i]!.setAttribute('class', classes);
    });
  });
  return <div ref={ref} className="ob-meter">{Array.from({ length: 16 }, (_, i) => <i key={i} />)}</div>;
}

function PracticeArea({ v }: { v: Extract<StepView, { kind: 'practice' }> }) {
  const ref = useRetainedRef(v.area, (node, previous) => {
    if (previous) {
      node.value = previous.value;
      node.setSelectionRange(previous.selectionStart, previous.selectionEnd, previous.selectionDirection);
    }
  });
  useNativeEvent(v.area, 'input', v.input);
  return <textarea ref={ref} className="ob-practice" rows={4} placeholder="여기를 클릭하고, fn을 꾹 누른 채 위 문장을 읽은 뒤 떼세요." />;
}

function Body({ v }: { v: StepView }) {
  switch (v.kind) {
    case 'welcome':
      // 둘 다 늘 켜져 있다. 고르는 것은 아니지만 켜진 상태로 보여 준다
      return <div className="ob-uses">{[
        ['i-mic', '받아쓰기', 'fn을 꾹 누른 채 말하면, 다듬은 글이 지금 커서 위치에 들어갑니다.'],
        ['i-people', '회의록', '대면 회의를 녹음하면 녹취·화자 구분·회의록 초안을 만듭니다.'],
      ].map(([ic, title, text]) => <div key={ic} className="ob-use on"><span className="ob-use-ic"><Icon id={ic!} /></span><b>{title}</b><span>{text}</span><i className="ob-check"><Icon id="i-check" /></i></div>)}</div>;
    case 'permissions':
      return <div className="ob-perms">
        {v.items.map((p, i) => <div key={p.kind} className={`ob-perm${p.ok ? ' ok' : ''}${p.active ? ' active' : ''}`}>
          <span className="ob-perm-n">{p.ok ? <Icon id="i-check" /> : String(i + 1)}</span>
          <div className="ob-perm-text"><b>{p.ok ? `${p.name} 허용됨` : p.name}</b><span>{p.text}</span></div>
          {!p.ok && <button className={`btn small${p.active ? ' primary' : ''}`} disabled={!p.active} onClick={p.request}>{p.clicked ? '시스템 설정 열기' : '허용'}</button>}
        </div>)}
        {v.dictation && <div className={`ob-perm${v.fnWarn ? '' : ' ok'}`}>
          <span className="ob-perm-n">{v.fnWarn ? '!' : <Icon id="i-check" />}</span>
          <div className="ob-perm-text"><b>🌐 키 설정</b><span>{v.fnWarn ? '키보드 설정에서 "🌐 키를 누르면"을 "아무것도 안 함"으로 바꿔 주세요. 그대로 두면 fn을 누를 때 이모지 창 등이 같이 뜹니다.' : '"🌐 키를 누르면"이 "아무것도 안 함"으로 되어 있습니다.'}</span></div>
          {v.fnWarn && <button className="btn small" onClick={v.openKeyboard}>키보드 설정 열기</button>}
        </div>}
      </div>;
    case 'token':
      return <div>
        <ol className="ob-steps">
          <li>{'Hugging Face에 로그인하고 모델 약관에 동의 '}<button className="link" onClick={v.openModel}>모델 페이지 열기</button></li>
          <li>{'Read 권한 토큰 만들기 '}<button className="link" onClick={v.openTokens}>토큰 페이지 열기</button></li>
          <li>아래에 붙여 넣고 저장</li>
        </ol>
        <div className="key-row"><Password input={v.input} placeholder="hf_…" keydown={v.keydown} /><button className="btn primary" onClick={v.save}>저장</button></div>
        {v.check && <button className="btn small" style={{ marginTop: '10px' }} onClick={v.verify}>지금 토큰 확인</button>}
        <Result value={v.result} />
      </div>;
    case 'engine':
      return <div className="ob-comps">{v.items.map((c) => <div key={c.id} className={`ob-comp${c.installed ? ' ok' : ''}`}>
        <span className="ob-perm-n">{c.installed ? <Icon id="i-check" /> : c.running ? <i className="spin" /> : '·'}</span>
        <div className="ob-perm-text">
          <b>{c.name}{c.optional && <em>{' 회의록용'}</em>}</b>
          <span>{c.text}</span>
          {c.running && <div className={`bar${c.progress == null ? ' indeterminate' : ''}`}><i style={{ width: `${Math.round((c.progress ?? 0.3) * 100)}%` }} /></div>}
        </div>
        <span className="num">{c.size}</span>
        {c.brew && <button className="btn small" onClick={c.openBrew}>brew.sh</button>}
        {c.install && <button className="btn small" onClick={c.start}>{c.retry ? '다시 시도' : '받기'}</button>}
      </div>)}</div>;
    case 'account':
      return <div>
        <div className="ob-perms">{v.items.map((item) => <div key={item.title} className={`ob-perm${item.good ? ' ok' : ''}`}><span className="ob-perm-n">{item.good ? <Icon id="i-check" /> : '·'}</span><div className="ob-perm-text"><b>{item.title}</b><span>{item.text}</span></div></div>)}</div>
        {v.showKey && <div style={{ marginTop: '16px' }}>
          <p className="hint" style={{ margin: '0 0 8px' }}>로그인된 계정이 없으면 Anthropic API 키를 쓸 수 있습니다.</p>
          <div className="key-row"><Password input={v.input} placeholder="sk-ant-… (선택)" keydown={v.keydown} /><button className="btn" onClick={v.save}>저장</button></div>
          <Result value={v.result} />
        </div>}
      </div>;
    case 'mic':
      return <div>
        <div className="ob-mic"><Icon id="i-mic" /><MicSelect v={v} /></div>
        {v.bt && <p className="ob-result bad">블루투스 마이크는 음질이 낮아 인식이 떨어지고, 켜는 순간 스피커 음질도 떨어집니다.</p>}
        <Result value={v.note} />
      </div>;
    case 'fnkey':
      return <div>
        {v.pressed && <p className="ob-result ok">fn 키를 알아챘습니다.</p>}
        {!v.pressed && v.quiet && <p className="ob-result bad">키를 알아채지 못했습니다. 입력 모니터링 권한을 허용했는지 확인하세요. 허용한 직후라면 앱을 다시 시작해야 할 수 있습니다.</p>}
        {!v.pressed && v.quiet && <button className="btn small" onClick={v.request}>입력 모니터링 설정 열기</button>}
      </div>;
    case 'practice':
      return <div>
        <blockquote className="ob-sample">{`“${v.sample}”`}</blockquote>
        <PracticeArea v={v} />
        {v.hint && !v.done && <p className="ob-result bad">{v.hint}</p>}
        {v.done && <p className="ob-result ok">두 번 빠르게 누르면 손을 떼도 계속 듣고, 다시 누르면 끝납니다. 긴 말을 할 때 편합니다.</p>}
      </div>;
    case 'done':
      return <div className="ob-perms">{v.items.map((item) => <div key={item.title} className={`ob-perm${item.good ? ' ok' : ''}`}><span className="ob-perm-n">{item.good ? <Icon id="i-check" /> : '·'}</span><div className="ob-perm-text"><b>{item.title}</b><span>{item.text}</span></div></div>)}</div>;
  }
}

function Panel({ v }: { v: StepView }) {
  switch (v.kind) {
    case 'welcome':
      return <div className="ob-promise">
        <span className="brand-mark big"><Icon id="i-mic" /></span>
        <b>음성은 이 Mac 밖으로 나가지 않습니다</b>
        <ul>
          <li>음성 인식(Whisper)과 화자 구분(pyannote)은 이 Mac 안에서 돌아갑니다.</li>
          <li>외부 프로그램은 샌드박스 안에서 실행되어 녹음을 밖으로 보낼 수 없습니다.</li>
          <li>다듬기와 회의록 작성에만 글이 로그인된 Claude Code·Codex로 갑니다.</li>
          <li>받아쓴 음성은 글로 바꾼 뒤 바로 지웁니다.</li>
        </ul>
      </div>;
    case 'permissions':
      return <div className="ob-illust"><div className="ob-lock"><Icon id="i-shield" /></div><b>macOS 개인정보 보호</b><p>권한은 시스템 설정 › 개인정보 보호 및 보안에서 언제든 끌 수 있습니다. 개발 중인 앱이라 다시 설치하면 권한을 다시 물을 수 있습니다.</p></div>;
    case 'token':
      return <div className="ob-illust"><div className="ob-lock"><Icon id="i-key" /></div><b>토큰은 모델을 받을 때만 씁니다</b><p>모델(33MB)을 받은 뒤에는 화자 구분이 네트워크 없이 이 Mac 안에서 돌아갑니다.</p></div>;
    case 'engine':
      return <div className="ob-illust"><div className="ob-lock"><Icon id="i-gear" /></div><b>왜 이렇게 큰가요?</b><p>음성 인식 모델이 이 Mac 안에서 돌아가기 때문입니다. 받아쓰기 모델 0.9GB, 회의 모델 3.1GB, 화자 구분 1.2GB이며 설정 › 엔진에서 크기를 보고 지울 수 있습니다.</p></div>;
    case 'account':
      return <div className="ob-illust"><div className="ob-lock"><Icon id="i-wand" /></div><b>{'"음, 3시에, 아니 4시에" → "4시에"'}</b><p>다듬기는 말한 내용을 바꾸지 않고 군말·자기 정정·띄어쓰기만 정리합니다. 계정이 없으면 들린 그대로 입력합니다.</p></div>;
    case 'mic':
      return <div className="ob-illust"><Meter bars={v.bars} /><b>{v.ok ? '잘 들립니다' : '말하는 동안 막대가 움직이나요?'}</b></div>;
    case 'fnkey':
      return <div className="ob-keys">
        <span className="ob-key">control</span><span className="ob-key">option</span>
        <span className={`ob-key fn${v.down ? ' down' : ''}${v.pressed ? ' ok' : ''}`}><small>🌐</small>fn</span>
        <span className="ob-key wide">command</span>
      </div>;
    case 'practice':
      return <div className="ob-tips">
        <b>이렇게 씁니다</b>
        <div className="ob-tip"><kbd>fn</kbd><span>꾹 누른 채 말하고 떼기 → 입력</span></div>
        <div className="ob-tip"><kbd>fn</kbd><kbd>fn</kbd><span>두 번 → 손 떼고 말하기, 다시 누르면 끝</span></div>
        <div className="ob-tip"><kbd>fn</kbd><kbd>fn</kbd><kbd>fn</kbd><span>세 번 → 취소</span></div>
      </div>;
    case 'done':
      return <div className="ob-tips">
        <b>알아 두면 좋은 것</b>
        <div className="ob-tip"><kbd>⌘K</kbd><span>회의·받아쓰기 검색과 바로가기</span></div>
        <div className="ob-tip"><kbd>⌘,</kbd><span>설정</span></div>
        <div className="ob-tip"><Icon id="i-book" /><span>자주 틀리는 이름은 사전에 넣어 두세요</span></div>
      </div>;
  }
}

function OnboardingPage({ view: v }: { view: OnboardingView }) {
  return <>
    <header className="ob-top"><ol className="ob-progress">{v.sections.map((name, i) => <li key={name} className={i < v.at ? 'done' : i === v.at ? 'now' : ''}><i />{name}</li>)}</ol></header>
    <div className="ob-body">
      <section className="ob-main">
        {v.back ? <button className="btn small ghost ob-back" onClick={v.back}><Icon id="i-left" />뒤로</button> : <span className="ob-back" />}
        <h1>{v.title}</h1>
        {v.lead && <p className="ob-lead">{v.lead}</p>}
        <div className="ob-content"><Body v={v.body} /></div>
        <div className="ob-actions">
          <button className="btn primary ob-next" onClick={v.primary.onclick} disabled={v.primary.disabled}>{v.primary.label}<Icon id="i-right" /></button>
          {v.secondary && <button className="btn ghost" onClick={v.secondary.onclick}>{v.secondary.icon && <Icon id={v.secondary.icon} />}{v.secondary.label}</button>}
        </div>
      </section>
      <aside className="ob-panel"><Panel v={v.body} /></aside>
    </div>
  </>;
}
