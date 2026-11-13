const installed = new WeakSet<Document>();

// 아이콘만 있는 버튼: 마우스를 올리거나 키보드로 옮겨 오면 잠깐 뒤 무슨 버튼인지 글로 보인다 (화면 전체에 하나, 새로 그린 버튼에도).
// 글은 자세한 설명(title)이 있으면 그것, 없으면 이름(aria-label). macOS 기본 말풍선과 겹치지 않게 보이는 동안 title을 잠시 뗀다
export function installTooltips() {
  const doc = document;
  if (installed.has(doc)) return;
  installed.add(doc);

  const hoverTip = doc.createElement('div');
  hoverTip.className = 'hover-tip';
  hoverTip.setAttribute('role', 'tooltip');
  hoverTip.setAttribute('aria-hidden', 'true');
  doc.body.append(hoverTip);
  let tipFor: HTMLElement | null = null;
  let tipTimer: ReturnType<typeof setTimeout> | undefined;
  const ICON_ONLY = 'button, [role="button"], a.icon-btn';
  function tipTarget(node: EventTarget | null) {
    const el = (node as Element | null)?.closest?.<HTMLElement>(ICON_ONLY);
    if (!el || el.closest('.no-tip') || (el.textContent ?? '').trim()) return null; // 글자가 있는 버튼은 이미 무슨 버튼인지 보인다
    return el.getAttribute('title') || el.dataset.tip || el.getAttribute('aria-label') ? el : null;
  }
  function showHoverTip(el: HTMLElement) {
    const text = el.dataset.tip || el.getAttribute('title') || el.getAttribute('aria-label');
    if (el.hasAttribute('title')) {
      el.dataset.tip = el.getAttribute('title')!;
      el.removeAttribute('title');
    }
    // 설정·⌘K 같은 대화상자는 맨 위층에 떠서 본문의 툴팁이 가려진다 → 그 대화상자 안에서 띄운다
    const host = el.closest('dialog[open]') ?? doc.body;
    if (hoverTip.parentNode !== host) host.append(hoverTip);
    hoverTip.textContent = text;
    hoverTip.classList.add('show');
    const r = el.getBoundingClientRect();
    const t = hoverTip.getBoundingClientRect();
    const below = r.bottom + 8 + t.height < innerHeight;
    hoverTip.style.top = `${below ? r.bottom + 8 : r.top - 8 - t.height}px`;
    hoverTip.style.left = `${Math.min(innerWidth - t.width - 8, Math.max(8, r.left + r.width / 2 - t.width / 2))}px`;
  }
  function hideHoverTip() {
    clearTimeout(tipTimer);
    hoverTip.classList.remove('show');
    if (tipFor?.dataset.tip && !tipFor.hasAttribute('title')) tipFor.setAttribute('title', tipFor.dataset.tip); // 다음에 이 버튼을 바꾼 코드가 title을 읽어도 그대로
    tipFor = null;
  }
  const armHoverTip = (el: HTMLElement | null, ms: number) => {
    if (el === tipFor) return;
    hideHoverTip();
    if (!el) return;
    tipFor = el;
    tipTimer = setTimeout(() => el.isConnected && tipFor === el && showHoverTip(el), ms);
  };
  doc.addEventListener('mouseover', (e) => armHoverTip(tipTarget(e.target), 400));
  doc.addEventListener('mouseout', (e) => tipFor && !tipFor.contains(e.relatedTarget as Node | null) && hideHoverTip());
  doc.addEventListener('focusin', (e) => (e.target as Element).matches?.(':focus-visible') && armHoverTip(tipTarget(e.target), 250));
  doc.addEventListener('focusout', () => hideHoverTip());
  doc.addEventListener('mousedown', () => hideHoverTip(), true);
  doc.addEventListener('scroll', () => hideHoverTip(), true);
  doc.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && hoverTip.classList.contains('show')) hideHoverTip();
  });
}
