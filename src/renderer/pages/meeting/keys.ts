// 문서에 붙는 키 처리기: ⌘F·⌘G·Escape(찾기 막대), Escape(채팅), 스페이스(재생·멈춤).
// Escape는 한 번에 하나만 닫는다 — 용어 카드(terms.ts, 붙잡기 단계라 먼저) → ⌘F 막대 → 채팅. 대화상자가 열려 있으면 채팅은 그대로.
// 앞의 것이 닫으면서 preventDefault로 이 키를 넘기지 않는다. 붙이는 차례(찾기 → 채팅 → 스페이스)는 controller.ts가 지킨다
import type { Playback } from '../../features/meeting-player/index.ts';
import type { ChatsRole } from './chats.ts';
import type { FindRole } from './find.ts';
import type { TermsRole } from './terms.ts';

export interface KeysRole {
  readonly onFindKey: (e: KeyboardEvent) => void;
  readonly onEscChat: (e: KeyboardEvent) => void;
  /** 스페이스: 재생·멈춤 */
  readonly onKey: (e: KeyboardEvent) => void;
}

export interface KeysParts {
  readonly page: () => HTMLElement;
  readonly find: Pick<FindRole, 'open' | 'close' | 'step' | 'isOpen'>;
  readonly terms: Pick<TermsRole, 'cardOpen'>;
  readonly chats: Pick<ChatsRole, 'anyOpen' | 'waiting' | 'draft' | 'close'>;
  readonly playback: Pick<Playback, 'toggle'>;
}

export function createKeys({ page, find, terms, chats, playback }: KeysParts): KeysRole {
  const onFindKey = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (e.metaKey && k === 'f') {
      e.preventDefault();
      find.open();
    } else if (e.metaKey && k === 'g' && find.isOpen()) {
      e.preventDefault();
      find.step(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape' && find.isOpen() && !terms.cardOpen() && !e.defaultPrevented && !(e.target as Element).closest?.('input, textarea, dialog')) {
      e.preventDefault();
      find.close();
    }
  };

  // Escape: 열린 채팅을 닫는다 — 포커스가 채팅 안이나 본문(입력칸 밖)에 있을 때만. 대화상자(확인·설정)·⌘F 막대·용어 카드가 열려 있으면
  // 그쪽이 먼저라 건드리지 않는다 (용어 카드·찾기 막대는 닫으면서 preventDefault로 이 키를 넘기지 않는다)
  const onEscChat = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing || !chats.anyOpen()) return;
    if (find.isOpen() || terms.cardOpen() || document.querySelector('dialog[open]')) return;
    const t = e.target as Element;
    const inChat = Boolean(t.closest?.('.chat'));
    const onBody = t === document.body || Boolean(t.closest?.('#view') && !t.closest('input, textarea, select, [contenteditable]'));
    if (!inChat && !onBody) return;
    e.preventDefault();
    // Escape는 버릇처럼 누르는 키라 채팅에 남은 일을 버리지 않는다 (× 버튼은 그대로 닫는다):
    // 답·다시 받아쓰기·적용을 기다리는 중이면 닫지 않는다 — 닫으면 그 결과가 들어갈 곳이 없어 버려진다.
    // 입력칸에 쓴 글이 있어도 닫지 않는다 (draft는 input 이벤트 때만 바뀌므로 입력칸의 지금 값을 읽는다)
    if (chats.waiting()) return;
    const box = page().querySelector<HTMLTextAreaElement>('.chat textarea');
    if ((box?.value ?? chats.draft() ?? '').trim()) return;
    chats.close();
  };

  // 스페이스: 재생·멈춤 (입력칸·대화상자·⌘ 조합은 빼고)
  const onKey = (e: KeyboardEvent) => {
    if ((e.target as Element).closest('input, textarea, select, dialog') || e.metaKey) return;
    if (e.key === ' ') {
      e.preventDefault();
      playback.toggle();
    }
  };

  return { onFindKey, onEscChat, onKey };
}
