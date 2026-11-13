import type { RecorderApi } from '../../../shared/api/index.ts';
import { el as h, icon, type createToaster } from '../../../shared/ui/index.tsx';
import type { ProviderInfo, SetupComponent } from '../settings/types.ts';

type Uses = { dictation: boolean; meetings: boolean };
type StepId = 'welcome' | 'permissions' | 'token' | 'engine' | 'account' | 'mic' | 'fnkey' | 'practice' | 'done';
type SavedOnboarding = { step?: string | number; uses?: Uses; completed?: boolean; completedAt?: string | Date };

export interface OnboardingCtx {
  readonly api: RecorderApi;
  readonly toast: ReturnType<typeof createToaster>;
  readonly setupListeners: Set<(list: SetupComponent[]) => void>;
  readonly fnListeners: Set<(s: { down: boolean }) => void>;
  readonly tapListeners: Set<() => void>;
  readonly getMic: () => string;
  readonly setMic: (id: string) => void;
  readonly onDone: (uses: Uses) => void | Promise<void>;
}

interface Frame {
  title: string;
  lead: string;
  body: HTMLElement;
  panel: HTMLElement;
  primary: HTMLElement;
  secondary?: HTMLElement | false;
  canBack?: boolean;
}

// 처음 설정(온보딩): 앱을 처음 열면 본 화면 대신 이 화면이 뜨고, 필요한 설정을 모두 마친 뒤 본 화면으로 넘어간다.
// 흐름은 Wispr Flow를 따랐다: 한 단계씩, 권한은 카드 하나씩(1초마다 다시 확인, 돌아오면 바로 확인),
// 마이크 레벨 확인, fn 키 확인, 실제 입력칸에서 연습. 어디까지 했는지 저장해 두고 다시 열면 이어서 한다.

const STEPS: { id: StepId; section: string; when?: (u: Uses) => boolean }[] = [
  { id: 'welcome', section: '시작' },
  { id: 'permissions', section: '권한' },
  { id: 'token', section: '설치', when: (u) => u.meetings },
  { id: 'engine', section: '설치' },
  { id: 'account', section: '설치' },
  { id: 'mic', section: '확인' },
  { id: 'fnkey', section: '확인', when: (u) => u.dictation },
  { id: 'practice', section: '연습', when: (u) => u.dictation },
  { id: 'done', section: '연습' },
];
const SECTIONS = ['시작', '권한', '설치', '확인', '연습'];
const SAMPLE = '음, 내일 회의는 3시에, 아니 4시에 하는 걸로 정리해 주세요.';
const BLUETOOTH = /airpods|bluetooth|buds|headset|hands-?free|beats|jabra|bose|wh-1000|wf-1000/i;

export function startOnboarding(ctx: OnboardingCtx, saved: SavedOnboarding) {
  const { api, toast } = ctx;
  const root = document.getElementById('onboard')!;
  const uses = { dictation: true, meetings: true }; // 받아쓰기와 회의록은 늘 둘 다 쓴다 (고르지 않는다)
  let stepId: StepId = saved.step && STEPS.some((s) => s.id === saved.step) ? saved.step as StepId : 'welcome';
  let cleanup: (() => void)[] = []; // 단계를 떠날 때 정리할 것 (타이머, 마이크, fn 확인 모드)

  const steps = () => STEPS.filter((s) => !s.when || s.when(uses));
  const leave = () => {
    cleanup.forEach((fn) => fn());
    cleanup = [];
  };
  const go = (id: StepId) => {
    leave();
    stepId = id;
    api.onboardingSet({ step: id, uses });
    render();
  };
  const next = () => {
    const list = steps();
    const i = list.findIndex((s) => s.id === stepId);
    if (list[i + 1]) go(list[i + 1]!.id);
  };
  const back = () => {
    const list = steps();
    const i = list.findIndex((s) => s.id === stepId);
    if (i > 0) go(list[i - 1]!.id);
  };
  const every = (fn: () => void, ms: number) => {
    const t = setInterval(fn, ms);
    cleanup.push(() => clearInterval(t));
  };
  const later = (fn: () => void, ms: number) => {
    const t = setTimeout(fn, ms);
    cleanup.push(() => clearTimeout(t));
  };

  function finish() {
    leave();
    api.onboardingSet({ completed: true, step: 'done', uses, completedAt: new Date() });
    root.hidden = true;
    document.querySelector<HTMLElement>('.shell')!.hidden = false;
    ctx.onDone(uses);
  }

  // 화면 틀: 위 진행 표시 · 왼쪽 설명과 버튼 · 오른쪽 그림 패널
  function frame({ title, lead, body, panel, primary, secondary, canBack = true }: Frame) {
    const current = steps().find((s) => s.id === stepId)!;
    const at = SECTIONS.indexOf(current.section);
    root.replaceChildren(
      h('header', { class: 'ob-top' },
        h('ol', { class: 'ob-progress' }, SECTIONS.map((name, i) => h('li', { class: i < at ? 'done' : i === at ? 'now' : '' }, h('i'), name)))),
      h('div', { class: 'ob-body' },
        h('section', { class: 'ob-main' },
          canBack && stepId !== 'welcome' ? h('button', { class: 'btn small ghost ob-back', onclick: back }, icon('i-left'), '뒤로') : h('span', { class: 'ob-back' }),
          h('h1', null, title),
          lead && h('p', { class: 'ob-lead' }, lead),
          h('div', { class: 'ob-content' }, body),
          h('div', { class: 'ob-actions' }, primary, secondary)),
        h('aside', { class: 'ob-panel' }, panel)));
  }

  const primaryBtn = (label: string, onclick: () => void, disabled = false) => h('button', { class: 'btn primary ob-next', onclick, disabled }, label, icon('i-right'));
  const quietBtn = (label: string, onclick: () => void) => h('button', { class: 'btn ghost', onclick }, label);

  // ── 1. 환영: 무엇에 쓸지 고른다 ─────────────────────────────────────
  function welcome() {
    // 둘 다 늘 켜져 있다. 고르는 것은 아니지만 켜진 상태로 보여 준다
    const card = (ic: string, title: string, text: string) => h('div', { class: 'ob-use on' }, h('span', { class: 'ob-use-ic' }, icon(ic)), h('b', null, title), h('span', null, text), h('i', { class: 'ob-check' }, icon('i-check')));
    frame({
      title: 'Meeting Recorder를 시작합니다',
      lead: '두 가지를 합니다. 몇 단계만 설정하면 바로 쓸 수 있습니다.',
      body: h('div', { class: 'ob-uses' },
        card('i-mic', '받아쓰기', 'fn을 꾹 누른 채 말하면, 다듬은 글이 지금 커서 위치에 들어갑니다.'),
        card('i-people', '회의록', '대면 회의를 녹음하면 녹취·화자 구분·회의록 초안을 만듭니다.')),
      primary: primaryBtn('시작하기', next),
      canBack: false,
      panel: h('div', { class: 'ob-promise' },
        h('span', { class: 'brand-mark big' }, icon('i-mic')),
        h('b', null, '음성은 이 Mac 밖으로 나가지 않습니다'),
        h('ul', null,
          h('li', null, '음성 인식(Whisper)과 화자 구분(pyannote)은 이 Mac 안에서 돌아갑니다.'),
          h('li', null, '외부 프로그램은 샌드박스 안에서 실행되어 녹음을 밖으로 보낼 수 없습니다.'),
          h('li', null, '다듬기와 회의록 작성에만 글이 로그인된 Claude Code·Codex로 갑니다.'),
          h('li', null, '받아쓴 음성은 글로 바꾼 뒤 바로 지웁니다.'))),
    });
  }

  // ── 2. 권한: 카드 하나씩, 허용되면 다음 카드로 ───────────────────────
  async function permissions() {
    const PERMS = [
      { kind: 'microphone', name: '마이크', text: '목소리와 회의를 녹음합니다.', need: true },
      { kind: 'inputMonitoring', name: '입력 모니터링', text: 'fn 키를 누르고 뗀 것을 알아챕니다.', need: uses.dictation },
      { kind: 'accessibility', name: '손쉬운 사용', text: '받아쓴 글을 커서 위치에 입력합니다 (⌘V).', need: uses.dictation },
    ].filter((p) => p.need);
    let status = await api.permStatus();
    let fnWarn = uses.dictation ? await api.fnKeyWarning() : null;
    const clicked = new Set();
    const granted = (p: { kind: string }) => status[p.kind] === 'granted';

    const draw = () => {
      const active = PERMS.find((p) => !granted(p));
      const allOk = !active;
      frame({
        title: allOk ? '권한을 모두 허용했습니다' : '권한을 허용해 주세요',
        lead: allOk ? '고맙습니다. 이 권한들은 위에 적은 용도로만 씁니다.' : '허용을 누르면 macOS가 묻거나 시스템 설정이 열립니다. 켜고 돌아오면 자동으로 다음으로 넘어갑니다.',
        body: h('div', { class: 'ob-perms' },
          PERMS.map((p, i) => {
            const ok = granted(p);
            const isActive = p === active;
            return h('div', { class: `ob-perm${ok ? ' ok' : ''}${isActive ? ' active' : ''}` },
              h('span', { class: 'ob-perm-n' }, ok ? icon('i-check') : String(i + 1)),
              h('div', { class: 'ob-perm-text' }, h('b', null, ok ? `${p.name} 허용됨` : p.name), h('span', null, p.text)),
              !ok && h('button', { class: `btn small${isActive ? ' primary' : ''}`, disabled: !isActive, onclick: async () => {
                clicked.add(p.kind);
                status = await api.permRequest(p.kind);
                draw();
              } }, clicked.has(p.kind) ? '시스템 설정 열기' : '허용'));
          }),
          uses.dictation && h('div', { class: `ob-perm${fnWarn ? '' : ' ok'}` },
            h('span', { class: 'ob-perm-n' }, fnWarn ? '!' : icon('i-check')),
            h('div', { class: 'ob-perm-text' }, h('b', null, '🌐 키 설정'), h('span', null, fnWarn ? '키보드 설정에서 "🌐 키를 누르면"을 "아무것도 안 함"으로 바꿔 주세요. 그대로 두면 fn을 누를 때 이모지 창 등이 같이 뜹니다.' : '"🌐 키를 누르면"이 "아무것도 안 함"으로 되어 있습니다.')),
            fnWarn && h('button', { class: 'btn small', onclick: () => api.openKeyboardSettings() }, '키보드 설정 열기'))),
        primary: primaryBtn('계속', next, !allOk),
        secondary: !allOk && quietBtn('나중에 허용하기', () => {
          toast('권한 없이 계속합니다', '받아쓰기는 권한을 허용해야 동작합니다. 설정 › 권한에서 언제든 허용할 수 있습니다.');
          next();
        }),
        panel: h('div', { class: 'ob-illust' }, h('div', { class: 'ob-lock' }, icon('i-shield')), h('b', null, 'macOS 개인정보 보호'), h('p', null, '권한은 시스템 설정 › 개인정보 보호 및 보안에서 언제든 끌 수 있습니다. 개발 중인 앱이라 다시 설치하면 권한을 다시 물을 수 있습니다.')),
      });
    };
    draw();
    // 1초마다, 그리고 시스템 설정에서 돌아올 때 다시 확인한다. 새로 허용되면 창을 앞으로
    const check = async () => {
      const before = PERMS.filter(granted).length;
      status = await api.permStatus();
      if (uses.dictation) fnWarn = await api.fnKeyWarning();
      if (PERMS.filter(granted).length > before) api.focusApp();
      if (stepId === 'permissions') draw();
    };
    every(check, 1000);
    window.addEventListener('focus', check);
    cleanup.push(() => window.removeEventListener('focus', check));
  }

  // ── 3. (회의록) Hugging Face 토큰 ─────────────────────────────────
  async function token() {
    const status = await api.tokenStatus();
    let ready = Boolean(status.hf.app || status.hf.cli);
    let message = ready ? (status.hf.app ? '앱에 저장된 토큰이 있습니다.' : '터미널에서 로그인한 토큰이 있습니다.') : '';
    let ok = ready;
    const input = h('input', { type: 'password', placeholder: 'hf_…', autocomplete: 'off', spellcheck: false }) as HTMLInputElement;
    const result = h('p', { class: `ob-result${ok ? ' ok' : ''}` }, message);
    const verify = async () => {
      result.className = 'ob-result';
      result.textContent = '확인 중…';
      const r = await api.verifyToken('hf');
      ok = r.ok;
      result.className = `ob-result ${r.ok ? 'ok' : 'bad'}`;
      result.textContent = r.message;
      draw();
    };
    const save = async () => {
      if (!input.value.trim()) return input.focus();
      await api.saveToken('hf', input.value.trim());
      input.value = '';
      verify();
    };
    input.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.isComposing) save();
    };
    const draw = () => frame({
      title: '화자 구분 준비',
      lead: '누가 말했는지 나누는 pyannote 모델은 Hugging Face에서 약관에 동의한 계정만 받을 수 있습니다. 토큰은 키체인으로 암호화해 저장합니다.',
      body: h('div', null,
        h('ol', { class: 'ob-steps' },
          h('li', null, 'Hugging Face에 로그인하고 모델 약관에 동의 ', h('button', { class: 'link', onclick: () => api.openExternal('https://huggingface.co/pyannote/speaker-diarization-community-1') }, '모델 페이지 열기')),
          h('li', null, 'Read 권한 토큰 만들기 ', h('button', { class: 'link', onclick: () => api.openExternal('https://huggingface.co/settings/tokens') }, '토큰 페이지 열기')),
          h('li', null, '아래에 붙여 넣고 저장')),
        h('div', { class: 'key-row' }, input, h('button', { class: 'btn primary', onclick: save }, '저장')),
        ready && !ok && h('button', { class: 'btn small', style: 'margin-top:10px', onclick: verify }, '지금 토큰 확인'),
        result),
      primary: primaryBtn('계속', next, !ok),
      secondary: !ok && quietBtn('나중에 하기', () => {
        toast('화자 구분 없이 계속합니다', '회의록은 만들어지지만 누가 말했는지는 나뉘지 않습니다. 설정 › 계정·토큰에서 넣을 수 있습니다.');
        next();
      }),
      panel: h('div', { class: 'ob-illust' }, h('div', { class: 'ob-lock' }, icon('i-key')), h('b', null, '토큰은 모델을 받을 때만 씁니다'), h('p', null, '모델(33MB)을 받은 뒤에는 화자 구분이 네트워크 없이 이 Mac 안에서 돌아갑니다.')),
    });
    draw();
  }

  // ── 4. 엔진 설치: 필요한 것만, 설치는 이 화면을 떠나도 계속된다 ─────────
  async function engine() {
    const wanted = (c: SetupComponent) => c.id === 'engine' || c.id === 'turbo' || (uses.meetings && (c.id === 'large' || c.id === 'diarize'));
    const required = (c: SetupComponent) => c.id === 'engine' || c.id === 'turbo';
    let list: SetupComponent[] = (await api.setupStatus()).filter(wanted);
    const gb = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}GB` : `${Math.round(n / 1e6)}MB`);
    const installAll = () => list.filter((c) => !c.installed && !c.job?.running && c.blocker !== 'brew').forEach((c) => api.setupInstall(c.id));
    const draw = () => {
      const ready = list.filter(required).every((c) => c.installed);
      const missing = list.filter((c) => !c.installed);
      const busy = list.some((c) => c.job?.running);
      frame({
        title: '음성 인식 엔진을 설치합니다',
        lead: ready && !missing.length ? '모두 설치했습니다.' : `필요한 프로그램과 모델을 받습니다. 받아쓰기에 필요한 것만 끝나면 넘어갈 수 있고, 나머지는 뒤에서 계속 받습니다.`,
        body: h('div', { class: 'ob-comps' },
          list.map((c) => h('div', { class: `ob-comp${c.installed ? ' ok' : ''}` },
            h('span', { class: 'ob-perm-n' }, c.installed ? icon('i-check') : c.job?.running ? h('i', { class: 'spin' }) : '·'),
            h('div', { class: 'ob-perm-text' },
              h('b', null, c.name, !required(c) && h('em', null, ' 회의록용')),
              h('span', null, c.job?.error ? c.job.error : c.job?.running ? c.job.text ?? '준비 중' : c.blocker === 'brew' ? '터미널에서 Homebrew를 먼저 설치하세요 (brew.sh)' : c.blocker === 'token' ? 'Hugging Face 토큰이 있어야 받을 수 있습니다' : c.desc),
              c.job?.running && h('div', { class: `bar${c.job.pct == null ? ' indeterminate' : ''}` }, h('i', { style: `width:${Math.round((c.job.pct ?? 0.3) * 100)}%` }))),
            h('span', { class: 'num' }, !c.size ? '' : c.installed ? gb(c.size) : `약 ${gb(c.size)}`),
            c.blocker === 'brew' && !c.installed && h('button', { class: 'btn small', onclick: () => api.openExternal('https://brew.sh') }, 'brew.sh'),
            !c.installed && !c.job?.running && c.blocker !== 'brew' && h('button', { class: 'btn small', onclick: () => api.setupInstall(c.id) }, c.job?.error ? '다시 시도' : '받기')))),
        primary: ready ? primaryBtn(busy ? '계속 (설치는 뒤에서 계속)' : '계속', next) : primaryBtn(busy ? '설치 중…' : '모두 설치', installAll, busy),
        secondary: !ready && quietBtn('나중에 설치하기', () => {
          toast('엔진 없이 계속합니다', '설정 › 엔진에서 언제든 설치할 수 있습니다.');
          next();
        }),
        panel: h('div', { class: 'ob-illust' }, h('div', { class: 'ob-lock' }, icon('i-gear')), h('b', null, '왜 이렇게 큰가요?'), h('p', null, '음성 인식 모델이 이 Mac 안에서 돌아가기 때문입니다. 받아쓰기 모델 0.9GB, 회의 모델 3.1GB, 화자 구분 1.2GB이며 설정 › 엔진에서 크기를 보고 지울 수 있습니다.')),
      });
    };
    draw();
    const onSetup = (l: SetupComponent[]) => {
      if (stepId !== 'engine') return;
      list = l.filter(wanted);
      draw();
    };
    ctx.setupListeners.add(onSetup);
    cleanup.push(() => ctx.setupListeners.delete(onSetup));
    // 처음 들어오면 바로 설치를 시작한다
    if (list.some((c) => !c.installed && !c.job?.running && c.blocker !== 'brew' && !c.job?.error)) installAll();
  }

  // ── 5. 다듬기 계정 ──────────────────────────────────────────────
  async function account() {
    const p: Record<string, ProviderInfo> = await api.providers({ fresh: true });
    const names = [['claude-code', 'Claude Code'], ['codex', 'Codex']] as const;
    const logged = names.filter(([id]) => p[id]?.loggedIn);
    const keyInput = h('input', { type: 'password', placeholder: 'sk-ant-… (선택)', autocomplete: 'off', spellcheck: false }) as HTMLInputElement;
    const result = h('p', { class: 'ob-result' });
    const saveKey = async () => {
      if (!keyInput.value.trim()) return keyInput.focus();
      await api.saveToken('anthropic', keyInput.value.trim());
      keyInput.value = '';
      result.textContent = '확인 중…';
      const r = await api.verifyToken('anthropic');
      result.className = `ob-result ${r.ok ? 'ok' : 'bad'}`;
      result.textContent = r.message;
    };
    keyInput.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.isComposing) saveKey();
    };
    frame({
      title: '다듬기와 회의록에 쓸 계정',
      lead: '군말을 지우고 문장을 다듬는 일과 회의록 작성은 이미 로그인된 Claude Code·Codex 구독을 그대로 씁니다. 별도 결제가 없습니다.',
      body: h('div', null,
        h('div', { class: 'ob-perms' }, names.map(([id, name]) => {
          const info = p[id];
          const ok = info?.loggedIn;
          return h('div', { class: `ob-perm${ok ? ' ok' : ''}` },
            h('span', { class: 'ob-perm-n' }, ok ? icon('i-check') : '·'),
            h('div', { class: 'ob-perm-text' }, h('b', null, name), h('span', null, !info?.installed ? '설치되어 있지 않음' : ok ? `로그인됨${info.account ? ` · ${info.account}` : ''}` : `로그인 필요 · 터미널에서 ${id === 'codex' ? 'codex login' : 'claude'} 실행`)));
        })),
        !logged.length && h('div', { style: 'margin-top:16px' },
          h('p', { class: 'hint', style: 'margin:0 0 8px' }, '로그인된 계정이 없으면 Anthropic API 키를 쓸 수 있습니다.'),
          h('div', { class: 'key-row' }, keyInput, h('button', { class: 'btn', onclick: saveKey }, '저장')),
          result)),
      primary: primaryBtn(logged.length ? '계속' : '계속 (지금은 다듬기 없이)', next),
      secondary: h('button', { class: 'btn ghost', onclick: () => account() }, icon('i-redo'), '다시 확인'),
      panel: h('div', { class: 'ob-illust' }, h('div', { class: 'ob-lock' }, icon('i-wand')), h('b', null, '"음, 3시에, 아니 4시에" → "4시에"'), h('p', null, '다듬기는 말한 내용을 바꾸지 않고 군말·자기 정정·띄어쓰기만 정리합니다. 계정이 없으면 들린 그대로 입력합니다.')),
    });
  }

  // ── 6. 마이크 확인: 말하면 막대가 움직이는지 ───────────────────────
  async function mic() {
    let stream: MediaStream | null = null;
    let ctxAudio: AudioContext | null = null;
    let heard = 0;
    let level = 0;
    let slow = false;
    const select = h('select', { 'aria-label': '마이크' }) as HTMLSelectElement;
    const bars = h('div', { class: 'ob-meter' }, Array.from({ length: 16 }, () => h('i')));
    const note = h('p', { class: 'ob-result' });
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default');
    // 배열이 옵션 대신 글자로 붙는 기존 버그를 의도적으로 유지한다.
    select.append(h('option', { value: '' }, '시스템 기본값'), devices.map((d) => h('option', { value: d.deviceId }, d.label || '알 수 없는 마이크')) as unknown as string);
    select.value = ctx.getMic();
    const start = async () => {
      stream?.getTracks().forEach((t) => t.stop());
      ctxAudio?.close();
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: select.value ? { deviceId: { exact: select.value } } : true });
      } catch (err) {
        note.className = 'ob-result bad';
        note.textContent = `마이크를 열지 못했습니다: ${(err as Error).message}`;
        return;
      }
      ctxAudio = new AudioContext();
      const analyser = ctxAudio.createAnalyser();
      analyser.fftSize = 1024;
      ctxAudio.createMediaStreamSource(stream).connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      const tick = () => {
        if (!ctxAudio) return;
        analyser.getFloatTimeDomainData(buf);
        const rms = Math.sqrt(buf.reduce((n, v) => n + v * v, 0) / buf.length);
        level = 0.7 * level + 0.3 * Math.min(1, Math.max(0, (20 * Math.log10(rms + 1e-9) + 60) / 45));
        [...bars.children].forEach((b, i) => b.classList.toggle('on', i < Math.round(level * 16)));
        if (level > 0.45) heard++;
        if (heard === 12) draw(); // 말소리가 잠깐 이어지면 확인 완료
        requestAnimationFrame(tick);
      };
      tick();
    };
    select.onchange = () => {
      ctx.setMic(select.value);
      heard = 0;
      draw();
      start();
    };
    const draw = () => {
      const ok = heard >= 12;
      const bt = BLUETOOTH.test(select.selectedOptions[0]?.textContent ?? '');
      note.className = `ob-result${ok ? ' ok' : ''}`;
      note.textContent = ok ? '잘 들립니다.' : slow ? '소리가 들리지 않습니다. 다른 마이크를 골라 보세요.' : '';
      frame({
        title: '마이크를 확인합니다',
        lead: '평소처럼 아무 말이나 해 보세요. 막대가 움직이면 됩니다. 내장·유선 마이크를 권장합니다.',
        body: h('div', null, h('div', { class: 'ob-mic' }, icon('i-mic'), select), bt && h('p', { class: 'ob-result bad' }, '블루투스 마이크는 음질이 낮아 인식이 떨어지고, 켜는 순간 스피커 음질도 떨어집니다.'), note),
        primary: primaryBtn(ok ? '계속' : '말해 보세요…', next, !ok && !slow),
        secondary: !ok && slow && quietBtn('그래도 계속', next),
        panel: h('div', { class: 'ob-illust' }, bars, h('b', null, ok ? '잘 들립니다' : '말하는 동안 막대가 움직이나요?')),
      });
    };
    draw();
    start();
    later(() => {
      slow = true;
      if (heard < 12) draw();
    }, 20000);
    cleanup.push(() => {
      stream?.getTracks().forEach((t) => t.stop());
      ctxAudio?.close();
      ctxAudio = null;
    });
  }

  // ── 7. fn 키 확인: 누르면 키가 색으로 바뀐다 (이 단계에서는 녹음하지 않는다) ──
  function fnkey() {
    let pressed = false;
    let down = false;
    let quiet = false;
    const draw = () => frame({
      title: 'fn 키를 눌러 보세요',
      lead: '키보드 왼쪽 아래의 🌐 fn 키입니다. 누르는 동안 오른쪽 키가 주홍색으로 바뀝니다. 이 단계에서는 녹음하지 않습니다.',
      body: h('div', null,
        pressed && h('p', { class: 'ob-result ok' }, 'fn 키를 알아챘습니다.'),
        !pressed && quiet && h('p', { class: 'ob-result bad' }, '키를 알아채지 못했습니다. 입력 모니터링 권한을 허용했는지 확인하세요. 허용한 직후라면 앱을 다시 시작해야 할 수 있습니다.'),
        !pressed && quiet && h('button', { class: 'btn small', onclick: () => api.permRequest('inputMonitoring') }, '입력 모니터링 설정 열기')),
      primary: primaryBtn(pressed ? '계속' : 'fn을 눌러 보세요…', next, !pressed),
      secondary: !pressed && quiet && quietBtn('건너뛰기', next),
      panel: h('div', { class: 'ob-keys' },
        h('span', { class: 'ob-key' }, 'control'), h('span', { class: 'ob-key' }, 'option'),
        h('span', { class: `ob-key fn${down ? ' down' : ''}${pressed ? ' ok' : ''}` }, h('small', null, '🌐'), 'fn'),
        h('span', { class: 'ob-key wide' }, 'command')),
    });
    api.onboardingFnTest(true);
    cleanup.push(() => api.onboardingFnTest(false));
    const onFn = ({ down: d }: { down: boolean }) => {
      if (stepId !== 'fnkey') return;
      down = d;
      if (d) pressed = true;
      draw();
    };
    ctx.fnListeners.add(onFn);
    cleanup.push(() => ctx.fnListeners.delete(onFn));
    draw();
    later(() => {
      quiet = true;
      if (!pressed) draw();
    }, 12000);
  }

  // ── 8. 연습: 실제 입력칸에 받아쓰기 ────────────────────────────────
  function practice() {
    let done = false;
    let hint = '';
    let skippable = false;
    const area = h('textarea', { class: 'ob-practice', rows: 4, placeholder: '여기를 클릭하고, fn을 꾹 누른 채 위 문장을 읽은 뒤 떼세요.' }) as HTMLTextAreaElement;
    area.oninput = () => {
      if (!done && area.value.trim()) {
        done = true;
        draw();
      }
    };
    const draw = () => {
      const val = area.value;
      frame({
        title: done ? '잘 됩니다!' : '직접 말해 보세요',
        lead: done ? '말한 내용이 다듬어져 들어왔습니다. 다른 앱에서도 똑같이 쓰면 됩니다.' : '입력칸을 클릭하고 fn을 꾹 누른 채 아래 문장을 읽은 다음 떼세요. 군말과 고친 말이 정리되어 들어옵니다.',
        body: h('div', null,
          h('blockquote', { class: 'ob-sample' }, `“${SAMPLE}”`),
          area,
          hint && !done && h('p', { class: 'ob-result bad' }, hint),
          done && h('p', { class: 'ob-result ok' }, '두 번 빠르게 누르면 손을 떼도 계속 듣고, 다시 누르면 끝납니다. 긴 말을 할 때 편합니다.')),
        primary: primaryBtn('계속', next, !done),
        secondary: !done && skippable && quietBtn('건너뛰기', next),
        panel: h('div', { class: 'ob-tips' },
          h('b', null, '이렇게 씁니다'),
          h('div', { class: 'ob-tip' }, h('kbd', null, 'fn'), h('span', null, '꾹 누른 채 말하고 떼기 → 입력')),
          h('div', { class: 'ob-tip' }, h('kbd', null, 'fn'), h('kbd', null, 'fn'), h('span', null, '두 번 → 손 떼고 말하기, 다시 누르면 끝')),
          h('div', { class: 'ob-tip' }, h('kbd', null, 'fn'), h('kbd', null, 'fn'), h('kbd', null, 'fn'), h('span', null, '세 번 → 취소'))),
      });
      area.value = val;
      if (!done) setTimeout(() => area.focus(), 0);
    };
    draw();
    const onTap = () => {
      if (stepId !== 'practice' || done) return;
      hint = '톡 누르지 말고, 꾹 누른 채로 말한 뒤 떼세요.';
      draw();
    };
    ctx.tapListeners.add(onTap);
    cleanup.push(() => ctx.tapListeners.delete(onTap));
    later(() => {
      if (!done && document.activeElement !== area) {
        hint = '입력칸을 먼저 클릭하세요.';
        draw();
      }
    }, 10000);
    later(() => {
      skippable = true;
      if (!done) draw();
    }, 15000);
  }

  // ── 9. 완료 ────────────────────────────────────────────────────
  async function done() {
    const list: SetupComponent[] = await api.setupStatus();
    const perms = await api.permStatus();
    const ok = (b: boolean | undefined) => (b ? icon('i-check') : '·');
    const item = (good: boolean | undefined, title: string, text: string) => h('div', { class: `ob-perm${good ? ' ok' : ''}` }, h('span', { class: 'ob-perm-n' }, ok(good)), h('div', { class: 'ob-perm-text' }, h('b', null, title), h('span', null, text)));
    const has = (id: string) => list.find((c) => c.id === id)?.installed;
    frame({
      title: '준비됐습니다',
      lead: '빠진 것은 설정에서 언제든 마저 할 수 있습니다.',
      body: h('div', { class: 'ob-perms' },
        uses.dictation && item(perms.microphone === 'granted' && perms.inputMonitoring === 'granted' && perms.accessibility === 'granted' && has('turbo'), '받아쓰기', 'fn을 꾹 누른 채 말하면 커서 위치에 입력'),
        uses.meetings && item(perms.microphone === 'granted' && has('engine'), '회의 녹음', '위쪽 회의 녹음 버튼이나 화면 왼쪽 독으로 시작'),
        uses.meetings && item(has('diarize'), '화자 구분', has('diarize') ? '준비됨' : '설정 › 엔진·계정·토큰에서 마저 설치')),
      primary: primaryBtn('시작하기', finish),
      panel: h('div', { class: 'ob-tips' },
        h('b', null, '알아 두면 좋은 것'),
        h('div', { class: 'ob-tip' }, h('kbd', null, '⌘K'), h('span', null, '회의·받아쓰기 검색과 바로가기')),
        h('div', { class: 'ob-tip' }, h('kbd', null, '⌘,'), h('span', null, '설정')),
        h('div', { class: 'ob-tip' }, icon('i-book'), h('span', null, '자주 틀리는 이름은 사전에 넣어 두세요'))),
    });
  }

  const VIEWS = { welcome, permissions, token, engine, account, mic, fnkey, practice, done };
  function render() {
    if (!steps().some((s) => s.id === stepId)) stepId = 'welcome';
    VIEWS[stepId]();
  }

  document.querySelector<HTMLElement>('.shell')!.hidden = true;
  root.hidden = false;
  api.onboardingSet({ step: stepId, uses, completed: false });
  render();
}
