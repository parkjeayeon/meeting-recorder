// 설정 › 폰 녹음 칸: 받을 폴더(고르기·열기·선택 해제), 폴더 지켜보기, 회의록을 폴더에도 저장 (결정 84).
// 값은 설정 저장(settingsStore.save)으로만 — 폴더를 실제로 지켜보는 일은 아직 없다. 녹음 폴더와 겹치는지는 본체(inbox:chooseDir)가 본다.
// 폴더가 없으면 두 스위치를 잠그고, 지켜보기가 꺼져 있으면 회의록 저장을 잠근다. 폴더를 해제하면 두 스위치도 끈다.
import type { Settings } from '../../../entities/settings/index.ts';
import { tilde, type SettingsCtx } from './state.ts';

export interface PhoneRole {
  readonly applySaved: (s: Settings) => void;
  readonly wire: () => void;
}

export const OVERLAP_TEXT = '녹음 폴더와 겹치는 폴더는 고를 수 없습니다.';

export function createPhone(ctx: SettingsCtx): PhoneRole {
  const { api, settingsStore, toast } = ctx;
  const byId = <E extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as E;
  const showError = (text: string | null) => {
    byId('inboxDirError').textContent = text ?? '';
    byId('inboxDirError').hidden = !text;
  };

  return {
    applySaved: (s) => {
      const dir: string | null = s.inboxDir || null;
      const watching = Boolean(dir && s.inboxEnabled);
      byId('inboxDirPath').textContent = dir ? tilde(dir) : '아직 고르지 않았습니다';
      byId('inboxDirPath').title = dir ?? '';
      byId('inboxOpen').hidden = !dir;
      byId('inboxClear').hidden = !dir;
      byId('inboxChoose').textContent = dir ? '변경…' : '폴더 고르기…';
      const enabled = byId<HTMLInputElement>('inboxEnabled');
      enabled.disabled = !dir;
      enabled.checked = watching;
      byId('inboxEnabledHint').textContent = dir ? '새 녹음이 들어오면 회의로 만들고 회의록까지 만듭니다.' : '먼저 받을 폴더를 고르세요.';
      const copy = byId<HTMLInputElement>('inboxCopyMinutes');
      copy.disabled = !watching;
      copy.checked = Boolean(dir && s.inboxCopyMinutes);
    },
    wire: () => {
      byId('inboxChoose').onclick = async () => {
        showError(null);
        try {
          const r = await api.chooseInbox();
          if (!r) return;
          if (!r.ok) return showError(OVERLAP_TEXT);
          await settingsStore.save({ inboxDir: r.dir });
        } catch (err) {
          toast('받을 폴더를 바꾸지 못했습니다', (err as Error).message, { bad: true });
        }
      };
      byId('inboxOpen').onclick = () => api.openInbox();
      byId('inboxClear').onclick = () => {
        showError(null);
        return settingsStore.save({ inboxDir: null, inboxEnabled: false, inboxCopyMinutes: false });
      };
      byId<HTMLInputElement>('inboxEnabled').onchange = (e) => settingsStore.save({ inboxEnabled: (e.target as HTMLInputElement).checked });
      byId<HTMLInputElement>('inboxCopyMinutes').onchange = (e) => settingsStore.save({ inboxCopyMinutes: (e.target as HTMLInputElement).checked });
    },
  };
}
