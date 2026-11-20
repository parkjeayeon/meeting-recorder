// 설정 › 다듬기 칸: 다듬기 켜기, 쓸 계정(라디오), 로그인된 Claude Code·Codex의 남은 사용량 막대.
// 사용량 값·읽는 중·사용량 영역은 이 칸만 갖는다. 계정 목록이 바뀌면 영역을 모두 내리고 새 자리에 다시 그린다.
import type { Settings } from '../../../entities/settings/index.ts';
import { dayLabel, fmt, TIME } from '../../../shared/lib/index.ts';
import { settingsRegionRenderer, SettingsProviders, SettingsUsage } from './regions.tsx';
import type { SettingsCtx } from './state.ts';
import type { ProviderInfo, UsageResult, UsageWindow } from './types.ts';
import type { ActionView, UsageView } from './view.ts';

export interface CleanupRole {
  readonly applySaved: (s: Settings) => void;
  readonly wire: () => void;
  /** 계정 목록이 바뀌었다 (설정 store의 'providers') — 라디오와 사용량을 다시 그린다 */
  readonly providersChanged: () => void;
  readonly loadUsage: (force?: boolean) => Promise<void>;
}

export function createCleanup(ctx: SettingsCtx): CleanupRole {
  const { api, settingsStore } = ctx;
  const providersRegion = settingsRegionRenderer(document.getElementById('providers')!, SettingsProviders);
  const usageRegions = new Map<HTMLElement, ReturnType<typeof settingsRegionRenderer<UsageView>>>();

  // ── 사용 한도: 로그인된 Claude Code·Codex가 얼마나 남았는지 (설정 › 다듬기를 열 때, 5분 안이면 저장해 둔 값) ──
  const USAGE_IDS = ['claude-code', 'codex'];
  let usageNow: Record<string, UsageResult> | null = null; // 마지막으로 받은 값
  let usageBusy = false;
  async function loadUsage(force = false) {
    if (usageBusy) return;
    usageBusy = true;
    drawUsage();
    try {
      usageNow = await api.usage({ force });
    } catch (err) {
      usageNow = Object.fromEntries(USAGE_IDS.map((id) => [id, { ok: false, error: (err as Error).message }]));
    }
    usageBusy = false;
    drawUsage();
  }

  const USAGE_NAME = { session: '현재 세션', week: '이번 주', limit: '한도에 걸림 (5분 뒤 다시 확인)' };
  function resetLabel(w: UsageWindow) {
    if (!w.resetsAt) return w.resetsText ? `${w.resetsText} 초기화` : '';
    const d = new Date(w.resetsAt);
    const time = TIME.format(d);
    const today = new Date();
    const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86400e3);
    return `${days === 0 ? '오늘' : days === 1 ? '내일' : dayLabel(d.toISOString())} ${time} 초기화`;
  }

  function drawUsage() {
    for (const el of document.querySelectorAll<HTMLElement>('[data-usage]')) {
      const u = usageNow?.[el.dataset.usage!];
      let region = usageRegions.get(el);
      if (!region) {
        region = settingsRegionRenderer(el, SettingsUsage);
        usageRegions.set(el, region);
      }
      const again: ActionView = { className: 'link', disabled: usageBusy, click: () => loadUsage(true), label: usageBusy ? '확인 중…' : '새로 고침' };
      if (!u) {
        region.render({ rows: [], footClass: 'usage-foot', footText: usageBusy ? '남은 사용량 확인 중…' : '남은 사용량', again: usageBusy ? null : again });
        continue;
      }
      if (!u.ok) {
        region.render({ rows: [], footClass: 'usage-foot bad', footText: `남은 사용량을 읽지 못했습니다 · ${u.error}`, again });
        continue;
      }
      const ago = Math.max(0, Math.round((Date.now() - new Date(u.fetchedAt).getTime()) / 60000));
      region.render({
        rows: u.windows.map((w) => ({
          left: Math.max(0, Math.round(100 - w.usedPercent)),
          name: w.kind === 'model-week' ? `이번 주 · ${w.model}` : USAGE_NAME[w.kind],
          reset: resetLabel(w),
        })),
        footClass: 'usage-foot',
        footText: [ago ? `${ago}분 전 확인` : '방금 확인', u.credits && `크레딧 ${Number.isFinite(Number(u.credits)) ? fmt.format(Math.floor(Number(u.credits))) : u.credits}`, u.via === 'llm' && '출력 형식이 바뀌어 LLM으로 읽음'].filter(Boolean).join(' · '),
        again,
      });
    }
  }

  return {
    applySaved: (s) => {
      (document.getElementById('dictCleanup')! as HTMLInputElement).checked = s.cleanup;
    },
    wire: () => {
      (document.getElementById('dictCleanup')! as HTMLInputElement).onchange = (e) => settingsStore.save({ cleanup: (e.target as HTMLInputElement).checked });
    },
    providersChanged: () => {
      const providers = settingsStore.getSnapshot().providers;
      for (const region of usageRegions.values()) region.unmount();
      usageRegions.clear();
      const rows: [string, string, string | ProviderInfo][] = [
        ['auto', '자동', '로그인된 계정 중 가장 빠른 것'],
        ['claude-code', 'Claude Code', providers['claude-code']],
        ['codex', 'Codex', providers.codex],
        ['api', 'Anthropic API 키', providers.api],
      ];
      providersRegion.render(rows.map(([id, name, info]) => {
        const usable = typeof info === 'string' || info.loggedIn;
        const who = typeof info === 'string' ? info : !info.installed ? '설치 안 됨' : info.loggedIn ? info.account ?? (id === 'api' ? '키 저장됨' : '로그인됨') : id === 'api' ? '키 없음 · 계정·토큰에서 입력' : '로그인 필요';
        return {
          id, name, who, usable, checked: settingsStore.getSnapshot().saved.provider === id,
          change: () => settingsStore.save({ provider: id }),
          usage: USAGE_IDS.includes(id) && Boolean((info as ProviderInfo).loggedIn),
        };
      }));
      drawUsage();
    },
    loadUsage,
  };
}
