// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import html from '../../index.html?raw';
import type { MeetingItem } from '../../entities/meeting/index.ts';
import type { DictRecord } from '../../entities/dictation/index.ts';
import { mountPalette, type PaletteDeps } from './index.ts';

const q = <E extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<E>(selector)!;
const items = () => [...document.querySelectorAll<HTMLButtonElement>('#paletteList .pitem')];
const labels = () => [...document.querySelectorAll('#paletteList .pgroup')].map((el) => el.textContent);
const titles = () => items().map((el) => el.querySelector('b')!.textContent);
const search = (value: string) => {
  q<HTMLInputElement>('#paletteInput').value = value;
  q('#paletteInput').dispatchEvent(new Event('input'));
};
const key = (key: string, isComposing = false) => {
  const event = new KeyboardEvent('keydown', { key, isComposing, cancelable: true });
  q('#paletteInput').dispatchEvent(event);
  return event;
};

beforeEach(() => {
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
  for (const id of ['palette', 'settings']) {
    q<HTMLDialogElement>(`#${id}`).showModal = function () { this.open = true; };
    q<HTMLDialogElement>(`#${id}`).close = function () { this.open = false; };
  }
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  location.hash = '';
});
afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
});

function mount() {
  const meetings: MeetingItem[] = [
    { id: 'pending', startedAt: '2026-11-12T09:00:00', durationSec: 30, minutes: { status: 'queued', title: '회의 Pending' } },
    ...Array.from({ length: 8 }, (_, i) => ({
      id: `m /${i}`, startedAt: '2026-11-12T09:00:00', durationSec: 65,
      minutes: { status: 'done', title: `회의 ALPHA ${i}` }, summary: `Summary ${i}`,
    })),
  ];
  const dictations: DictRecord[] = Array.from({ length: 8 }, (_, i) => ({
    id: `d${i}`, startedAt: '2026-11-12T09:00:00', durationSec: 5, app: 'Notes',
    transcript: { raw: `회의 raw ${i}`, ...(i ? { text: `회의 ALPHA ${i}` } : {}) },
  }));
  let recording: ReturnType<PaletteDeps['recording']> = { mode: null, paused: false };
  const api = { toggle: vi.fn(), pause: vi.fn(), openRecordings: vi.fn(), copy: vi.fn().mockResolvedValue(undefined) };
  const deps: PaletteDeps = {
    meetings: () => meetings, dictations: () => dictations, recording: () => recording,
    openSettings: vi.fn(), openMeetingStart: vi.fn(), cancelRecording: vi.fn(), toast: vi.fn(), api,
  };
  const before = q('#palette').outerHTML;
  const palette = mountPalette(deps);
  expect(q('#palette').outerHTML).toBe(before);
  return { palette, deps, api, meetings, dictations, setRecording: (next: typeof recording) => { recording = next; } };
}

describe('mountPalette', () => {
  it('groups navigation, actions and the first three completed meetings for an empty query', () => {
    const { palette } = mount();
    palette.open();
    expect(labels()).toEqual(['이동', '동작', '최근 회의']);
    expect(titles()).toEqual([
      '홈', '받아쓰기 기록', '회의', '사전', '통계', '설정',
      '회의 녹음 시작', '받아쓰기 시작', '계정·토큰 연결', 'macOS 권한', '녹음 폴더 열기',
      '회의 ALPHA 0', '회의 ALPHA 1', '회의 ALPHA 2',
    ]);
    search(' 회의 ');
    expect(labels()).toEqual(['이동 · 동작', '회의', '받아쓰기']);
    expect(titles()).toEqual([
      '회의', '회의 녹음 시작', '회의 Pending', ...Array.from({ length: 5 }, (_, i) => `회의 ALPHA ${i}`),
      '회의 raw 0', ...Array.from({ length: 5 }, (_, i) => `회의 ALPHA ${i + 1}`),
    ]);
    search('  ALpHa  ');
    expect(labels()).toEqual(['회의', '받아쓰기']);
    expect(items()).toHaveLength(12);
    search(' ZZZ ');
    expect(q('#paletteList').innerHTML).toBe('<div class="pempty">"zzz"에 맞는 것이 없습니다</div>');
  });

  it('preserves item markup, attribute order, optional subtitle and duration', () => {
    const { palette, meetings } = mount();
    palette.open();
    expect(items()[0]!.outerHTML).toBe('<button class="pitem" role="option" aria-selected="true"><svg><use href="#i-home"></use></svg><span class="ptext"><b>홈</b></span></button>');
    expect(items()[11]!.outerHTML).toBe('<button class="pitem" role="option" aria-selected="false"><svg><use href="#i-people"></use></svg><span class="ptext"><b>회의 ALPHA 0</b><small>Summary 0</small></span><span class="num">01:05</span></button>');
    meetings[1] = { ...meetings[1]!, summary: '' };
    search('alpha');
    expect(items()[0]!.querySelector('small')).toBeNull();
    expect(items()[0]!.querySelector('.ptext')!.childNodes).toHaveLength(2);
    expect(items()[0]!.querySelector('.ptext')!.lastChild!.nodeType).toBe(Node.TEXT_NODE);
    meetings[1] = { ...meetings[1]!, minutes: { status: 'done', title: '' }, summary: 'empty title' };
    search('empty title');
    expect(items()[0]!.querySelector('b')!.childNodes).toHaveLength(1);
    expect(q('#paletteList').children[0]!.className).toBe('pgroup');
  });

  it('updates keyboard and mouse selection in place and resets it on input', () => {
    const { palette } = mount();
    palette.open();
    const before = items();
    expect(key('ArrowDown', true).defaultPrevented).toBe(false);
    expect(before[0]!.getAttribute('aria-selected')).toBe('true');
    expect(key('ArrowDown').defaultPrevented).toBe(true);
    key('ArrowDown');
    expect(items()).toEqual(before);
    expect(before.map((el) => el.getAttribute('aria-selected')).slice(0, 4)).toEqual(['false', 'false', 'true', 'false']);
    expect(vi.mocked(HTMLElement.prototype.scrollIntoView).mock.contexts.at(-1)).toBe(before[2]);
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest' });
    key('ArrowUp');
    expect(before[1]!.getAttribute('aria-selected')).toBe('true');
    before[5]!.dispatchEvent(new MouseEvent('mouseenter'));
    expect(items()[5]).toBe(before[5]);
    expect(before[5]!.getAttribute('aria-selected')).toBe('true');
    expect(vi.mocked(HTMLElement.prototype.scrollIntoView).mock.contexts.at(-1)).toBe(before[5]);
    expect(key('Escape').defaultPrevented).toBe(false);
    search('');
    expect(items().filter((el) => el.getAttribute('aria-selected') === 'true')).toEqual([items()[0]]);
    key('ArrowUp');
    expect(items()[0]!.getAttribute('aria-selected')).toBe('true');
    for (let i = 0; i < 20; i++) key('ArrowDown');
    expect(items().at(-1)!.getAttribute('aria-selected')).toBe('true');
    search('zzz');
    expect(key('ArrowDown').defaultPrevented).toBe(true);
    expect(key('Enter').defaultPrevented).toBe(false);
    expect(q<HTMLDialogElement>('#palette').open).toBe(false);
  });

  it('closes settings before rendering, shows before focusing, and toggles or closes on backdrop', () => {
    const { palette } = mount();
    q<HTMLDialogElement>('#settings').open = true;
    q<HTMLInputElement>('#paletteInput').value = 'old';
    const show = vi.spyOn(q<HTMLDialogElement>('#palette'), 'showModal').mockImplementation(function (this: HTMLDialogElement) {
      expect(q<HTMLDialogElement>('#settings').open).toBe(false);
      expect(q<HTMLInputElement>('#paletteInput').value).toBe('');
      expect(items()[0]!.getAttribute('aria-selected')).toBe('true');
      this.open = true;
    });
    q('#openPalette').click();
    expect(show).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(q('#paletteInput'));
    q('#paletteInput').click();
    expect(q<HTMLDialogElement>('#palette').open).toBe(true);
    palette.open();
    expect(q<HTMLDialogElement>('#palette').open).toBe(false);
    palette.open();
    q('#palette').click();
    expect(q<HTMLDialogElement>('#palette').open).toBe(false);
  });

  it('closes before running Enter or click actions and reads live recording state at execution', () => {
    const { palette, deps, api, setRecording } = mount();
    palette.open();
    search('회의 녹음');
    setRecording({ mode: 'meeting', paused: false });
    api.toggle.mockImplementation(() => expect(q<HTMLDialogElement>('#palette').open).toBe(false));
    expect(key('Enter').defaultPrevented).toBe(false);
    expect(api.toggle).toHaveBeenCalledWith('meeting');
    palette.open();
    expect(titles()).toContain('회의 녹음 일시정지');
    search('일시정지');
    setRecording({ mode: 'meeting', paused: true });
    items()[0]!.click();
    expect(api.pause).toHaveBeenCalledWith(false);
    palette.open();
    expect(titles()).toContain('회의 녹음 재개');
    search('버리기');
    items()[0]!.click();
    expect(deps.cancelRecording).toHaveBeenCalledOnce();
    setRecording({ mode: 'memo', paused: false });
    palette.open();
    expect(titles()).toContain('받아쓰기 정지');
    expect(titles()).not.toContain('회의 녹음 재개');
  });

  it('copies raw or cleaned dictation text before toasting and encodes meeting routes', async () => {
    const { palette, api, deps } = mount();
    palette.open();
    search('raw');
    items()[0]!.click();
    expect(q<HTMLDialogElement>('#palette').open).toBe(false);
    expect(api.copy).toHaveBeenCalledWith('회의 raw 0');
    expect(deps.toast).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(deps.toast).toHaveBeenCalledWith('복사했습니다');
    palette.open();
    search('alpha');
    items()[6]!.click();
    expect(api.copy).toHaveBeenLastCalledWith('회의 ALPHA 1');
    await Promise.resolve();
    palette.open();
    search('alpha');
    key('Enter');
    expect(location.hash).toBe('#meeting/m%20%2F0');
  });
});
