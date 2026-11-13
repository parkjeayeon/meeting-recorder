import type { RecorderApi } from '../../shared/api/index.ts';
import { mountReact } from '../../shared/page-host/index.tsx';
import type { createToaster } from '../../shared/ui/index.tsx';
import { ImportMeetingDialogBody } from './ui.tsx';
import { importRegionRenderer, ImportFiles, ImportSpeakers, type ImportFile } from './regions.tsx';

export interface ImportMeetingDeps {
  readonly api: Pick<RecorderApi, 'pickAudio' | 'importMeeting'>;
  readonly toast: ReturnType<typeof createToaster>;
  readonly historyChanged: () => void;
}

export interface ImportMeetingHandle {
  readonly open: (paths?: readonly string[] | null) => Promise<void>;
}

export function mountImportMeeting({ api, toast, historyChanged }: ImportMeetingDeps): ImportMeetingHandle {
  const dialog = document.getElementById('importSheet') as HTMLDialogElement;
  mountReact(dialog, ImportMeetingDialogBody, {});
  const filesRegion = importRegionRenderer(document.getElementById('importFiles')!, ImportFiles);
  const box = document.getElementById('importSpeakers')!;
  const speakersRegion = importRegionRenderer(box, ImportSpeakers);
  const notes = document.getElementById('importNotes') as HTMLTextAreaElement;
  const date = document.getElementById('importDate') as HTMLInputElement;
  const time = document.getElementById('importTime') as HTMLInputElement;
  const whenSource = document.getElementById('importWhenSrc')!;
  const btn = document.getElementById('importYes') as HTMLButtonElement;

  function importSegPick(box: HTMLElement, attr: string, value: string) {
    for (const b of box.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset[attr] === value));
  }
  let importing = false;
  let importPaths: string[] = [];
  let importSpeakers = '';
  async function open(paths: readonly string[] | null = null) {
    if (importing) return;
    const picked = await api.pickAudio(paths);
    const files: readonly ImportFile[] | undefined = picked?.files;
    if (!files?.length) return;
    importPaths = files.map((f) => f.path);
    document.getElementById('importOrder')!.textContent = files.length > 1 ? `이름 순서대로 이어 붙여 회의 하나로 만듭니다` : '';
    filesRegion(files);
    speakersRegion((v) => { importSpeakers = v; importSegPick(box, 'n', v); });
    importSpeakers = '';
    importSegPick(box, 'n', '');
    notes.value = '';
    // 회의 날짜: 짐작한 시각을 채우고 어디서 짐작했는지 알린다 (고칠 수 있다)
    const at = new Date(picked.guess?.at ?? Date.now());
    const p2 = (n: number) => String(n).padStart(2, '0');
    date.value = `${at.getFullYear()}-${p2(at.getMonth() + 1)}-${p2(at.getDate())}`;
    time.value = `${p2(at.getHours())}:${p2(at.getMinutes())}`;
    const today = new Date();
    date.max = `${today.getFullYear()}-${p2(today.getMonth() + 1)}-${p2(today.getDate())}`;
    whenSource.textContent = ({ name: '파일 이름에서 읽었습니다', mtime: '파일 시각으로 짐작했습니다 · 다르면 고쳐 주세요', now: '녹음 시각을 알 수 없어 지금으로 넣었습니다 · 고쳐 주세요' } as Record<string, string>)[picked.guess?.source] ?? '';
    whenSource.classList.toggle('warn', picked.guess?.source !== 'name');
    dialog.showModal();
    btn.focus();
  }
  document.getElementById('importNo')!.onclick = () => dialog.close();
  document.getElementById('importClose')!.onclick = () => dialog.close();
  dialog.addEventListener('click', (e) => e.target === dialog && dialog.close());
  btn.onclick = async () => {
    if (importing) return;
    const startedAt = new Date(`${date.value}T${time.value || '00:00'}`);
    if (!date.value || Number.isNaN(startedAt.getTime())) return toast('회의 날짜를 넣어 주세요', '', { bad: true });
    if (startedAt.getTime() > Date.now() + 60e3) return toast('아직 오지 않은 시각입니다', '회의를 시작한 날짜와 시각을 넣어 주세요', { bad: true });
    if (startedAt.getFullYear() < 2000) return toast('날짜를 확인해 주세요', '2000년 이후 날짜만 넣을 수 있습니다', { bad: true });
    importing = true;
    btn.classList.add('busy');
    btn.lastChild!.textContent = '가져오는 중…';
    try {
      const r = await api.importMeeting(importPaths, { notes: notes.value.trim(), speakers: importSpeakers || null, startedAt: startedAt.toISOString() });
      dialog.close();
      toast(r.count > 1 ? `녹음 파일 ${r.count}개를 이어 붙여 가져왔습니다` : '녹음 파일을 가져왔습니다', '받아쓰기와 회의록을 만들기 시작합니다', {
        action: '보기', onAction: () => (location.hash = `#meeting/${encodeURIComponent(r.id)}`),
      });
      historyChanged();
    } catch (err) {
      toast('가져오지 못했습니다', (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { bad: true, ms: 8000 });
    } finally {
      importing = false;
      btn.classList.remove('busy');
      btn.lastChild!.textContent = '가져오기';
    }
  };
  return { open };
}
