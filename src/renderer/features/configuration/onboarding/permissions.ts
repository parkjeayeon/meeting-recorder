import { primaryBtn, quietBtn, type StepCtx } from './state.ts';

// ── 2. 권한: 카드 하나씩, 허용되면 다음 카드로 ───────────────────────
// 1초마다 다시 확인하는 타이머와 창 focus 처리기는 첫 그리기 뒤에 붙이고, 단계를 떠날 때 flow가 둘 다 뗀다.
export async function permissions(ctx: StepCtx) {
  const { api, toast, uses, frame, next, every, onLeave } = ctx;
  const instance = ctx.instance();
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
      instance,
      title: allOk ? '권한을 모두 허용했습니다' : '권한을 허용해 주세요',
      lead: allOk ? '고맙습니다. 이 권한들은 위에 적은 용도로만 씁니다.' : '허용을 누르면 macOS가 묻거나 시스템 설정이 열립니다. 켜고 돌아오면 자동으로 다음으로 넘어갑니다.',
      body: {
        kind: 'permissions',
        items: PERMS.map((p) => ({
          kind: p.kind, ok: granted(p), active: p === active, name: p.name, text: p.text, clicked: clicked.has(p.kind),
          request: async () => {
            clicked.add(p.kind);
            status = await api.permRequest(p.kind);
            draw();
          },
        })),
        dictation: uses.dictation, fnWarn: Boolean(fnWarn), openKeyboard: () => api.openKeyboardSettings(),
      },
      primary: primaryBtn('계속', next, !allOk),
      secondary: !allOk && quietBtn('나중에 허용하기', () => {
        toast('권한 없이 계속합니다', '받아쓰기는 권한을 허용해야 동작합니다. 설정 › 권한에서 언제든 허용할 수 있습니다.');
        next();
      }),
    });
  };
  draw();
  // 1초마다, 그리고 시스템 설정에서 돌아올 때 다시 확인한다. 새로 허용되면 창을 앞으로
  const check = async () => {
    const before = PERMS.filter(granted).length;
    status = await api.permStatus();
    if (uses.dictation) fnWarn = await api.fnKeyWarning();
    if (PERMS.filter(granted).length > before) api.focusApp();
    if (ctx.stepId() === 'permissions') draw();
  };
  every(check, 1000);
  window.addEventListener('focus', check);
  onLeave(() => window.removeEventListener('focus', check));
}
