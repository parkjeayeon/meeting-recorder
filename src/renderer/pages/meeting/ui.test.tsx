// @vitest-environment jsdom
// 회의 페이지 껍데기: 주인이 준 view대로 그리고, 다시 그릴 때마다(version) 안을 새로 만든다. 탭·메뉴·상태 카드의 명령은 주인에게
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createSource } from '../../shared/lib/index.ts';
import { reactPage } from '../../shared/page-host/index.tsx';
import { MeetingPage, type MeetingCommands, type MeetingView } from './index.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const base = (over: Partial<MeetingView>): MeetingView => ({
  version: 1, gone: null,
  head: { title: '배포 회의', when: '2026년 11월 1일 (일) 23:00', length: '30:00', speakers: 2, speakersHint: null, review: { finalized: false, open: 2 }, provider: 'Claude Code', model: null, audio: null, diarizeError: null },
  menu: { minutes: true, remake: true, busy: false, transcript: true, compress: { bytes: 689e6, estimate: 86e6 }, compressBusy: false, speakersValue: '3' },
  speakerBar: null, player: null, compress: null, state: null, tabs: [['minutes', '회의록', null], ['review', '확인 필요', '2']], tab: 'minutes', body: { kind: 'none' }, chat: null, flowChat: null, ...over,
});
let view: MeetingView | null;
const source = createSource(() => view, () => [view]);
const commands = Object.fromEntries(['setTab', 'copyMinutes', 'copyScript', 'copyTranscript', 'makeClean', 'remake', 'resume', 'reveal', 'compress', 'declineCompress', 'trash', 'back', 'toMeetings', 'setFindScope'].map((k) => [k, vi.fn(async () => {})])) as unknown as MeetingCommands;
const btn = (t: string) => [...document.querySelectorAll('button')].find((b) => b.textContent!.trim().startsWith(t)) as HTMLButtonElement;
beforeEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});
function mount(v: MeetingView | null) {
  view = v;
  const page = reactPage(MeetingPage, { source, commands });
  document.body.append(page.el);
  return page;
}

describe('회의 페이지', () => {
  it('읽는 동안은 빈 페이지, 그 뒤 머리·탭, 확인 상태와 탭은 주인의 setTab', () => {
    mount(null);
    expect(document.body.innerHTML).toBe('<div style="display: contents;"><div class="page"></div></div>');
    act(() => {
      view = base({});
      source.changed();
    });
    expect(document.querySelector('.meet-head h1')!.textContent).toBe('배포 회의');
    expect(btn('초안').textContent).toBe('초안 · 확인 2개 남음');
    act(() => btn('확인 필요').click());
    expect(commands.setTab).toHaveBeenCalledWith('review');
    expect(commands.setFindScope).toHaveBeenCalled();
  });

  it('더 보기 메뉴: 압축 크기, 밖을 누르면 닫힘, 다시 만들기는 고른 참석 인원으로', async () => {
    mount(base({}));
    act(() => (document.querySelector('[aria-label="더 보기"]') as HTMLElement).click());
    expect(btn('녹음 압축하기').textContent).toBe('녹음 압축하기 (689MB → 약 86MB)');
    await act(async () => {
      await new Promise((r) => setTimeout(r));
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(document.querySelector('.menu')).toBeNull();
    act(() => btn('다시 만들기').click());
    const sel = document.querySelector('.menu select') as HTMLSelectElement;
    expect(sel.value).toBe('3');
    sel.value = '5';
    act(() => btn('녹취부터 다시 만들기').click());
    expect(commands.remake).toHaveBeenCalledWith('5');
  });

  it('상태 카드: 쓰다가 멈췄으면 회의록만 다시 쓰기, 지워진 회의는 뒤로·회의 목록', () => {
    mount(base({ state: { kind: 'stalled', offline: true, error: '', speakersValue: '' }, tabs: [], tab: null }));
    expect(document.querySelector('.state b')!.textContent).toBe('인터넷 연결이 없어 회의록을 쓰지 못했습니다');
    act(() => btn('회의록만 다시 쓰기').click());
    expect(commands.resume).toHaveBeenCalled();
    act(() => {
      view = { ...base({}), version: 2, gone: { canBack: true }, head: null };
      source.changed();
    });
    act(() => btn('뒤로').click());
    expect(commands.back).toHaveBeenCalled();
  });

  it('다시 그리면 안을 새로: 열어 둔 메뉴가 닫힌다 (옛 화면처럼)', () => {
    mount(base({}));
    act(() => (document.querySelector('[aria-label="더 보기"]') as HTMLElement).click());
    expect(document.querySelector('.menu')).not.toBeNull();
    act(() => {
      view = base({ version: 2 });
      source.changed();
    });
    expect(document.querySelector('.menu')).toBeNull();
  });
});
