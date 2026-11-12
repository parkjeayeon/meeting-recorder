interface ToastOptions {
  readonly bad?: boolean;
  readonly action?: string | null;
  readonly onAction?: (() => void) | null;
  readonly ms?: number;
}

// 잠깐 보여 주는 알림(#toasts)과 확인 창(#confirm) — 옛 화면 코드에서 옮겼다, 만드는 DOM·시간은 그대로.
// 안 좋은 알림은 본체 기록에도 남긴다(log는 부르는 쪽이 넘긴다: shared/ui는 shared/api를 가져올 수 없다)
export function createToaster(log: (msg: string) => void) {
  return function toast(title: string, detail: string | null = '', { bad = false, action = null, onAction = null, ms = 4200 }: ToastOptions = {}) {
    const el = document.createElement('div');
    el.className = `toast${bad ? ' bad' : ''}`;
    el.setAttribute('role', 'status');
    const heading = document.createElement('b');
    heading.append(title);
    el.append(heading);
    if (detail) {
      const text = document.createElement('span');
      text.append(detail);
      el.append(text);
    } else if (detail !== null && detail !== undefined) el.append(detail); // 옛 h()처럼 빈 글자는 그대로 붙이고 null은 건너뛴다
    const close = () => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 200);
    };
    if (action) {
      const button = document.createElement('button');
      button.onclick = () => { onAction?.(); close(); };
      button.append(action);
      el.append(button);
    }
    document.getElementById('toasts')!.append(el);
    setTimeout(close, ms);
    if (bad) log(`${title} ${detail}`);
  };
}

export function confirmBox(title: string, text: string, yes: string): Promise<boolean> {
  const dlg = document.getElementById('confirm') as HTMLDialogElement;
  document.getElementById('confirmTitle')!.textContent = title;
  document.getElementById('confirmText')!.textContent = text;
  document.getElementById('confirmYes')!.textContent = yes;
  dlg.showModal();
  document.getElementById('confirmNo')!.focus();
  return new Promise((resolve) => {
    const done = (v: boolean) => {
      dlg.close();
      resolve(v);
    };
    document.getElementById('confirmYes')!.onclick = () => done(true);
    document.getElementById('confirmNo')!.onclick = () => done(false);
    dlg.oncancel = () => resolve(false);
  });
}
