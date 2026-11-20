import type { SetupComponent } from '../settings/types.ts';
import { primaryBtn, quietBtn, type StepCtx } from './state.ts';

// ── 4. 엔진 설치: 필요한 것만, 설치는 이 화면을 떠나도 계속된다 ─────────
// 진행률은 설정 창이 받는 onSetup을 같이 듣는다(ctx.setupListeners) — 첫 그리기 뒤에 붙이고 떠날 때 뗀다.
// 처음 들어올 때 한 번만 설치를 시작한다: 받을 것이 있고, 받는 중이 아니고, 실패한 것이 없을 때.
export async function engine(ctx: StepCtx) {
  const { api, toast, uses, frame, next, onLeave } = ctx;
  const instance = ctx.instance();
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
      instance,
      title: '음성 인식 엔진을 설치합니다',
      lead: ready && !missing.length ? '모두 설치했습니다.' : `필요한 프로그램과 모델을 받습니다. 받아쓰기에 필요한 것만 끝나면 넘어갈 수 있고, 나머지는 뒤에서 계속 받습니다.`,
      body: {
        kind: 'engine',
        items: list.map((c) => ({
          id: c.id, installed: c.installed, running: Boolean(c.job?.running), name: c.name, optional: !required(c),
          text: c.job?.error ? c.job.error : c.job?.running ? c.job.text ?? '준비 중' : c.blocker === 'brew' ? '터미널에서 Homebrew를 먼저 설치하세요 (brew.sh)' : c.blocker === 'token' ? 'Hugging Face 토큰이 있어야 받을 수 있습니다' : c.desc,
          progress: c.job?.pct ?? null,
          size: !c.size ? '' : c.installed ? gb(c.size) : `약 ${gb(c.size)}`,
          brew: c.blocker === 'brew' && !c.installed,
          install: !c.installed && !c.job?.running && c.blocker !== 'brew', retry: Boolean(c.job?.error),
          openBrew: () => api.openExternal('https://brew.sh'), start: () => api.setupInstall(c.id),
        })),
      },
      primary: ready ? primaryBtn(busy ? '계속 (설치는 뒤에서 계속)' : '계속', next) : primaryBtn(busy ? '설치 중…' : '모두 설치', installAll, busy),
      secondary: !ready && quietBtn('나중에 설치하기', () => {
        toast('엔진 없이 계속합니다', '설정 › 엔진에서 언제든 설치할 수 있습니다.');
        next();
      }),
    });
  };
  draw();
  const onSetup = (l: SetupComponent[]) => {
    if (ctx.stepId() !== 'engine') return;
    list = l.filter(wanted);
    draw();
  };
  ctx.setupListeners.add(onSetup);
  onLeave(() => ctx.setupListeners.delete(onSetup));
  // 처음 들어오면 바로 설치를 시작한다
  if (list.some((c) => !c.installed && !c.job?.running && c.blocker !== 'brew' && !c.job?.error)) installAll();
}
