// 설정 › 권한 칸: 권한 줄마다 상태·허용 버튼과 문제 알림(perm:…).
// 그릴 때마다 영역을 새 세대로 만들고(rebuild) 줄을 하나씩 더해 그린다 — 줄을 더할 때마다 그 줄의 알림을 바로 낸다.
// 창이 보일 때만 3초마다, 그리고 본체가 권한이 바뀌었다고 알리면 다시 그린다 (멈추지 않는다 — 앱이 사는 동안).
import { settingsRegionRenderer, SettingsPermissions } from './regions.tsx';
import type { SettingsCtx } from './state.ts';
import type { PermissionView } from './view.ts';

export interface PermissionsRole {
  readonly render: (status?: Record<string, string>) => Promise<void>;
  /** 3초 확인과 본체 알림을 붙인다 */
  readonly listen: () => void;
}

export function createPermissions(ctx: SettingsCtx): PermissionsRole {
  const { api, settingsStore, issues } = ctx;
  const permissionsRegion = settingsRegionRenderer(document.getElementById('permList')!, SettingsPermissions);

  // ── 권한 ────────────────────────────────────────────────────────────────
  const PERMS = [
    { kind: 'microphone', name: '마이크', what: '내 목소리 녹음' },
    { kind: 'inputMonitoring', name: '입력 모니터링', what: 'fn 키 감지' },
    { kind: 'accessibility', name: '손쉬운 사용', what: '받아쓴 글을 커서 위치에 입력' },
    { kind: 'systemAudio', name: '시스템 오디오 녹음', what: '화상 회의 상대방 소리 녹음', optional: () => !settingsStore.getSnapshot().saved?.meetingSystemAudio },
  ];

  async function requestPerm(kind: string, btn?: HTMLButtonElement) {
    if (btn) {
      btn.classList.add('busy'); // 흐리게 하지 않고 진행 중 표시
      btn.textContent = '기다리는 중…';
    }
    renderPerms(await api.permRequest(kind));
  }

  async function renderPerms(status?: Record<string, string>) {
    status ??= await api.permStatus();
    const render = permissionsRegion.rebuild();
    const rows: PermissionView[] = [];
    render(rows);
    for (const p of PERMS) {
      const st = status![p.kind];
      const ok = st === 'granted' || st === 'unsupported';
      const optional = !ok && p.optional?.();
      const first = st === 'not-determined' || st === 'unknown';
      const row: PermissionView = {
        name: p.name,
        what: optional ? `${p.what} · 화상 회의 녹음을 켤 때만 필요` : p.what,
        status: ok ? st === 'granted' ? '허용됨' : '이 macOS에서는 지원 안 됨' : null,
        action: ok ? null : { className: 'btn small primary', label: first ? '허용하기' : '시스템 설정 열기', click: (btn) => requestPerm(p.kind, btn) },
      };
      rows.push(row);
      render([...rows]);
      issues.set(`perm:${p.kind}`, ok || optional ? null : {
        title: `${p.name} 권한이 필요합니다`, detail: `${p.what}에 씁니다.`, sec: 'perms',
        action: first ? '허용하기' : '시스템 설정 열기', onAction: () => requestPerm(p.kind),
      });
    }
  }

  return {
    render: renderPerms,
    listen: () => {
      setInterval(() => document.visibilityState === 'visible' && renderPerms(), 3000);
      api.onPermChanged(() => renderPerms());
    },
  };
}
