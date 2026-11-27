// 설정 › 받아쓰기 칸: fn으로 받아쓰기·언어(왼쪽 아래 언어와 같은 값)·마이크 장치·녹음 폴더.
// 음성 인식 엔진 줄은 status.ts, '처음 설정 다시 보기'는 dialog.ts.
import type { Settings } from '../../../entities/settings/index.ts';
import { remember, store } from '../../../shared/lib/index.ts';
import { tilde, type SettingsCtx, type SettingsDeps } from './state.ts';

export interface DictationRole {
  /** 저장된 설정을 칸에 옮긴다 (설정 store의 'settings'에서) */
  readonly applySaved: (s: Settings) => void;
  readonly wire: () => void;
  /** 장치가 바뀌면 마이크 목록을 다시 읽는다 */
  readonly listen: () => void;
  readonly showRecordingsDir: (dir: string, def: string) => void;
  readonly loadDevices: () => Promise<void>;
  readonly updateMicHint: () => void;
}

export function createDictation(ctx: SettingsCtx, { recordingsChanged }: Pick<SettingsDeps, 'recordingsChanged'>): DictationRole {
  const { api, settingsStore, toast } = ctx;

  // 녹음 폴더: 기본은 ~/Documents/MeetingRecorder, 사용자가 고르면 바꾼다
  function showRecordingsDir(dir: string, def: string) {
    document.getElementById('recDirPath')!.textContent = tilde(dir);
    document.getElementById('recDirPath')!.title = dir;
    document.getElementById('resetDir')!.hidden = dir === def;
  }

  // ── 마이크 장치 ─────────────────────────────────────────────────────────
  const BLUETOOTH_HINT = /airpods|bluetooth|buds|headset|hands-?free|beats|jabra|bose|wh-1000|wf-1000/i;

  async function loadDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const select = (document.getElementById('micSelect')! as HTMLSelectElement);
    const cur = select.value;
    select.replaceChildren(new Option('시스템 기본값', ''));
    for (const d of devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default')) select.append(new Option(d.label || '알 수 없는 마이크', d.deviceId));
    select.value = cur || store('micId', ''); // 없는 장치면 브라우저가 알아서 '시스템 기본값'으로 돌린다
    updateMicHint();
  }

  function updateMicHint() {
    const select = (document.getElementById('micSelect')! as HTMLSelectElement);
    const label = select.value ? select.selectedOptions[0]?.textContent : '';
    const bt = BLUETOOTH_HINT.test(label ?? '');
    document.getElementById('micHint')!.textContent = bt ? '블루투스 마이크는 16kHz 이하로 녹음되고 스피커 음질도 떨어집니다. 내장·유선 마이크를 권장합니다.' : '받아쓰기와 회의 녹음에 쓰는 장치';
    document.getElementById('micHint')!.classList.toggle('bad', bt);
  }

  return {
    applySaved: (s) => {
      (document.getElementById('dictEnabled')! as HTMLInputElement).checked = s.enabled;
      (document.getElementById('dictLanguage')! as HTMLSelectElement).value = s.language;
      (document.getElementById('sideLanguage')! as HTMLSelectElement).value = s.language;
    },
    wire: () => {
      (document.getElementById('dictEnabled')! as HTMLInputElement).onchange = (e) => settingsStore.save({ enabled: (e.target as HTMLInputElement).checked });
      (document.getElementById('dictLanguage')! as HTMLSelectElement).onchange = (e) => settingsStore.save({ language: (e.target as HTMLSelectElement).value });
      // 왼쪽 아래 받아쓰기 언어 (설정 › 받아쓰기의 언어와 같은 값)
      (document.getElementById('sideLanguage')! as HTMLSelectElement).onchange = async (e) => {
        await settingsStore.save({ language: (e.target as HTMLSelectElement).value });
        toast('받아쓰기 언어를 바꿨습니다', `${(e.target as HTMLSelectElement).selectedOptions[0]!.textContent} · 다음 fn 받아쓰기부터`);
      };
      document.getElementById('openDir')!.onclick = () => api.openRecordings();
      document.getElementById('chooseDir')!.onclick = async () => {
        try {
          const r = await api.chooseRecordings();
          if (!r) return;
          showRecordingsDir(r.dir, (await api.info()).defaultRecordingsDir);
          await settingsStore.refresh(); // 새 폴더에 있던 사전이 합쳐졌을 수 있다
          toast('녹음 폴더를 바꿨습니다', r.total ? (r.moved ? `기존 녹음 ${r.moved}개를 옮겼습니다${r.skipped ? ` · ${r.skipped}개는 같은 이름이 있거나 옮기지 못해 남겨 두었습니다` : ''}` : '기존 녹음은 원래 폴더에 남겨 두었습니다') : tilde(r.dir));
          recordingsChanged();
        } catch (err) {
          toast('녹음 폴더를 바꾸지 못했습니다', (err as Error).message, { bad: true });
        }
      };
      document.getElementById('resetDir')!.onclick = async () => {
        try {
          const r = await api.resetRecordings();
          showRecordingsDir(r.dir, r.dir);
          toast('기본 녹음 폴더로 돌렸습니다', '바꾼 폴더의 녹음은 그 자리에 남아 있습니다');
          recordingsChanged();
        } catch (err) {
          toast('바꾸지 못했습니다', (err as Error).message, { bad: true });
        }
      };
      (document.getElementById('micSelect')! as HTMLSelectElement).onchange = () => {
        remember('micId', (document.getElementById('micSelect')! as HTMLSelectElement).value);
        updateMicHint();
      };
    },
    listen: () => navigator.mediaDevices.addEventListener('devicechange', loadDevices),
    showRecordingsDir,
    loadDevices,
    updateMicHint,
  };
}
