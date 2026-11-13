// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import html from '../../index.html?raw';
import { mountImportMeeting } from './index.ts';

const q = <E extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<E>(selector)!;
const input = (selector: string) => q<HTMLInputElement>(selector);
const submit = () => q('#importYes').onclick!.call(q('#importYes'), new MouseEvent('click') as PointerEvent);
const files = [
  { path: '/audio/01.wav', name: '01.wav', durationSec: 65 },
  { path: '/audio/02.wav', name: '02.wav', durationSec: 0 },
  { path: '/audio/03.wav', name: '03.wav', durationSec: null },
];
const guess = { at: '2026-10-02T09:04:00', source: 'name' };

function mount() {
  const api = {
    pickAudio: vi.fn().mockResolvedValue({ files, guess }),
    importMeeting: vi.fn().mockResolvedValue({ count: 3, id: '회의 /1' }),
  };
  const toast = vi.fn();
  const historyChanged = vi.fn();
  const handle = mountImportMeeting({ api, toast, historyChanged });
  return { api, toast, historyChanged, handle };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-13T12:34:00'));
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
  q<HTMLDialogElement>('#importSheet').showModal = function () { this.open = true; };
  q<HTMLDialogElement>('#importSheet').close = function () { this.open = false; };
  location.hash = '';
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it.each([
  ['name', '파일 이름에서 읽었습니다', false],
  ['mtime', '파일 시각으로 짐작했습니다 · 다르면 고쳐 주세요', true],
  ['now', '녹음 시각을 알 수 없어 지금으로 넣었습니다 · 고쳐 주세요', true],
] as const)('fills the guessed date and source for %s and focuses submit', async (source, text, warn) => {
  const { api, handle } = mount();
  api.pickAudio.mockResolvedValue({ files, guess: { ...guess, source } });
  const paths = ['/audio/01.wav'];
  await handle.open(paths);
  expect(api.pickAudio).toHaveBeenCalledExactlyOnceWith(paths);
  expect(input('#importDate').value).toBe('2026-10-02');
  expect(input('#importTime').value).toBe('09:04');
  expect(input('#importDate').max).toBe('2026-11-13');
  expect(input('#importDate').hasAttribute('value')).toBe(false);
  expect(q('#importWhenSrc').textContent).toBe(text);
  expect(q('#importWhenSrc').classList.contains('warn')).toBe(warn);
  expect(q<HTMLDialogElement>('#importSheet').open).toBe(true);
  expect(document.activeElement).toBe(q('#importYes'));
  expect(q('#importOrder').textContent).toBe('이름 순서대로 이어 붙여 회의 하나로 만듭니다');
  expect(q('#importFiles').innerHTML).toBe('<li>01.wav<span class="num">01:05</span></li><li>02.wav</li><li>03.wav</li>');
});

it('uses now for a missing guess and clears the order hint for a single file', async () => {
  const { api, handle } = mount();
  api.pickAudio.mockResolvedValue({ files: files.slice(0, 1) });
  await handle.open();
  expect(api.pickAudio).toHaveBeenCalledExactlyOnceWith(null);
  expect(input('#importDate').value).toBe('2026-11-13');
  expect(input('#importTime').value).toBe('12:34');
  expect(q('#importOrder').textContent).toBe('');
  expect(q('#importWhenSrc').textContent).toBe('');
  expect(q('#importWhenSrc').className).toBe('warn');
});

it('updates speakers in place and recreates the dynamic nodes and resets inputs on every open', async () => {
  const { api, handle } = mount();
  await handle.open();
  const date = input('#importDate');
  const notes = q<HTMLTextAreaElement>('#importNotes');
  const firstFiles = [...q('#importFiles').querySelectorAll('*')];
  const buttons = [...q('#importSpeakers').querySelectorAll('button')];
  expect(buttons.map((b) => b.textContent)).toEqual(['자동', '2명', '3명', '4명', '5명', '6명', '7명', '8명']);
  expect(buttons.map((b) => b.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false', 'false', 'false', 'false', 'false', 'false']);
  buttons[2]!.click();
  expect([...q('#importSpeakers').children]).toEqual(buttons);
  expect(buttons.map((b) => b.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true', 'false', 'false', 'false', 'false', 'false']);
  notes.value = '  녹음 외 메모\n두 번째 줄  ';
  notes.dispatchEvent(new Event('input', { bubbles: true }));
  date.value = '2026-10-03';
  input('#importTime').value = '10:05';
  await submit();
  expect(api.importMeeting).toHaveBeenCalledExactlyOnceWith(files.map((f) => f.path), {
    notes: '녹음 외 메모\n두 번째 줄', speakers: '3', startedAt: new Date('2026-10-03T10:05').toISOString(),
  });
  await handle.open();
  expect([...q('#importFiles').querySelectorAll('*')].some((node) => firstFiles.includes(node))).toBe(false);
  expect([...q('#importSpeakers').children].some((node) => buttons.includes(node as HTMLButtonElement))).toBe(false);
  expect(input('#importDate')).toBe(date);
  expect(q('#importNotes')).toBe(notes);
  expect(notes.value).toBe('');
  expect(q('#importSpeakers button').getAttribute('aria-checked')).toBe('true');
  expect(date.value).toBe('2026-10-02');
  await submit();
  expect(api.importMeeting).toHaveBeenLastCalledWith(files.map((f) => f.path), {
    notes: '', speakers: null, startedAt: new Date('2026-10-02T09:04').toISOString(),
  });
});

it('validates missing, then future, then pre-2000 dates before becoming busy', async () => {
  const { api, handle, toast } = mount();
  await handle.open();
  input('#importDate').value = '';
  await submit();
  expect(toast).toHaveBeenLastCalledWith('회의 날짜를 넣어 주세요', '', { bad: true });
  input('#importDate').value = '2026-11-13';
  input('#importTime').value = '12:36';
  await submit();
  expect(toast).toHaveBeenLastCalledWith('아직 오지 않은 시각입니다', '회의를 시작한 날짜와 시각을 넣어 주세요', { bad: true });
  input('#importDate').value = '1999-12-31';
  await submit();
  expect(toast).toHaveBeenLastCalledWith('날짜를 확인해 주세요', '2000년 이후 날짜만 넣을 수 있습니다', { bad: true });
  vi.setSystemTime(new Date('1998-01-01T00:00'));
  await submit();
  expect(toast).toHaveBeenLastCalledWith('아직 오지 않은 시각입니다', '회의를 시작한 날짜와 시각을 넣어 주세요', { bad: true });
  expect(api.importMeeting).not.toHaveBeenCalled();
  expect(q('#importYes').className).toBe('btn primary');
  expect(q<HTMLDialogElement>('#importSheet').open).toBe(true);
});

it.each([
  ['2000-01-01', '', '2000-01-01T00:00'],
  ['2026-11-13', '12:35', '2026-11-13T12:35'],
])('accepts the date/time boundary %s %s', async (date, time, expected) => {
  const { api, handle } = mount();
  await handle.open();
  input('#importDate').value = date;
  input('#importTime').value = time;
  await submit();
  expect(api.importMeeting).toHaveBeenCalledWith(files.map((f) => f.path), {
    notes: '', speakers: null, startedAt: new Date(expected).toISOString(),
  });
});

it('keeps the icon and text node while busy, ignores duplicate submit/open, and restores without awaiting history', async () => {
  const { api, handle, toast, historyChanged } = mount();
  await handle.open();
  let resolve!: (value: { count: number; id: string }) => void;
  api.importMeeting.mockImplementation(() => new Promise((done) => { resolve = done; }));
  historyChanged.mockImplementation(() => new Promise(() => {}));
  const btn = q<HTMLButtonElement>('#importYes');
  const icon = btn.firstChild;
  const label = btn.lastChild;
  const pending = submit();
  expect(btn.className).toBe('btn primary busy');
  expect(btn.disabled).toBe(false);
  expect(btn.firstChild).toBe(icon);
  expect(btn.lastChild).toBe(label);
  expect(label!.nodeType).toBe(Node.TEXT_NODE);
  expect(label!.textContent).toBe('가져오는 중…');
  input('#importDate').value = '';
  await submit();
  await handle.open(['/ignored.wav']);
  expect(toast).not.toHaveBeenCalled();
  expect(api.importMeeting).toHaveBeenCalledTimes(1);
  expect(api.pickAudio).toHaveBeenCalledTimes(1);
  resolve({ count: 3, id: '회의 /1' });
  await pending;
  expect(q<HTMLDialogElement>('#importSheet').open).toBe(false);
  expect(toast).toHaveBeenCalledExactlyOnceWith('녹음 파일 3개를 이어 붙여 가져왔습니다', '받아쓰기와 회의록을 만들기 시작합니다', {
    action: '보기', onAction: expect.any(Function),
  });
  expect(historyChanged).toHaveBeenCalledOnce();
  expect(toast.mock.invocationCallOrder[0]!).toBeLessThan(historyChanged.mock.invocationCallOrder[0]!);
  toast.mock.calls[0]![2].onAction();
  expect(location.hash).toBe('#meeting/%ED%9A%8C%EC%9D%98%20%2F1');
  expect(btn.className).toBe('btn primary');
  expect(btn.lastChild).toBe(label);
  expect(label!.textContent).toBe('가져오기');
  await handle.open();
  expect(api.pickAudio).toHaveBeenCalledTimes(2);
});

it.each([
  "Error invoking remote method 'meeting:import': Error: 파일 오류",
  "Error invoking remote method 'meeting:import': 파일 오류",
  '파일 오류',
])('strips the remote prefix and restores after failure: %s', async (message) => {
  const { api, handle, toast, historyChanged } = mount();
  await handle.open();
  api.importMeeting.mockRejectedValueOnce(new Error(message));
  await submit();
  expect(toast).toHaveBeenLastCalledWith('가져오지 못했습니다', '파일 오류', { bad: true, ms: 8000 });
  expect(q('#importYes').className).toBe('btn primary');
  expect(q('#importYes').lastChild!.textContent).toBe('가져오기');
  expect(q<HTMLDialogElement>('#importSheet').open).toBe(true);
  expect(historyChanged).not.toHaveBeenCalled();
  api.importMeeting.mockResolvedValueOnce({ count: 1, id: 'one' });
  await submit();
  expect(toast).toHaveBeenLastCalledWith('녹음 파일을 가져왔습니다', '받아쓰기와 회의록을 만들기 시작합니다', {
    action: '보기', onAction: expect.any(Function),
  });
});

it.each([null, undefined, { files: [] }])('does not open for a cancelled or empty pick: %s', async (picked) => {
  const { api, handle, toast } = mount();
  api.pickAudio.mockResolvedValueOnce(picked);
  await handle.open();
  expect(q<HTMLDialogElement>('#importSheet').open).toBe(false);
  expect(q('#importFiles').children).toHaveLength(0);
  expect(toast).not.toHaveBeenCalled();
});

it('allows another pick while the first picker is pending', async () => {
  const { api, handle } = mount();
  let resolve!: (value: unknown) => void;
  api.pickAudio.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const first = handle.open(['/first.wav']);
  await handle.open(['/second.wav']);
  expect(api.pickAudio).toHaveBeenCalledTimes(2);
  resolve({ files: [files[0]], guess });
  await first;
  expect(q('#importFiles').children).toHaveLength(1);
});

it.each(['#importNo', '#importClose', '#importSheet'])('closes through %s but not an interior click', async (selector) => {
  const { handle } = mount();
  await handle.open();
  q('#importTitle').click();
  expect(q<HTMLDialogElement>('#importSheet').open).toBe(true);
  q(selector).click();
  expect(q<HTMLDialogElement>('#importSheet').open).toBe(false);
});
