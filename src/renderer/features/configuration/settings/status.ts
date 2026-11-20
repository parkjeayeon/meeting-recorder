// 엔진 상태: 설정 › 받아쓰기의 음성 인식 엔진 줄과 버튼, 왼쪽 아래 음성 인식·다듬기 표시, 그 둘의 문제 알림(engine·cleanup).
// 화자 구분 표시는 회의 칸(meeting.ts)이 설정 값과 함께 그린다.
import type { EngineStatus } from '../../../entities/settings/index.ts';
import { PROVIDER_NAME } from '../../../shared/lib/index.ts';
import { settingsRegionRenderer, SettingsAction } from './regions.tsx';
import { setEngine, type SettingsCtx } from './state.ts';

export interface StatusRole {
  readonly renderEngine: (engine: EngineStatus) => void;
  readonly renderSideCleanup: () => void;
}

export function createStatus(ctx: SettingsCtx): StatusRole {
  const { settingsStore, issues, openSettings } = ctx;
  const engineActions = settingsRegionRenderer(document.getElementById('engineActs')!, SettingsAction);

  function renderEngine(engine: EngineStatus) {
    const mb = (n: number) => `${Math.round(n / 1e6)}MB`;
    const text = ({
      ready: 'Whisper large-v3-turbo · 이 Mac 안에서 실행',
      loading: '모델을 메모리에 올리는 중…',
      stopped: '꺼져 있음',
      'no-engine': 'whisper.cpp가 설치되어 있지 않습니다. 터미널에서 brew install whisper-cpp',
      'no-model': '음성 인식 모델(약 0.9GB)을 받아야 합니다.',
      downloading: `모델 받는 중 ${mb(engine.received)}${engine.total ? ` / ${mb(engine.total)}` : ''}`,
      error: `오류: ${engine.error}`,
    } as Record<string, string>)[engine.state] ?? engine.state;
    const bad = ['no-engine', 'no-model', 'error'].includes(engine.state);
    document.getElementById('engineLine')!.textContent = text;
    document.getElementById('engineLine')!.classList.toggle('bad', bad);
    engineActions.render({ className: 'btn small', click: () => openSettings('engine'), label: bad ? '설치하기' : '엔진 관리' });
    const short = ({ ready: '준비됨', loading: '불러오는 중', downloading: '받는 중', stopped: '꺼짐' } as Record<string, string>)[engine.state] ?? '설정 필요';
    setEngine('engAsr', bad ? 'bad' : engine.state === 'ready' ? 'ok' : 'busy', short);
    issues.set('engine', bad ? {
      title: '받아쓰기를 쓸 수 없습니다', detail: text, sec: 'engine',
      action: '설치하기', onAction: () => openSettings('engine'),
    } : null);
  }

  function renderSideCleanup() {
    const { saved: settings, providers } = settingsStore.getSnapshot();
    if (!settings || !providers) return;
    let label;
    if (!settings.cleanup) label = '꺼짐';
    else if (settings.provider !== 'auto') label = PROVIDER_NAME[settings.provider]!;
    else label = ['claude-code', 'codex', 'api'].map((id) => providers[id]?.loggedIn && PROVIDER_NAME[id]!).find(Boolean) ?? '계정 없음';
    setEngine('engCleanup', label === '계정 없음' ? 'bad' : settings.cleanup ? 'ok' : '', label);
    issues.set('cleanup', label === '계정 없음' ? { title: '다듬기에 쓸 계정이 없습니다', detail: 'Claude Code·Codex에 로그인하거나 API 키를 넣으세요. 그 전까지는 들린 그대로 입력합니다.', action: '계정 연결', onAction: () => openSettings('accounts'), sec: 'accounts' } : null);
  }

  return { renderEngine, renderSideCleanup };
}
