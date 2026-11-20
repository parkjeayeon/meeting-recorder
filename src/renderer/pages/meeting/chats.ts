// 오른쪽 채팅 자리: 확인 필요 채팅과 흐름도 채팅 중 하나만 열린다. 이 역할이 지금 열린 채팅과 채팅을 연 버튼을 든다.
// 채팅 안(메시지·보내기·적용)은 review-chat.ts·flows.ts가 이 역할이 준 채팅 객체를 바꾼다.
import type { FlowChat, PageCtx, ReviewChat } from './state.ts';

export interface ChatsRole {
  readonly review: () => ReviewChat | null;
  readonly flow: () => FlowChat | null;
  readonly anyOpen: () => boolean;
  /** 확인 필요 채팅을 연다 (연 버튼을 기억하고 흐름도 채팅은 닫는다). 그리기·포커스는 부른 쪽이 */
  readonly openReview: (c: ReviewChat) => void;
  /** 흐름도 채팅을 연다 (연 버튼을 기억하고 확인 필요 채팅은 닫는다). 그리기·포커스는 부른 쪽이 */
  readonly openFlow: (fc: FlowChat) => void;
  /** 닫고 연 버튼(없으면 탭 본문의 첫 컨트롤)으로 포커스를 돌려 다시 그린다 */
  readonly close: () => void;
  /** 답이 왔을 때 채팅 입력칸으로 돌아가도 되나 */
  readonly idle: () => boolean;
  /** 답·다시 받아쓰기·적용을 기다리는 중 */
  readonly waiting: () => boolean;
  /** 주인이 든 쓰던 글 (input 이벤트 때만 바뀐다) */
  readonly draft: () => string | undefined;
}

export function createChats(ctx: PageCtx): ChatsRole {
  let chat: ReviewChat | null = null;
  let flowChat: FlowChat | null = null;
  let chatOpener: (() => HTMLElement | null) | null = null; // 채팅을 연 버튼을 다시 그린 뒤에 찾는 법 (닫으면 그리로 포커스)

  // 채팅을 연 버튼을 다시 그린 뒤에도 찾을 수 있게: 같은 항목(data-id) 안에서 같은 이름의 버튼 중 몇 번째인지
  function openerOf(node: Element | null): (() => HTMLElement | null) | null {
    const page = ctx.page();
    const btn = node?.closest<HTMLElement>('button');
    if (!btn || !page.contains(btn) || btn.closest('.chat')) return null;
    const scope = btn.closest<HTMLElement>('[data-id]')?.dataset.id ?? null;
    const name = (b: Element) => b.getAttribute('aria-label') ?? b.textContent;
    const same = () => [...page.querySelectorAll<HTMLElement>('button')].filter((b) => name(b) === name(btn) && (b.closest<HTMLElement>('[data-id]')?.dataset.id ?? null) === scope && !b.closest('.chat'));
    const at = same().indexOf(btn);
    return () => same()[at] ?? null;
  }
  // 채팅 밖의 버튼으로 열었으면 그 버튼을 기억한다. 채팅 안에서 다시 열면(구간 다시 받아쓰기) 처음 연 버튼을 그대로
  function rememberOpener() {
    const found = openerOf(document.activeElement);
    if (found || (!chat && !flowChat)) chatOpener = found;
  }
  // 채팅 닫기 (닫기 버튼·Escape): 연 버튼이 남아 있으면 그리로, 없으면 탭 본문의 첫 컨트롤로 포커스를 돌린다
  function closeChat() {
    if (!chat && !flowChat) return;
    chat = null;
    flowChat = null;
    const find = chatOpener;
    chatOpener = null;
    const page = ctx.page();
    ctx.wantFocus(() => {
      const panel = page.querySelector('[role="tabpanel"]');
      return find?.() ?? panel?.querySelector<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), textarea, select, [tabindex]:not([tabindex="-1"])') ?? page.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    });
    void ctx.draw();
  }
  return {
    review: () => chat,
    flow: () => flowChat,
    anyOpen: () => Boolean(chat || flowChat),
    openReview: (c) => {
      rememberOpener();
      flowChat = null;
      chat = c;
    },
    openFlow: (fc) => {
      rememberOpener();
      chat = null;
      flowChat = fc;
    },
    close: closeChat,
    // 답이 왔을 때 채팅 입력칸으로 돌아가도 되나: 포커스가 채팅 안이거나 아무 데도 없을 때만 (그사이 다른 입력칸으로 옮겼으면 그대로)
    idle: () => {
      const a = document.activeElement;
      return !a || a === document.body || !a.isConnected || Boolean(a.closest('.chat'));
    },
    waiting: () => (chat ? chat.busy || Boolean(chat.redoing) || chat.applying.size > 0 : Boolean(flowChat?.busy || flowChat?.applying)),
    draft: () => chat?.draft ?? flowChat?.draft,
  };
}
