// 설정 창이 받는 것과, 칸(역할) 모듈들이 같이 받는 맥락(SettingsCtx).
// 칸마다 자기 상태(사용량 값·읽는 중·사용량 영역, 설치가 돌던 중인지, 셋업 구독자)는 그 칸 안에 든다.
// 여러 칸이 같이 쓰는 것만 여기의 이름 붙은 함수로: 설정 창 열기(open — 주인은 dialog), 왼쪽 아래 엔진 표시 하나 바꾸기(setEngine).
import type { IssueStore } from '../../../entities/issue/index.ts';
import type { SettingsStore } from '../../../entities/settings/index.ts';
import type { RecorderApi } from '../../../shared/api/index.ts';
import type { confirmBox, createToaster } from '../../../shared/ui/index.tsx';
import type { SetupComponent } from './types.ts';

export interface SettingsDeps {
  readonly api: RecorderApi;
  readonly settings: SettingsStore;
  readonly issues: IssueStore;
  readonly toast: ReturnType<typeof createToaster>;
  readonly confirm: typeof confirmBox;
  readonly closePalette: () => void;
  readonly recordingsChanged: () => void;
  readonly rerunOnboarding: () => void;
}

export interface SettingsHandle {
  readonly open: (sec?: string) => void;
  readonly refreshPermissions: () => Promise<void>;
  readonly showRecordingsDir: (dir: string, def: string) => void;
  readonly loadDevices: () => Promise<void>;
  readonly updateMicHint: () => void;
  readonly setupListeners: Set<(list: SetupComponent[]) => void>;
}

/** 칸 모듈들이 같이 받는 것. 주인은 controller.ts(mountSettings) */
export interface SettingsCtx {
  readonly api: RecorderApi;
  readonly settingsStore: SettingsStore;
  readonly issues: IssueStore;
  readonly toast: ReturnType<typeof createToaster>;
  readonly dialog: HTMLDialogElement;
  /** 설정 창을 이 칸으로 연다 (열려 있으면 칸만 바꾼다). 주인은 dialog.ts */
  readonly openSettings: (sec?: string) => void;
}

/** 왼쪽 아래 엔진 표시 하나 (음성 인식·다듬기·화자 구분) */
export function setEngine(id: string, state: string, text: string) {
  const el = document.getElementById(id)!;
  el.className = `engine ${state}`;
  el.querySelector('em')!.textContent = text;
}

export const gb = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}GB` : `${Math.round(n / 1e6)}MB`);
