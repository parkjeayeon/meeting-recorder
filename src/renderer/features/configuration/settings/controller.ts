// 설정 창의 주인: 맥락(SettingsCtx) 하나를 만들고 칸(역할) 모듈을 엮어 설정 store 구독·처리기·본체 알림을 잇는다.
// 칸마다 한 파일 — dialog(창 틀·탭·열 때 새로 읽기), status(엔진 줄·왼쪽 아래 표시), dictation(받아쓰기·마이크·녹음 폴더),
// cleanup(다듬기·계정 고르기·사용량), meeting(회의·화자 구분), phone(폰 녹음 받을 폴더), setup(엔진 설치), accounts(계정·토큰), permissions(권한).
// 여러 칸이 같이 쓰는 것은 state.ts의 SettingsCtx로만 (docs/renderer-architecture.md)
// 칸 팩토리는 그릴 영역(React 뿌리)만 만들고 아무것도 붙이지 않는다 — 붙이는 것은 아래에서 옛 차례 그대로 한다.
import { mountReact } from '../../../shared/page-host/index.tsx';
import { createAccounts } from './accounts.ts';
import { createCleanup } from './cleanup.ts';
import { createDialog } from './dialog.ts';
import { createDictation } from './dictation.ts';
import { createMeeting } from './meeting.ts';
import { createPermissions } from './permissions.ts';
import { createPhone } from './phone.ts';
import { createSetup } from './setup.ts';
import type { SettingsCtx, SettingsDeps, SettingsHandle } from './state.ts';
import { createStatus } from './status.ts';
import { SettingsDialogBody } from './ui.tsx';

export type { SettingsDeps, SettingsHandle } from './state.ts';

export function mountSettings({ api, settings: settingsStore, issues, toast, confirm, closePalette, recordingsChanged, rerunOnboarding }: SettingsDeps): SettingsHandle {
  const dialog = document.getElementById('settings') as HTMLDialogElement;
  mountReact(dialog, SettingsDialogBody, {});
  const ctx: SettingsCtx = { api, settingsStore, issues, toast, dialog, openSettings: (sec) => shell.open(sec) };

  // 칸들 — 만들 때는 그릴 영역만 만든다. 서로 부르는 것은 고른 명령만 넘긴다
  const status = createStatus(ctx);
  const cleanup = createCleanup(ctx);
  const permissions = createPermissions(ctx);
  const setup = createSetup(ctx, { confirm });
  const accounts = createAccounts(ctx);
  const dictation = createDictation(ctx, { recordingsChanged });
  const meeting = createMeeting(ctx, permissions);
  const phone = createPhone(ctx);
  const shell = createDialog(ctx, { closePalette, rerunOnboarding }, { permissions, setup, cleanup, accounts });

  shell.wire();

  // 옛 그리기가 돌던 자리에서 동기로 그린다. 구독은 하나 — 한 종류 안에서 칸을 부르는 차례가 문제 알림(issues.set)이 나는 차례다
  // (settings: 화자 구분 hf → 엔진 engine → 다듬기 cleanup). 앱이 사는 동안 그대로라 끊지 않는다
  settingsStore.subscribe((change) => {
    if (change === 'settings') {
      const s = settingsStore.getSnapshot().saved;
      meeting.applySaved(s);
      dictation.applySaved(s);
      phone.applySaved(s);
      cleanup.applySaved(s);
      status.renderEngine(s.engine);
      status.renderSideCleanup();
    } else if (change === 'engine') {
      status.renderEngine(settingsStore.getSnapshot().engine);
    } else if (change === 'providers') {
      cleanup.providersChanged();
      status.renderSideCleanup();
    }
  });

  // 입력칸·버튼 처리기 (onchange·onclick을 바꿔 끼우기만 해 붙이는 차례는 상관없다)
  dictation.wire();
  meeting.wire();
  cleanup.wire();
  phone.wire();
  // 떠 있는 막대에서 받아쓰기 언어를 바꾸면 왼쪽 아래·설정 화면도 같이
  settingsStore.connect();
  // 본체·브라우저 알림은 이 차례로 붙인다: 설정·엔진(connect) → 장치 바뀜 → 권한 3초·권한 바뀜 → 설치
  dictation.listen();
  permissions.listen();
  setup.listen();
  accounts.wire();

  return {
    open: shell.open,
    refreshPermissions: permissions.render,
    showRecordingsDir: dictation.showRecordingsDir,
    loadDevices: dictation.loadDevices,
    updateMicHint: dictation.updateMicHint,
    setupListeners: setup.setupListeners,
  };
}
