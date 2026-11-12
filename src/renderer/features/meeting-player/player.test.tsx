// @vitest-environment jsdom
// 재생: 상태 구독·속도·따라가기, 재생 중인 줄 찾기, 화자 덩어리, 이름 바꾸기(Enter 저장·Esc 취소·밖을 누르면 저장)
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { parseScript } from '../../../core/script.mts';
import { createIslands } from '../../shared/page-host/index.tsx';
import { createPlayback, playingIndex, ScriptBody, speakerRuns, SpeakerBarBody } from './index.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const lines = parseScript(['[00:02] [화자 1] 배포 얘기', '[00:06] [화자 2] 화요일 오전', '[00:11] [화자 1] QA는 월요일', '설명 줄'].join('\n'));
let host: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '';
  host = document.createElement('div');
  document.body.append(host);
});
function fakeAudio() {
  const a = Object.assign(new EventTarget(), { currentTime: 0, paused: true, duration: NaN, playbackRate: 1, play: vi.fn(async () => {}), pause: vi.fn() });
  return a as unknown as HTMLAudioElement;
}

describe('재생', () => {
  it('상태는 audio 소식으로 바뀌고, 속도는 1 → 1.25 → … → 1, 따라가기는 저장', () => {
    const audio = fakeAudio();
    const save = vi.fn();
    const pb = createPlayback(audio, { initial: true, save });
    const seen = vi.fn();
    pb.subscribe(seen);
    const first = pb.getSnapshot();
    expect(pb.getSnapshot()).toBe(first); // 바뀌지 않으면 같은 스냅샷
    audio.currentTime = 12;
    audio.dispatchEvent(new Event('timeupdate'));
    expect([seen.mock.calls.length, pb.getSnapshot().time]).toEqual([1, 12]);
    for (const r of [1.25, 1.5, 2, 1]) {
      pb.nextRate();
      expect(audio.playbackRate).toBe(r);
    }
    pb.setFollow(false);
    expect([save.mock.calls[0], pb.getSnapshot().follow]).toEqual([[false], false]);
    pb.seek(30);
    expect([audio.currentTime, (audio.play as unknown as ReturnType<typeof vi.fn>).mock.calls.length]).toEqual([30, 1]);
  });

  it('재생 중인 줄: 지금 시각 직전 줄, 멈춘 채 0초면 없음', () => {
    expect([playingIndex([2, 6, 11], 7, false), playingIndex([2, 6, 11], 1, false), playingIndex([2, 6, 11], 0, true)]).toEqual([1, -1, -1]);
  });

  it('화자 덩어리: 같은 사람이 8초 안에 이어 말하면 한 덩어리, 한 줄은 최대 30초', () => {
    const raw = parseScript(['[00:00] [A] 하나', '[00:05] [A] 둘', '[01:00] [B] 셋'].join('\n'));
    expect(speakerRuns(raw, 120)).toEqual([{ who: 'A', start: 0, end: 35 }, { who: 'B', start: 60, end: 90 }]);
  });
});

describe('스크립트·화자', () => {
  it('줄을 누르면 그 시각부터, 재생 중인 줄은 playing, 시각 없는 줄은 그대로', () => {
    const audio = fakeAudio();
    const pb = createPlayback(audio, { initial: false, save: vi.fn() });
    act(() => createIslands().mount(host, ScriptBody, { lines, color: () => 'var(--s1)', playback: pb, matcher: null, openTerm: vi.fn(), rename: vi.fn() }));
    act(() => (host.querySelectorAll('.stime')[1] as HTMLElement).click());
    expect(audio.currentTime).toBe(6);
    act(() => audio.dispatchEvent(new Event('seeked')));
    expect([...host.querySelectorAll('.sline')].map((r) => r.className)).toEqual(['sline', 'sline playing', 'sline', 'sline']);
  });

  it('이름 바꾸기: 그 자리 입력칸, Enter는 저장, Esc는 그만둠, 같은 이름이면 그만둠', () => {
    const rename = vi.fn();
    act(() => createIslands().mount(host, SpeakerBarBody, { order: ['화자 1', '화자 2'], color: () => 'red', rename }));
    expect(host.querySelector('.spk-bar-hint')).not.toBeNull();
    act(() => (host.querySelector('.spk-chip') as HTMLElement).click());
    const input = host.querySelector('input.rename') as HTMLInputElement;
    expect([input.value, document.activeElement === input]).toEqual(['화자 1', true]);
    input.value = '민준';
    act(() => void input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })));
    act(() => void input.dispatchEvent(new Event('blur'))); // 두 번 저장하지 않는다
    expect(rename.mock.calls).toEqual([['화자 1', '민준']]);
    act(() => createIslands().mount(host, SpeakerBarBody, { order: ['화자 1'], color: () => 'red', rename }));
    act(() => (host.querySelector('.spk-chip') as HTMLElement).click());
    act(() => void host.querySelector('input.rename')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(rename.mock.calls.at(-1)).toEqual(['화자 1', null]);
  });
});
