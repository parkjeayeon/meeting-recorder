import type { EngineStatus, SettingsStore } from '../../../entities/settings/index.ts';
import type { IssueStore } from '../../../entities/issue/index.ts';
import type { RecorderApi } from '../../../shared/api/index.ts';
import { dayLabel, fmt, PROVIDER_NAME, remember, store, TIME } from '../../../shared/lib/index.ts';
import { mountReact } from '../../../shared/page-host/index.tsx';
import { el as h, type confirmBox, type createToaster } from '../../../shared/ui/index.tsx';
import type { ProviderInfo, SetupComponent, TokenKind, TokenSource, UsageResult, UsageWindow } from './types.ts';
import { SettingsDialogBody } from './ui.tsx';

export interface SettingsDeps {
  readonly api: RecorderApi;
  readonly settings: SettingsStore;
  readonly issues: IssueStore;
  readonly toast: ReturnType<typeof createToaster>;
  readonly confirm: typeof confirmBox;
  readonly closePalette: () => void;
  readonly recordingsChanged: () => void;
  readonly rerunOnboarding: () => void;
}

export interface SettingsHandle {
  readonly open: (sec?: string) => void;
  readonly refreshPermissions: () => Promise<void>;
  readonly showRecordingsDir: (dir: string, def: string) => void;
  readonly loadDevices: () => Promise<void>;
  readonly updateMicHint: () => void;
  readonly setupListeners: Set<(list: SetupComponent[]) => void>;
}

export function mountSettings({ api, settings: settingsStore, issues, toast, confirm, closePalette, recordingsChanged, rerunOnboarding }: SettingsDeps): SettingsHandle {
  const num = (text: string | number) => h('span', { class: 'num' }, String(text));
  const dialog = document.getElementById('settings') as HTMLDialogElement;
  mountReact(dialog, SettingsDialogBody, {});

  // ── 설정 ────────────────────────────────────────────────────────────────
  function openSettings(sec = 'general') {
    closePalette();
    for (const tab of document.querySelectorAll<HTMLElement>('.set-tab')) tab.setAttribute('aria-current', String(tab.dataset.sec === sec));
    for (const s of document.querySelectorAll<HTMLElement>('.set-sec')) s.hidden = s.dataset.sec !== sec;
    if (!dialog.open) {
      dialog.showModal();
      (document.activeElement as HTMLElement | null)?.blur(); // 열자마자 첫 탭에 포커스 테두리가 그려지지 않게
    }
    if (sec === 'perms') renderPerms();
    if (sec === 'engine') api.setupStatus().then(renderSetup);
    if (sec === 'cleanup') settingsStore.refreshProviders(true).then(() => loadUsage());
    if (sec === 'accounts') {
      for (const r of dialog.querySelectorAll<HTMLElement>('[data-result]')) r.textContent = '';
      renderConnections();
    }
  }
  for (const tab of document.querySelectorAll<HTMLElement>('.set-tab')) tab.onclick = () => openSettings(tab.dataset.sec);
  document.getElementById('settingsClose')!.onclick = () => dialog.close();
  dialog.addEventListener('click', (e) => e.target === dialog && dialog.close());
  document.getElementById('openSettings')!.onclick = () => openSettings();
  document.getElementById('enginesBtn')!.onclick = () => {
    const bad = issues.getSnapshot().entries.map(([, i]) => i).find((i) => i.sec);
    openSettings(bad?.sec ?? 'engine');
  };

  function setEngine(id: string, state: string, text: string) {
    const el = document.getElementById(id)!;
    el.className = `engine ${state}`;
    el.querySelector('em')!.textContent = text;
  }

  function renderEngine(engine: EngineStatus) {
    const mb = (n: number) => `${Math.round(n / 1e6)}MB`;
    const text = ({
      ready: 'Whisper large-v3-turbo · 이 Mac 안에서 실행',
      loading: '모델을 메모리에 올리는 중…',
      stopped: '꺼져 있음',
      'no-engine': 'whisper.cpp가 설치되어 있지 않습니다. 터미널에서 brew install whisper-cpp',
      'no-model': '음성 인식 모델(약 0.9GB)을 받아야 합니다.',
      downloading: `모델 받는 중 ${mb(engine.received)}${engine.total ? ` / ${mb(engine.total)}` : ''}`,
      error: `오류: ${engine.error}`,
    } as Record<string, string>)[engine.state] ?? engine.state;
    const bad = ['no-engine', 'no-model', 'error'].includes(engine.state);
    document.getElementById('engineLine')!.textContent = text;
    document.getElementById('engineLine')!.classList.toggle('bad', bad);
    const acts = document.getElementById('engineActs')!;
    acts.replaceChildren();
    acts.append(h('button', { class: 'btn small', onclick: () => openSettings('engine') }, bad ? '설치하기' : '엔진 관리'));
    const short = ({ ready: '준비됨', loading: '불러오는 중', downloading: '받는 중', stopped: '꺼짐' } as Record<string, string>)[engine.state] ?? '설정 필요';
    setEngine('engAsr', bad ? 'bad' : engine.state === 'ready' ? 'ok' : 'busy', short);
    issues.set('engine', bad ? {
      title: '받아쓰기를 쓸 수 없습니다', detail: text, sec: 'engine',
      action: '설치하기', onAction: () => openSettings('engine'),
    } : null);
  }

  // ── 사용 한도: 로그인된 Claude Code·Codex가 얼마나 남았는지 (설정 › 다듬기를 열 때, 5분 안이면 저장해 둔 값) ──
  const USAGE_IDS = ['claude-code', 'codex'];
  let usageNow: Record<string, UsageResult> | null = null; // 마지막으로 받은 값
  let usageBusy = false;
  async function loadUsage(force = false) {
    if (usageBusy) return;
    usageBusy = true;
    drawUsage();
    try {
      usageNow = await api.usage({ force });
    } catch (err) {
      usageNow = Object.fromEntries(USAGE_IDS.map((id) => [id, { ok: false, error: (err as Error).message }]));
    }
    usageBusy = false;
    drawUsage();
  }

  const USAGE_NAME = { session: '현재 세션', week: '이번 주', limit: '한도에 걸림 (5분 뒤 다시 확인)' };
  function resetLabel(w: UsageWindow) {
    if (!w.resetsAt) return w.resetsText ? `${w.resetsText} 초기화` : '';
    const d = new Date(w.resetsAt);
    const time = TIME.format(d);
    const today = new Date();
    const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86400e3);
    return `${days === 0 ? '오늘' : days === 1 ? '내일' : dayLabel(d.toISOString())} ${time} 초기화`;
  }

  function drawUsage() {
    for (const el of document.querySelectorAll<HTMLElement>('[data-usage]')) {
      const u = usageNow?.[el.dataset.usage!];
      const again = h('button', { class: 'link', disabled: usageBusy, onclick: () => loadUsage(true) }, usageBusy ? '확인 중…' : '새로 고침');
      if (!u) {
        el.replaceChildren(h('div', { class: 'usage-foot' }, h('span', null, usageBusy ? '남은 사용량 확인 중…' : '남은 사용량'), !usageBusy && again));
        continue;
      }
      if (!u.ok) {
        el.replaceChildren(h('div', { class: 'usage-foot bad' }, h('span', null, `남은 사용량을 읽지 못했습니다 · ${u.error}`), again));
        continue;
      }
      const ago = Math.max(0, Math.round((Date.now() - new Date(u.fetchedAt).getTime()) / 60000));
      el.replaceChildren(
        ...u.windows.map((w) => {
          const left = Math.max(0, Math.round(100 - w.usedPercent));
          return h('div', { class: `usage-row${left < 20 ? ' low' : ''}` },
            h('span', { class: 'usage-name' }, w.kind === 'model-week' ? `이번 주 · ${w.model}` : USAGE_NAME[w.kind]),
            h('span', { class: 'meter', role: 'meter', 'aria-valuenow': String(left), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': '남은 사용량' }, h('i', { style: `width:${left}%` })),
            h('span', { class: 'num' }, `${left}% 남음`),
            h('span', { class: 'usage-reset' }, resetLabel(w)));
        }),
        h('div', { class: 'usage-foot' },
          h('span', null, [ago ? `${ago}분 전 확인` : '방금 확인', u.credits && `크레딧 ${Number.isFinite(Number(u.credits)) ? fmt.format(Math.floor(Number(u.credits))) : u.credits}`, u.via === 'llm' && '출력 형식이 바뀌어 LLM으로 읽음'].filter(Boolean).join(' · ')),
          again));
    }
  }

  function renderSideCleanup() {
    const { saved: settings, providers } = settingsStore.getSnapshot();
    if (!settings || !providers) return;
    let label;
    if (!settings.cleanup) label = '꺼짐';
    else if (settings.provider !== 'auto') label = PROVIDER_NAME[settings.provider]!;
    else label = ['claude-code', 'codex', 'api'].map((id) => providers[id]?.loggedIn && PROVIDER_NAME[id]!).find(Boolean) ?? '계정 없음';
    setEngine('engCleanup', label === '계정 없음' ? 'bad' : settings.cleanup ? 'ok' : '', label);
    issues.set('cleanup', label === '계정 없음' ? { title: '다듬기에 쓸 계정이 없습니다', detail: 'Claude Code·Codex에 로그인하거나 API 키를 넣으세요. 그 전까지는 들린 그대로 입력합니다.', action: '계정 연결', onAction: () => openSettings('accounts'), sec: 'accounts' } : null);
  }

  // 옛 그리기가 돌던 자리에서 동기로 그린다
  settingsStore.subscribe((change) => {
    if (change === 'settings') {
      const s = settingsStore.getSnapshot().saved;
      (document.getElementById('minutesAuto')! as HTMLInputElement).checked = s.minutes;
      (document.getElementById('diarizeOn')! as HTMLInputElement).checked = s.diarize;
      const dl = document.getElementById('diarizeLine')!;
      if (!s.diarizeReady) {
        dl.textContent = '화자 구분 엔진(pyannote)이 설치되어 있지 않습니다. 설정 › 엔진에서 설치하세요.';
        dl.className = 'bad';
      } else if (!s.hasHfToken) {
        dl.textContent = 'Hugging Face 토큰이 필요합니다. 계정·토큰에서 넣어 주세요.';
        dl.className = 'bad';
      } else {
        dl.textContent = '누가 말했는지 구분합니다 (pyannote community-1, 이 Mac 안에서 처리).';
        dl.className = '';
      }
      const dState: [string, string] = !s.diarize ? ['', '꺼짐'] : !s.diarizeReady ? ['bad', '설치 필요'] : s.hasHfToken ? ['ok', '준비됨'] : ['bad', '토큰 필요'];
      setEngine('engDiarize', ...dState);
      issues.set('hf', s.diarize && s.diarizeReady && !s.hasHfToken ? {
        title: '화자 구분에 Hugging Face 토큰이 필요합니다', detail: '토큰을 넣기 전까지 회의 스크립트에 화자가 표시되지 않습니다.',
        action: '토큰 넣기', onAction: () => openSettings('accounts'), sec: 'accounts',
      } : null);
      (document.getElementById('meetingSystem')! as HTMLInputElement).checked = s.meetingSystemAudio;
      (document.getElementById('dictEnabled')! as HTMLInputElement).checked = s.enabled;
      (document.getElementById('dictLanguage')! as HTMLSelectElement).value = s.language;
      (document.getElementById('sideLanguage')! as HTMLSelectElement).value = s.language;
      (document.getElementById('meetLanguage')! as HTMLSelectElement).value = s.meetingLanguage ?? s.language;
      (document.getElementById('dictCleanup')! as HTMLInputElement).checked = s.cleanup;
      renderEngine(s.engine);
      renderSideCleanup();
    } else if (change === 'engine') {
      renderEngine(settingsStore.getSnapshot().engine);
    } else if (change === 'providers') {
      const providers = settingsStore.getSnapshot().providers;
      const box = document.getElementById('providers')!;
      box.replaceChildren();
      const rows: [string, string, string | ProviderInfo][] = [
        ['auto', '자동', '로그인된 계정 중 가장 빠른 것'],
        ['claude-code', 'Claude Code', providers['claude-code']],
        ['codex', 'Codex', providers.codex],
        ['api', 'Anthropic API 키', providers.api],
      ];
      for (const [id, name, info] of rows) {
        const usable = typeof info === 'string' || info.loggedIn;
        const who = typeof info === 'string' ? info : !info.installed ? '설치 안 됨' : info.loggedIn ? info.account ?? (id === 'api' ? '키 저장됨' : '로그인됨') : id === 'api' ? '키 없음 · 계정·토큰에서 입력' : '로그인 필요';
        const input = h('input', { type: 'radio', name: 'provider', value: id, checked: settingsStore.getSnapshot().saved.provider === id, disabled: !usable });
        input.onchange = () => settingsStore.save({ provider: id });
        box.append(h('label', { class: `choice${usable ? '' : ' off'}` }, input, h('b', null, name), h('span', { class: 'who' }, who)));
        if (USAGE_IDS.includes(id) && (info as ProviderInfo).loggedIn) box.append(h('div', { class: 'usage', 'data-usage': id }));
      }
      drawUsage();
      renderSideCleanup();
    }
  });

  (document.getElementById('dictEnabled')! as HTMLInputElement).onchange = (e) => settingsStore.save({ enabled: (e.target as HTMLInputElement).checked });
  (document.getElementById('dictLanguage')! as HTMLSelectElement).onchange = (e) => settingsStore.save({ language: (e.target as HTMLSelectElement).value });
  // 왼쪽 아래 받아쓰기 언어 (설정 › 받아쓰기의 언어와 같은 값)
  (document.getElementById('sideLanguage')! as HTMLSelectElement).onchange = async (e) => {
    await settingsStore.save({ language: (e.target as HTMLSelectElement).value });
    toast('받아쓰기 언어를 바꿨습니다', `${(e.target as HTMLSelectElement).selectedOptions[0]!.textContent} · 다음 fn 받아쓰기부터`);
  };
  (document.getElementById('meetLanguage')! as HTMLSelectElement).onchange = (e) => settingsStore.save({ meetingLanguage: (e.target as HTMLSelectElement).value });
  // 떠 있는 막대에서 받아쓰기 언어를 바꾸면 왼쪽 아래·설정 화면도 같이
  settingsStore.connect();
  (document.getElementById('dictCleanup')! as HTMLInputElement).onchange = (e) => settingsStore.save({ cleanup: (e.target as HTMLInputElement).checked });
  (document.getElementById('minutesAuto')! as HTMLInputElement).onchange = (e) => settingsStore.save({ minutes: (e.target as HTMLInputElement).checked });
  (document.getElementById('diarizeOn')! as HTMLInputElement).onchange = (e) => settingsStore.save({ diarize: (e.target as HTMLInputElement).checked });
  (document.getElementById('meetingSystem')! as HTMLInputElement).onchange = async (e) => {
    await settingsStore.save({ meetingSystemAudio: (e.target as HTMLInputElement).checked });
    renderPerms();
  };
  document.getElementById('openDir')!.onclick = () => api.openRecordings();

  // 녹음 폴더: 기본은 ~/Documents/MeetingRecorder, 사용자가 고르면 바꾼다
  const tilde = (p: string | null | undefined) => p?.replace(/^\/Users\/[^/]+/, '~') ?? '';
  function showRecordingsDir(dir: string, def: string) {
    document.getElementById('recDirPath')!.textContent = tilde(dir);
    document.getElementById('recDirPath')!.title = dir;
    document.getElementById('resetDir')!.hidden = dir === def;
  }
  document.getElementById('chooseDir')!.onclick = async () => {
    try {
      const r = await api.chooseRecordings();
      if (!r) return;
      showRecordingsDir(r.dir, (await api.info()).defaultRecordingsDir);
      await settingsStore.refresh(); // 새 폴더에 있던 사전이 합쳐졌을 수 있다
      toast('녹음 폴더를 바꿨습니다', r.total ? (r.moved ? `기존 녹음 ${r.moved}개를 옮겼습니다${r.skipped ? ` · ${r.skipped}개는 같은 이름이 있거나 옮기지 못해 남겨 두었습니다` : ''}` : '기존 녹음은 원래 폴더에 남겨 두었습니다') : tilde(r.dir));
      recordingsChanged();
    } catch (err) {
      toast('녹음 폴더를 바꾸지 못했습니다', (err as Error).message, { bad: true });
    }
  };
  document.getElementById('resetDir')!.onclick = async () => {
    try {
      const r = await api.resetRecordings();
      showRecordingsDir(r.dir, r.dir);
      toast('기본 녹음 폴더로 돌렸습니다', '바꾼 폴더의 녹음은 그 자리에 남아 있습니다');
      recordingsChanged();
    } catch (err) {
      toast('바꾸지 못했습니다', (err as Error).message, { bad: true });
    }
  };

  // ── 마이크 장치 ─────────────────────────────────────────────────────────
  const BLUETOOTH_HINT = /airpods|bluetooth|buds|headset|hands-?free|beats|jabra|bose|wh-1000|wf-1000/i;

  async function loadDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const select = (document.getElementById('micSelect')! as HTMLSelectElement);
    const cur = select.value;
    select.replaceChildren(new Option('시스템 기본값', ''));
    for (const d of devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default')) select.append(new Option(d.label || '알 수 없는 마이크', d.deviceId));
    select.value = cur || store('micId', ''); // 없는 장치면 브라우저가 알아서 '시스템 기본값'으로 돌린다
    updateMicHint();
  }

  function updateMicHint() {
    const select = (document.getElementById('micSelect')! as HTMLSelectElement);
    const label = select.value ? select.selectedOptions[0]?.textContent : '';
    const bt = BLUETOOTH_HINT.test(label ?? '');
    document.getElementById('micHint')!.textContent = bt ? '블루투스 마이크는 16kHz 이하로 녹음되고 스피커 음질도 떨어집니다. 내장·유선 마이크를 권장합니다.' : '받아쓰기와 회의 녹음에 쓰는 장치';
    document.getElementById('micHint')!.classList.toggle('bad', bt);
  }
  (document.getElementById('micSelect')! as HTMLSelectElement).onchange = () => {
    remember('micId', (document.getElementById('micSelect')! as HTMLSelectElement).value);
    updateMicHint();
  };
  navigator.mediaDevices.addEventListener('devicechange', loadDevices);

  // ── 권한 ────────────────────────────────────────────────────────────────
  const PERMS = [
    { kind: 'microphone', name: '마이크', what: '내 목소리 녹음' },
    { kind: 'inputMonitoring', name: '입력 모니터링', what: 'fn 키 감지' },
    { kind: 'accessibility', name: '손쉬운 사용', what: '받아쓴 글을 커서 위치에 입력' },
    { kind: 'systemAudio', name: '시스템 오디오 녹음', what: '화상 회의 상대방 소리 녹음', optional: () => !settingsStore.getSnapshot().saved?.meetingSystemAudio },
  ];

  async function requestPerm(kind: string, btn?: HTMLButtonElement) {
    if (btn) {
      btn.classList.add('busy'); // 흐리게 하지 않고 진행 중 표시
      btn.textContent = '기다리는 중…';
    }
    renderPerms(await api.permRequest(kind));
  }

  async function renderPerms(status?: Record<string, string>) {
    status ??= await api.permStatus();
    const list = document.getElementById('permList')!;
    list.replaceChildren();
    for (const p of PERMS) {
      const st = status![p.kind];
      const ok = st === 'granted' || st === 'unsupported';
      const optional = !ok && p.optional?.();
      const first = st === 'not-determined' || st === 'unknown';
      const row = h('div', { class: 'perm' },
        h('div', { class: 'field-text' }, h('b', null, p.name), h('span', null, optional ? `${p.what} · 화상 회의 녹음을 켤 때만 필요` : p.what)));
      if (ok) row.append(h('span', { class: 'pill ok' }, st === 'granted' ? '허용됨' : '이 macOS에서는 지원 안 됨'));
      else {
        const btn = h('button', { class: 'btn small primary' }, first ? '허용하기' : '시스템 설정 열기') as HTMLButtonElement;
        btn.onclick = () => requestPerm(p.kind, btn);
        row.append(btn);
      }
      list.append(row);
      issues.set(`perm:${p.kind}`, ok || optional ? null : {
        title: `${p.name} 권한이 필요합니다`, detail: `${p.what}에 씁니다.`, sec: 'perms',
        action: first ? '허용하기' : '시스템 설정 열기', onAction: () => requestPerm(p.kind),
      });
    }
  }

  setInterval(() => document.visibilityState === 'visible' && renderPerms(), 3000);
  api.onPermChanged(() => renderPerms());

  // ── 엔진: 설치 · 크기 · 지우기 ───────────────────────────────────────────
  const gb = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}GB` : `${Math.round(n / 1e6)}MB`);
  let setupWasRunning = false;

  function renderSetup(list: SetupComponent[]) {
    const box = document.getElementById('compList')!;
    box.replaceChildren();
    let total = 0;
    const running = list.some((c) => c.job?.running);
    document.getElementById('engineDot')!.hidden = !list.some((c) => !c.installed && c.id !== 'large');
    for (const c of list) {
      if (c.installed && c.size) total += c.size;
      const job = c.job;
      const state = job?.running ? ['', '설치 중'] : job?.error ? ['bad', '실패'] : c.installed ? ['ok', '설치됨'] : c.partial ? ['bad', '모델 없음'] : ['', '없음'];
      const acts = h('div', { class: 'comp-acts' });
      if (!c.installed && !job?.running && !(c.blocker === 'brew')) {
        acts.append(h('button', { class: 'btn small primary', onclick: () => api.setupInstall(c.id) }, job?.error ? '다시 시도' : c.id === 'engine' ? '설치' : '받기'));
      }
      if (c.installed && c.removable && !job?.running) {
        acts.append(h('button', { class: 'btn small ghost', onclick: async () => {
          if (!(await confirm(`${c.name}을(를) 지울까요?`, `${gb(c.size!)}를 확보합니다. 필요하면 언제든 다시 받을 수 있습니다.`, '지우기'))) return;
          try {
            await api.setupRemove(c.id);
            toast(`${c.name}을(를) 지웠습니다`);
            await settingsStore.refresh();
          } catch (err) {
            toast('지우지 못했습니다', (err as Error).message, { bad: true });
          }
        } }, '지우기'));
      }
      const row = h('div', { class: 'comp' },
        h('div', { class: 'comp-main' }, h('b', null, c.name), h('span', null, c.desc)),
        h('div', { class: 'comp-side' }, h('span', { class: `pill ${state[0]}` }, state[1]), c.size && (c.installed || c.id !== 'engine') && num(c.installed ? gb(c.size!) : `약 ${gb(c.size!)}`)),
        acts);
      if (job?.running) row.append(h('div', { class: 'comp-progress' }, h('div', { class: `bar${job.pct == null ? ' indeterminate' : ''}` }, h('i', { style: `width:${Math.round((job.pct ?? 0.3) * 100)}%` })), h('span', null, job.text ?? '')));
      if (job?.error) row.append(h('div', { class: 'comp-note bad' }, job.error, c.blocker === 'token' && h('button', { class: 'link', onclick: () => openSettings('accounts') }, '토큰 넣기')));
      if (!c.installed && c.blocker === 'brew') row.append(h('div', { class: 'comp-note' }, '터미널에서 Homebrew를 먼저 설치하세요.', h('button', { class: 'link', onclick: () => api.openExternal('https://brew.sh') }, 'brew.sh 열기')));
      if (!c.installed && c.blocker === 'token' && !job?.running && !job?.error) row.append(h('div', { class: 'comp-note' }, 'Hugging Face 토큰이 있어야 모델을 받을 수 있습니다.', h('button', { class: 'link', onclick: () => openSettings('accounts') }, '토큰 넣기')));
      box.append(row);
    }
    document.getElementById('compTotal')!.textContent = `앱 폴더 사용량 ${gb(total)} · ~/Library/Application Support/meeting-recorder`;
    // 설치가 끝나면 화자 구분·엔진 상태를 다시 읽는다
    if (setupWasRunning && !running) void settingsStore.refresh();
    setupWasRunning = running;
  }
  const setupListeners = new Set<(list: SetupComponent[]) => void>();
  api.onSetup((list: SetupComponent[]) => {
    if (dialog.open) renderSetup(list);
    else document.getElementById('engineDot')!.hidden = !list.some((c) => !c.installed && c.id !== 'large'); // 닫혀 있어도 엔진 탭 점은 바로
    setupListeners.forEach((fn) => fn(list));
  });

  // ── 계정·토큰 ───────────────────────────────────────────────────────────
  const SOURCE_TEXT = {
    hf: (s: TokenSource) => (s.app ? '앱에 저장됨' : s.cli ? '터미널 로그인 토큰 사용 중' : '없음'),
    anthropic: (s: TokenSource) => (s.app ? '앱에 저장됨' : s.env ? '환경 변수 사용 중' : '없음'),
  };

  async function renderConnections(status?: Record<TokenKind, TokenSource>) {
    status ??= await api.tokenStatus();
    for (const block of dialog.querySelectorAll<HTMLElement>('.conn-block[data-kind]')) {
      const kind = block.dataset.kind as TokenKind;
      const s = status![kind];
      const has = s.app || s.cli || s.env;
      const pill = block.querySelector<HTMLElement>('[data-state]')!;
      pill.textContent = SOURCE_TEXT[kind](s);
      pill.className = `pill ${has ? 'ok' : kind === 'hf' && settingsStore.getSnapshot().saved?.diarize ? 'bad' : ''}`;
      block.querySelector<HTMLButtonElement>('[data-clear]')!.disabled = !s.app;
      block.querySelector<HTMLButtonElement>('[data-verify]')!.disabled = !has;
    }
    await settingsStore.refreshProviders(true); // 다듬기 칸·왼쪽 아래 다듬기 표시도 같이 바뀌게
    const p = settingsStore.getSnapshot().providers!;
    document.getElementById('connAccounts')!.replaceChildren(...([['claude-code', 'Claude Code'], ['codex', 'Codex']] as const).map(([id, name]) => {
      const info = p[id];
      return h('div', { class: 'account' }, h('b', null, name), h('span', { class: info.loggedIn ? 'ok' : '' }, !info.installed ? '설치 안 됨' : info.loggedIn ? `로그인됨${info.account ? ` · ${info.account}` : ''}` : '로그인 안 됨'));
    }));
  }

  for (const block of dialog.querySelectorAll<HTMLElement>('.conn-block[data-kind]')) {
    const kind = block.dataset.kind as TokenKind;
    const input = block.querySelector<HTMLInputElement>('[data-input]')!;
    const result = block.querySelector<HTMLElement>('[data-result]')!;
    const show = (ok: boolean, text: string) => {
      result.textContent = text;
      result.className = `result ${ok ? 'ok' : 'bad'}`;
    };
    block.querySelector<HTMLButtonElement>('[data-toggle]')!.onclick = (e) => {
      input.type = input.type === 'password' ? 'text' : 'password';
      (e.target as HTMLElement).textContent = input.type === 'password' ? '보기' : '숨기기';
    };
    const save = async () => {
      if (!input.value.trim()) return input.focus();
      await renderConnections(await api.saveToken(kind, input.value));
      input.value = '';
      input.type = 'password';
      block.querySelector<HTMLButtonElement>('[data-toggle]')!.textContent = '보기';
      show(true, '저장했습니다. 확인 중…');
      const r = await api.verifyToken(kind);
      show(r.ok, r.message);
      await settingsStore.refresh();
      settingsStore.refreshProviders(true);
    };
    block.querySelector<HTMLButtonElement>('[data-save]')!.onclick = save;
    input.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.isComposing) save();
    };
    block.querySelector<HTMLButtonElement>('[data-verify]')!.onclick = async () => {
      show(true, '확인 중…');
      const r = await api.verifyToken(kind);
      show(r.ok, r.message);
    };
    block.querySelector<HTMLButtonElement>('[data-clear]')!.onclick = async () => {
      await renderConnections(await api.clearToken(kind));
      show(true, '지웠습니다.');
      await settingsStore.refresh();
      settingsStore.refreshProviders(true);
    };
  }
  for (const b of dialog.querySelectorAll<HTMLElement>('[data-link]')) b.onclick = () => api.openExternal(b.dataset.link);
  document.getElementById('connRefresh')!.onclick = () => renderConnections();

  document.getElementById('rerunOnboarding')!.onclick = () => {
    dialog.close();
    return rerunOnboarding();
  };

  return { open: openSettings, refreshPermissions: renderPerms, showRecordingsDir, loadDevices, updateMicHint, setupListeners };
}
