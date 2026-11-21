// 커서 위치에 붙여 넣기: 클립보드를 보관 → 글을 넣고 붙여넣기 키 → 붙였으면 잠시 뒤 되돌리기. src/dictation.js에서 옮김 (결정 70).
// Electron 45의 클립보드 API는 비동기 ClipboardItem 방식이다. 클립보드와 ClipboardItem은 부르는 쪽이 Electron 것을 넘긴다.
// 붙여넣기 키 보내기는 플랫폼 층 (결정 78).
import type { PasteResult, Platform } from '../platform/index.mjs';

const CLIPBOARD_RESTORE_MS = 600;

// Electron clipboard 중 여기서 쓰는 것
export interface ClipboardEntry {
  readonly types: readonly string[];
  getType(type: string): Promise<unknown>;
}
export interface ClipboardPort {
  read(): Promise<readonly ClipboardEntry[]>;
  write(items: unknown[]): Promise<void>;
  writeText(text: string): Promise<void>;
  clear(): void;
}
export type ClipboardItemCtor = new (data: Record<string, unknown>) => unknown;

export interface PasteDeps {
  clipboard: ClipboardPort;
  ClipboardItem: ClipboardItemCtor;
  platform: Pick<Platform, 'paster'>;
}

export type Paste = (text: string, helperBin: string) => Promise<PasteResult>;

export function createPaste(deps: PasteDeps): Paste {
  const { clipboard } = deps;

  async function snapshotClipboard(): Promise<Record<string, unknown>[]> {
    const items: Record<string, unknown>[] = [];
    for (const item of await clipboard.read()) {
      const data: Record<string, unknown> = {};
      for (const type of item.types) {
        try {
          data[type] = await item.getType(type);
        } catch {}
      }
      if (Object.keys(data).length) items.push(data);
    }
    return items;
  }

  async function restoreClipboard(items: Record<string, unknown>[]): Promise<void> {
    if (items.length) await clipboard.write(items.map((data) => new deps.ClipboardItem(data)));
    else clipboard.clear();
  }

  return async function paste(text, helperBin) {
    const snap = await snapshotClipboard().catch(() => null);
    await clipboard.writeText(text);
    const result = await deps.platform.paster.sendPaste(helperBin); // 'pasted' | 'no-permission' | 'failed'
    // 붙여 넣기에 실패하면 클립보드에 남겨 두어 사용자가 직접 ⌘V 할 수 있게 한다
    if (result === 'pasted' && snap) {
      setTimeout(() => restoreClipboard(snap).catch(() => {}), CLIPBOARD_RESTORE_MS);
    }
    return result;
  };
}
