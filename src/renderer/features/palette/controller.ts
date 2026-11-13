import type { DictRecord } from '../../entities/dictation/index.ts';
import { statusText, type MeetingItem } from '../../entities/meeting/index.ts';
import type { RecorderApi } from '../../shared/api/index.ts';
import { clock, createSource, dayLabel, TIME } from '../../shared/lib/index.ts';
import { commit, mountReact } from '../../shared/page-host/index.tsx';
import { PaletteList, type PaletteGroup, type PaletteItem, type PaletteView } from './ui.tsx';

export interface PaletteDeps {
  readonly meetings: () => readonly MeetingItem[];
  readonly dictations: () => readonly DictRecord[];
  readonly recording: () => { readonly mode: 'meeting' | 'memo' | null; readonly paused: boolean };
  readonly openSettings: (sec?: string) => void;
  readonly openMeetingStart: () => void;
  readonly cancelRecording: () => void;
  readonly toast: (title: string) => void;
  readonly api: Pick<RecorderApi, 'toggle' | 'pause' | 'openRecordings' | 'copy'>;
}

export interface PaletteHandle {
  readonly open: () => void;
}

export function mountPalette({ meetings, dictations, recording, openSettings, openMeetingStart, cancelRecording, toast, api }: PaletteDeps): PaletteHandle {
  const dialog = document.getElementById('palette') as HTMLDialogElement;
  const settings = document.getElementById('settings') as HTMLDialogElement;
  const input = document.getElementById('paletteInput') as HTMLInputElement;
  const list = document.getElementById('paletteList')!;
  let paletteItems: readonly PaletteItem[] = [];
  let paletteSel = 0;
  let instance = 0;
  let view: PaletteView | null = null;
  const source = createSource(() => view, () => [view]);
  mountReact(list, PaletteList, { source, select, run: runPalette });

  function paletteResults(q: string): PaletteGroup[] {
    const go = (hash: string) => () => (location.hash = hash);
    const groups: PaletteGroup[] = [];
    const nav: PaletteItem[] = [
      { icon: 'i-home', title: '홈', run: go('#home') },
      { icon: 'i-mic', title: '받아쓰기 기록', run: go('#dictations') },
      { icon: 'i-people', title: '회의', run: go('#meetings') },
      { icon: 'i-book', title: '사전', run: go('#dictionary') },
      { icon: 'i-chart', title: '통계', run: go('#stats') },
      { icon: 'i-gear', title: '설정', run: () => openSettings() },
    ];
    const { mode, paused } = recording();
    const actions = [
      { icon: 'i-rec', title: mode === 'meeting' ? '회의 녹음 종료하고 저장' : '회의 녹음 시작', run: () => (recording().mode === 'meeting' ? api.toggle('meeting') : openMeetingStart()) },
      mode === 'meeting' && { icon: paused ? 'i-play' : 'i-pause', title: paused ? '회의 녹음 재개' : '회의 녹음 일시정지', run: () => api.pause(!recording().paused) },
      mode === 'meeting' && { icon: 'i-x', title: '회의 녹음 취소 (버리기)', run: () => cancelRecording() },
      { icon: 'i-mic', title: mode === 'memo' ? '받아쓰기 정지' : '받아쓰기 시작', sub: 'fn을 꾹 눌러도 됩니다', run: () => api.toggle('memo') },
      { icon: 'i-key', title: '계정·토큰 연결', run: () => openSettings('accounts') },
      { icon: 'i-shield', title: 'macOS 권한', run: () => openSettings('perms') },
      { icon: 'i-folder', title: '녹음 폴더 열기', run: () => api.openRecordings() },
    ].filter((item): item is Exclude<typeof item, false> => Boolean(item));
    const match = (s: string) => s.toLowerCase().includes(q);
    if (!q) {
      groups.push(['이동', nav], ['동작', actions]);
      const recent = meetings().filter((m) => m.minutes?.status === 'done').slice(0, 3);
      if (recent.length) groups.push(['최근 회의', recent.map(meetingResult)]);
      return groups;
    }
    const meet = meetings().filter((m) => match(`${m.minutes?.title ?? ''} ${m.summary ?? ''}`)).slice(0, 6).map(meetingResult);
    const dict = dictations().filter((r) => match(r.transcript.text ?? r.transcript.raw)).slice(0, 6).map((r) => ({
      icon: 'i-copy', title: r.transcript.text ?? r.transcript.raw, sub: `${dayLabel(r.startedAt)} ${TIME.format(new Date(r.startedAt))}${r.app ? ` · ${r.app}` : ''} · 눌러서 복사`,
      run: async () => {
        await api.copy(r.transcript.text ?? r.transcript.raw);
        toast('복사했습니다');
      },
    }));
    const n = [...nav, ...actions].filter((i) => match(i.title));
    if (n.length) groups.push(['이동 · 동작', n]);
    if (meet.length) groups.push(['회의', meet]);
    if (dict.length) groups.push(['받아쓰기', dict]);
    return groups;
  }

  function meetingResult(m: MeetingItem): PaletteItem {
    return { icon: 'i-people', title: m.minutes?.title ?? `${dayLabel(m.startedAt)} 회의`, sub: m.summary ?? statusText(m.minutes), meta: clock(m.durationSec), run: () => (location.hash = `#meeting/${encodeURIComponent(m.id)}`) };
  }

  function renderPalette() {
    const q = input.value.trim().toLowerCase();
    const groups = paletteResults(q);
    paletteItems = groups.flatMap((g) => g[1]);
    paletteSel = Math.min(paletteSel, Math.max(0, paletteItems.length - 1));
    view = { q, groups, selected: paletteSel, instance: ++instance };
    commit(() => source.changed());
  }

  function markPalette() {
    list.querySelectorAll<HTMLElement>('.pitem').forEach((el, i) => {
      el.setAttribute('aria-selected', String(i === paletteSel));
      if (i === paletteSel) el.scrollIntoView({ block: 'nearest' });
    });
  }

  function select(i: number) {
    paletteSel = i;
    markPalette();
  }

  function runPalette(i: number) {
    const item = paletteItems[i];
    dialog.close();
    item?.run();
  }

  function openPalette() {
    if (dialog.open) return dialog.close();
    if (settings.open) settings.close();
    input.value = '';
    paletteSel = 0;
    renderPalette();
    dialog.showModal();
    input.focus();
  }

  input.oninput = () => {
    paletteSel = 0;
    renderPalette();
  };
  input.onkeydown = (e) => {
    if (e.isComposing) return;
    if (e.key === 'ArrowDown') paletteSel = Math.min(paletteItems.length - 1, paletteSel + 1);
    else if (e.key === 'ArrowUp') paletteSel = Math.max(0, paletteSel - 1);
    else if (e.key === 'Enter') return runPalette(paletteSel);
    else return;
    e.preventDefault();
    markPalette();
  };
  dialog.addEventListener('click', (e) => e.target === dialog && dialog.close());
  document.getElementById('openPalette')!.onclick = openPalette;

  return { open: openPalette };
}
