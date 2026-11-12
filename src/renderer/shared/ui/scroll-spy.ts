// 바로가기(nav)와 본문(root)을 잇는 스크롤 감시 — 옛 화면 코드에서 그대로 옮김. React 화면과 옛 질문 탭이 같이 쓴다.
// 화면 요소를 직접 재고 움직이므로 React가 그린 뒤(레이아웃 효과)에 붙이고, 다시 그리면 떼고 다시 붙인다.

// 바로가기: 지금 자리에서 목표까지 미끄러져 간다 (멀어도 0.65초 안, 지수 감속). 움직임 줄이기면 바로
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches; // 쓸 때 읽는다 (가져오기만 해도 창 API를 부르지 않게)
let glideFrame = 0;
let gliding = false;
const view = () => document.getElementById('view')!;

export function glide(id: string): void {
  const v = view();
  const target = document.getElementById(id);
  if (!target) return;
  const from = v.scrollTop;
  const to = Math.min(v.scrollHeight - v.clientHeight, from + target.getBoundingClientRect().top - v.getBoundingClientRect().top - 8);
  const head = target.querySelector('.ledger-mhead, .sec-h') ?? target;
  const land = () => {
    gliding = false;
    v.onscroll?.(new Event('scroll'));
    head.classList.remove('arrive');
    void (head as HTMLElement).offsetWidth; // 같은 칸을 다시 눌러도 다시 밝아지게
    head.classList.add('arrive');
  };
  cancelAnimationFrame(glideFrame);
  const dist = Math.abs(to - from);
  if (reduceMotion() || dist < 4) {
    v.scrollTop = to;
    return land();
  }
  const ms = Math.min(650, 260 + dist / 12);
  const start = performance.now();
  const ease = (t: number) => (t === 1 ? 1 : 1 - 2 ** (-10 * t));
  gliding = true;
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / ms);
    v.scrollTop = from + (to - from) * ease(t);
    if (t < 1) glideFrame = requestAnimationFrame(step);
    else land();
  };
  glideFrame = requestAnimationFrame(step);
}

// 스크롤 위치에 맞춰 바로가기의 지금 칸을 표시. 연도 펼침·접힘과 표시 이동은 함께 시작해 같은 시간·감속으로 끝난다
// (끝난 뒤의 자리를 보이지 않는 사본으로 먼저 재서 표시를 곧장 보낸다). nav 첫 자식이 .pill이면 그것을, 없으면 만들어 붙인다.
// 돌려주는 함수로 뗀다.
export function scrollSpy(root: HTMLElement, nav: HTMLElement): () => void {
  let pill = nav.firstElementChild as HTMLElement | null;
  if (!pill?.classList.contains('pill')) {
    pill = document.createElement('span');
    pill.className = 'pill';
    pill.setAttribute('aria-hidden', 'true');
    nav.prepend(pill);
  }
  const p = pill;
  const v = view();
  let last: HTMLElement | null = null;
  const openYear = (g: Element | null | undefined) => {
    for (const o of nav.querySelectorAll('.ygroup.open:not(.fixed)')) if (o !== g) o.classList.remove('open');
    g?.classList.add('open');
  };
  const finalY = (btn: HTMLElement) => {
    const ghost = nav.cloneNode(true) as HTMLElement;
    ghost.classList.add('measure-ghost');
    Object.assign(ghost.style, { position: 'fixed', left: '-9999px', top: '0', width: `${nav.offsetWidth}px`, maxHeight: 'none', overflow: 'visible', visibility: 'hidden' });
    document.body.append(ghost);
    const g = ghost.querySelector(`button[data-target="${btn.dataset.target}"]:not([data-year-head])`);
    const y = g ? g.getBoundingClientRect().top - ghost.getBoundingClientRect().top : 0;
    ghost.remove();
    return y;
  };
  const setActive = (btn: HTMLElement | null) => {
    openYear(btn?.closest('.ygroup'));
    last = btn;
    for (const b of nav.querySelectorAll('button')) b.setAttribute('aria-current', String(b === btn));
    p.style.opacity = btn ? '1' : '0';
    if (!btn) return;
    const y = finalY(btn);
    p.style.setProperty('--y', `${y}px`);
    if (y < nav.scrollTop + 24 || y + 28 > nav.scrollTop + nav.clientHeight - 24) nav.scrollTo({ top: y - nav.clientHeight / 2, behavior: reduceMotion() ? 'auto' : 'smooth' });
  };
  for (const b of nav.querySelectorAll('button')) {
    b.onmousedown = (e) => e.preventDefault(); // 누를 때 포커스가 본문을 끌어 움직이지 않게
    b.onclick = () => {
      const target = b.hasAttribute('data-year-head') ? b.closest('.ygroup')!.querySelector<HTMLElement>('.ymonths-in button') : b;
      if (!target) return;
      setActive(target);
      glide(target.dataset.target!);
    };
  }
  const mark = () => {
    if (!root.isConnected) {
      if (v.onscroll === mark) v.onscroll = null;
      return;
    }
    if (gliding) return; // 미끄러져 가는 동안엔 누른 칸 그대로
    const secs = [...root.querySelectorAll<HTMLElement>('[data-spy]')];
    const top = v.getBoundingClientRect().top + 60;
    const cur = secs.filter((sec) => sec.getBoundingClientRect().top <= top).pop() ?? secs[0];
    const btn = cur ? nav.querySelector<HTMLElement>(`button[data-target="${cur.id}"]:not([data-year-head])`) : null;
    if (btn !== last) setActive(btn);
  };
  v.onscroll = mark;
  const frame = requestAnimationFrame(() => {
    p.style.transition = 'none';
    mark();
    requestAnimationFrame(() => (p.style.transition = ''));
  });
  return () => {
    cancelAnimationFrame(frame);
    if (v.onscroll === mark) v.onscroll = null;
  };
}
