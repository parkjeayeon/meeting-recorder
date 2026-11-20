// 설정 › 엔진 칸: 설치할 것 목록(설치·받기·지우기·진행률·막힌 까닭)과 앱 폴더 사용량, 엔진 탭의 점.
// 본체의 설치 알림(onSetup)은 여기서 한 번만 받아 그리고, 같이 듣는 쪽(처음 설정의 엔진 단계)에게 그다음에 나눠 준다.
// 설치가 돌다 끝나면 설정을 다시 읽는다 (화자 구분·엔진 상태) — 돌던 중이었는지는 이 칸만 갖는다.
import { settingsRegionRenderer, SettingsSetup } from './regions.tsx';
import { gb, type SettingsCtx, type SettingsDeps } from './state.ts';
import type { SetupComponent } from './types.ts';
import type { ActionView, SetupView } from './view.ts';

export interface SetupRole {
  readonly render: (list: SetupComponent[]) => void;
  /** 본체의 설치 알림을 붙인다 */
  readonly listen: () => void;
  readonly setupListeners: Set<(list: SetupComponent[]) => void>;
}

export function createSetup(ctx: SettingsCtx, { confirm }: Pick<SettingsDeps, 'confirm'>): SetupRole {
  const { api, settingsStore, toast, dialog, openSettings } = ctx;
  const setupRegion = settingsRegionRenderer(document.getElementById('compList')!, SettingsSetup);

  // ── 엔진: 설치 · 크기 · 지우기 ───────────────────────────────────────────
  let setupWasRunning = false;

  function renderSetup(list: SetupComponent[]) {
    let total = 0;
    const running = list.some((c) => c.job?.running);
    document.getElementById('engineDot')!.hidden = !list.some((c) => !c.installed && c.id !== 'large');
    const rows: SetupView[] = list.map((c) => {
      if (c.installed && c.size) total += c.size;
      const job = c.job;
      const state: [string, string] = job?.running ? ['', '설치 중'] : job?.error ? ['bad', '실패'] : c.installed ? ['ok', '설치됨'] : c.partial ? ['bad', '모델 없음'] : ['', '없음'];
      const actions: ActionView[] = [];
      if (!c.installed && !job?.running && !(c.blocker === 'brew')) {
        actions.push({ className: 'btn small primary', click: () => api.setupInstall(c.id), label: job?.error ? '다시 시도' : c.id === 'engine' ? '설치' : '받기' });
      }
      if (c.installed && c.removable && !job?.running) {
        actions.push({ className: 'btn small ghost', click: async () => {
          if (!(await confirm(`${c.name}을(를) 지울까요?`, `${gb(c.size!)}를 확보합니다. 필요하면 언제든 다시 받을 수 있습니다.`, '지우기'))) return;
          try {
            await api.setupRemove(c.id);
            toast(`${c.name}을(를) 지웠습니다`);
            await settingsStore.refresh();
          } catch (err) {
            toast('지우지 못했습니다', (err as Error).message, { bad: true });
          }
        }, label: '지우기' });
      }
      const notes: SetupView['notes'][number][] = [];
      if (job?.error) notes.push({ className: 'comp-note bad', text: job.error, action: c.blocker === 'token' ? { className: 'link', click: () => openSettings('accounts'), label: '토큰 넣기' } : null });
      if (!c.installed && c.blocker === 'brew') notes.push({ className: 'comp-note', text: '터미널에서 Homebrew를 먼저 설치하세요.', action: { className: 'link', click: () => api.openExternal('https://brew.sh'), label: 'brew.sh 열기' } });
      if (!c.installed && c.blocker === 'token' && !job?.running && !job?.error) notes.push({ className: 'comp-note', text: 'Hugging Face 토큰이 있어야 모델을 받을 수 있습니다.', action: { className: 'link', click: () => openSettings('accounts'), label: '토큰 넣기' } });
      return {
        name: c.name, desc: c.desc, state,
        size: c.size && (c.installed || c.id !== 'engine') && (c.installed ? gb(c.size!) : `약 ${gb(c.size!)}`),
        actions,
        progress: job?.running ? { indeterminate: job.pct == null, width: Math.round((job.pct ?? 0.3) * 100), text: job.text ?? '' } : null,
        notes,
      };
    });
    setupRegion.render(rows);
    document.getElementById('compTotal')!.textContent = `앱 폴더 사용량 ${gb(total)} · ~/Library/Application Support/meeting-recorder`;
    // 설치가 끝나면 화자 구분·엔진 상태를 다시 읽는다
    if (setupWasRunning && !running) void settingsStore.refresh();
    setupWasRunning = running;
  }
  const setupListeners = new Set<(list: SetupComponent[]) => void>();

  return {
    render: renderSetup,
    listen: () => {
      api.onSetup((list: SetupComponent[]) => {
        if (dialog.open) renderSetup(list);
        else document.getElementById('engineDot')!.hidden = !list.some((c) => !c.installed && c.id !== 'large'); // 닫혀 있어도 엔진 탭 점은 바로
        setupListeners.forEach((fn) => fn(list));
      });
    },
    setupListeners,
  };
}
