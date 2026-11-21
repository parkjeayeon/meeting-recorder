// 메뉴바 (tray.mts) — 녹음 상태마다 메뉴 모양, 제목, 누르면 하는 일 (가짜 Tray·Menu로)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Electron from 'electron';
import { createTray, trayMenu, trayTitle, type TrayActions, type TrayContext, type TrayRecording } from './tray.mjs';

const labels = (m: Electron.MenuItemConstructorOptions[]) => m.map((x) => (x.type === 'separator' ? '—' : x.label));
const noop: TrayActions = {
  togglePause: () => {}, stopMeeting: () => {}, confirmCancel: () => {}, stopDictation: () => {}, startDictation: () => {},
  pasteLast: () => {}, startMeeting: () => {}, showWindow: () => {}, openRecordings: () => {}, setOpenAtLogin: () => {}, quit: () => {},
};
const TAIL = ['—', '창 열기', '녹음 폴더 열기', '로그인 시 자동 실행', '—', '종료'];
const login = { isPackaged: false, openAtLogin: () => true };

describe('메뉴 모양', () => {
  it('녹음 없음 / 받아쓰기 중 / 회의 중 / 회의 일시정지', () => {
    expect(labels(trayMenu(null, login, noop))).toEqual(['받아쓰기 시작 (fn 꾹 누르기)', '마지막 받아쓰기 붙여넣기', '회의 녹음 시작', ...TAIL]);
    expect(labels(trayMenu({ mode: 'memo', pausedAt: null }, login, noop))).toEqual(['받아쓰기 정지', ...TAIL]);
    expect(labels(trayMenu({ mode: 'meeting', pausedAt: null }, login, noop))).toEqual(['일시정지', '종료하고 저장', '녹음 취소 (버리기)…', ...TAIL]);
    expect(labels(trayMenu({ mode: 'meeting', pausedAt: 5 }, login, noop))[0]).toBe('녹음 재개');
  });

  it('로그인 시 자동 실행: 설치본에서만 켜지고, 설치본이 아니면 설정을 읽지도 않는다', () => {
    const read = vi.fn(() => true);
    let item = trayMenu(null, { isPackaged: false, openAtLogin: read }, noop).find((x) => x.label === '로그인 시 자동 실행');
    expect(item).toMatchObject({ type: 'checkbox', enabled: false, checked: false });
    expect(read).not.toHaveBeenCalled();
    item = trayMenu(null, { isPackaged: true, openAtLogin: read }, noop).find((x) => x.label === '로그인 시 자동 실행');
    expect(item).toMatchObject({ enabled: true, checked: true });
    const quit = trayMenu(null, login, noop).at(-1);
    expect(quit).toMatchObject({ label: '종료', accelerator: 'Command+Q' });
  });

  it('제목: 녹음 없음 🎙, 녹음 중 ● 회의 MM:SS, 일시정지 ❚❚, 받아쓰기는 메모', () => {
    expect(trayTitle(null, 0)).toBe('🎙');
    expect(trayTitle({ mode: 'meeting', pausedAt: null }, 187_900)).toBe('● 회의 03:07');
    expect(trayTitle({ mode: 'meeting', pausedAt: 1 }, 59_000)).toBe('❚❚ 회의 00:59');
    expect(trayTitle({ mode: 'memo', pausedAt: null }, 61 * 60_000)).toBe('● 메모 61:00');
  });
});

describe('메뉴바', () => {
  let rec: TrayRecording | null;
  let calls: unknown[][];
  let templates: Electron.MenuItemConstructorOptions[][];
  let titles: string[];
  let ctx: TrayContext;

  beforeEach(() => {
    vi.useFakeTimers();
    rec = null;
    calls = [];
    templates = [];
    titles = [];
    class FakeTray {
      setContextMenu(menu: unknown) {
        calls.push(['setContextMenu', menu]);
      }
      setTitle(t: string) {
        titles.push(t);
      }
    }
    ctx = {
      Tray: FakeTray as unknown as typeof Electron.Tray,
      nativeImage: { createEmpty: () => ({}) as Electron.NativeImage },
      Menu: { buildFromTemplate: (t) => (templates.push(t as Electron.MenuItemConstructorOptions[]), 'menu' as unknown as Electron.Menu) }, // trayMenu는 늘 옵션 객체를 만든다
      shell: { openPath: (p) => calls.push(['openPath', p]) },
      app: {
        isPackaged: false,
        getLoginItemSettings: () => ({ openAtLogin: false }) as Electron.LoginItemSettings,
        setLoginItemSettings: (s) => void calls.push(['setLoginItemSettings', s]),
        quit: () => void calls.push(['quit']),
      },
      recording: () => rec,
      elapsedMs: () => 65_000,
      setPaused: (on) => void calls.push(['setPaused', on]),
      uiToggle: (mode) => void calls.push(['uiToggle', mode]),
      confirmCancel: () => calls.push(['confirmCancel']),
      pasteLast: () => void calls.push(['pasteLast']),
      showWindow: () => void calls.push(['showWindow']),
      recordingsDir: () => '/rec',
      sendOverlayState: () => void calls.push(['overlayState']),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const lastMenu = () => {
    const t = templates.at(-1);
    if (!t) throw new Error('만든 메뉴가 없음');
    return t;
  };
  const click = (t: Electron.MenuItemConstructorOptions[], label: string) =>
    (t.find((x) => x.label === label)?.click as (item: { checked: boolean }) => void)({ checked: true });

  it('만들기 전에 고치면 TypeError (예전 tray.setContextMenu와 같다), 독 상태는 그 전에 보낸다', () => {
    const t = createTray(ctx);
    expect(() => t.updateTray()).toThrow(TypeError);
    expect(calls).toEqual([['overlayState']]);
  });

  it('녹음 중이면 1초마다 제목을 고치고, 녹음이 끝나면 다음 updateTray까지 그대로', () => {
    const t = createTray(ctx);
    t.create();
    t.updateTray();
    expect(titles).toEqual(['🎙']);
    rec = { mode: 'meeting', pausedAt: null };
    t.updateTray();
    expect(titles.at(-1)).toBe('● 회의 01:05');
    rec.pausedAt = 1; // 일시정지는 다음 틱에 보인다 (이름은 updateTray 때의 것)
    vi.advanceTimersByTime(1000);
    expect(titles.at(-1)).toBe('❚❚ 회의 01:05');
    const n = titles.length;
    rec = null;
    vi.advanceTimersByTime(3000);
    expect(titles).toHaveLength(n);
    t.updateTray(); // 타이머를 멈추고 🎙
    rec = { mode: 'memo', pausedAt: null };
    vi.advanceTimersByTime(3000);
    expect(titles.at(-1)).toBe('🎙');
  });

  it('누르면: 누를 때의 녹음 상태로 일시정지·정지, 폴더 열기·자동 실행·종료', () => {
    const t = createTray(ctx);
    t.create();
    rec = { mode: 'meeting', pausedAt: null };
    t.updateTray();
    const menu = lastMenu();
    rec.pausedAt = 3;
    click(menu, '일시정지'); // 이름은 만들 때 것이지만 누를 때 일시정지 중이면 재개
    click(menu, '종료하고 저장');
    click(menu, '녹음 취소 (버리기)…');
    rec = { mode: 'memo', pausedAt: null };
    t.updateTray();
    click(lastMenu(), '받아쓰기 정지');
    rec = null;
    t.updateTray();
    const idle = lastMenu();
    click(idle, '받아쓰기 시작 (fn 꾹 누르기)');
    click(idle, '마지막 받아쓰기 붙여넣기');
    click(idle, '회의 녹음 시작');
    click(idle, '창 열기');
    click(idle, '녹음 폴더 열기');
    click(idle, '로그인 시 자동 실행');
    click(idle, '종료');
    expect(calls.filter((c) => !['overlayState', 'setContextMenu'].includes(c[0] as string))).toEqual([
      ['setPaused', false],
      ['uiToggle', 'meeting'],
      ['confirmCancel'],
      ['uiToggle', 'memo'],
      ['uiToggle', 'memo'],
      ['pasteLast'],
      ['uiToggle', 'meeting'],
      ['showWindow'],
      ['openPath', '/rec'],
      ['setLoginItemSettings', { openAtLogin: true }],
      ['quit'],
    ]);
  });
});
