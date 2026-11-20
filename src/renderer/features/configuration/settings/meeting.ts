// 설정 › 회의 칸: 회의 녹취 언어·회의록 자동·화자 구분(줄·왼쪽 아래 표시·토큰 알림)·화상 회의 소리.
// 화상 회의 소리를 바꾸면 권한 칸을 다시 그린다 (시스템 오디오 권한이 필요한지가 바뀐다).
import type { Settings } from '../../../entities/settings/index.ts';
import type { PermissionsRole } from './permissions.ts';
import { setEngine, type SettingsCtx } from './state.ts';

export interface MeetingRole {
  readonly applySaved: (s: Settings) => void;
  readonly wire: () => void;
}

export function createMeeting(ctx: SettingsCtx, permissions: Pick<PermissionsRole, 'render'>): MeetingRole {
  const { settingsStore, issues, openSettings } = ctx;
  const renderPerms = () => permissions.render();
  return {
    applySaved: (s) => {
      (document.getElementById('minutesAuto')! as HTMLInputElement).checked = s.minutes;
      (document.getElementById('diarizeOn')! as HTMLInputElement).checked = s.diarize;
      const dl = document.getElementById('diarizeLine')!;
      if (!s.diarizeReady) {
        dl.textContent = '화자 구분 엔진(pyannote)이 설치되어 있지 않습니다. 설정 › 엔진에서 설치하세요.';
        dl.className = 'bad';
      } else if (!s.hasHfToken) {
        dl.textContent = 'Hugging Face 토큰이 필요합니다. 계정·토큰에서 넣어 주세요.';
        dl.className = 'bad';
      } else {
        dl.textContent = '누가 말했는지 구분합니다 (pyannote community-1, 이 Mac 안에서 처리).';
        dl.className = '';
      }
      const dState: [string, string] = !s.diarize ? ['', '꺼짐'] : !s.diarizeReady ? ['bad', '설치 필요'] : s.hasHfToken ? ['ok', '준비됨'] : ['bad', '토큰 필요'];
      setEngine('engDiarize', ...dState);
      issues.set('hf', s.diarize && s.diarizeReady && !s.hasHfToken ? {
        title: '화자 구분에 Hugging Face 토큰이 필요합니다', detail: '토큰을 넣기 전까지 회의 스크립트에 화자가 표시되지 않습니다.',
        action: '토큰 넣기', onAction: () => openSettings('accounts'), sec: 'accounts',
      } : null);
      (document.getElementById('meetingSystem')! as HTMLInputElement).checked = s.meetingSystemAudio;
      (document.getElementById('meetLanguage')! as HTMLSelectElement).value = s.meetingLanguage ?? s.language;
    },
    wire: () => {
      (document.getElementById('meetLanguage')! as HTMLSelectElement).onchange = (e) => settingsStore.save({ meetingLanguage: (e.target as HTMLSelectElement).value });
      (document.getElementById('minutesAuto')! as HTMLInputElement).onchange = (e) => settingsStore.save({ minutes: (e.target as HTMLInputElement).checked });
      (document.getElementById('diarizeOn')! as HTMLInputElement).onchange = (e) => settingsStore.save({ diarize: (e.target as HTMLInputElement).checked });
      (document.getElementById('meetingSystem')! as HTMLInputElement).onchange = async (e) => {
        await settingsStore.save({ meetingSystemAudio: (e.target as HTMLInputElement).checked });
        renderPerms();
      };
    },
  };
}
