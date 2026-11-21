// 플랫폼 층의 포트: 운영체제에 묶인 일을 "무엇을 해 달라"로만 적는다 (결정 78).
// 구현은 darwin/(지금 macOS 코드를 옮긴 것)과 unsupported.mts(다른 OS — 지금 코드가 그 OS에서 보이던 대답)뿐이다.
// 여기 있는 것은 Electron을 가져오지 않는다. Electron 객체가 필요한 일(창 옵션·독·마이크 권한)은 값만 돌려주고 부르는 쪽(main.js)이 Electron을 부른다.
import type { Network, SandboxOptions } from '../core/sandbox.mjs';

// ── 1. 프로세스: 앱이 남긴 고아 프로세스 찾기 ─────────────────────────────
export interface ProcessEntry {
  pid: number;
  command: string; // 명령줄 전체 (ps의 command 칸 그대로)
}
export interface Processes {
  // 부모가 사라져 init(pid 1)에 붙은 프로세스. 찾지 못하면(명령 실패) 빈 목록 — 예전 try/catch가 삼키던 것과 같다
  orphans(): ProcessEntry[];
  // 그 pid의 명령줄 (ps 출력 그대로, 끝 줄바꿈 포함). 없는 pid·실패면 null
  commandOf(pid: number): string | null;
}

// ── 2. 받아쓰기 키 듣기 ────────────────────────────────────────────────
export interface KeyListenerHandle {
  kill(): unknown;
}
export interface KeyListenerEvents {
  line(line: string): void; // 도우미가 낸 한 줄 (앞뒤 공백을 뺀 것): ready / down / up / chord / error:permission
  exit(code: number | null): void; // 도우미가 끝남. macOS 도우미는 권한이 없으면 끝 코드 2
}
export interface KeyListener {
  readonly keyName: string; // 받아쓰기 키의 표시 이름 ('fn'). 아직 화면 글에는 쓰지 않는다
  // 도우미 실행 파일 bin을 띄우고 표준 출력을 줄마다 넘긴다. 실행 파일이 있는지는 부르는 쪽이 먼저 본다
  start(bin: string, on: KeyListenerEvents): KeyListenerHandle;
  // 받아쓰기 키가 다른 OS 기능과 겹치면 안내 문장, 아니면(또는 알 수 없으면) null
  usageWarning(): string | null;
}

// ── 3. 붙여넣기 키 보내기 ──────────────────────────────────────────────
// elevated: Windows에서 앞 창이 관리자 권한으로 돌아 붙일 수 없을 때를 위한 자리. macOS에서는 돌려주지 않는다
export type PasteResult = 'pasted' | 'no-permission' | 'failed' | 'elevated';
export interface Paster {
  // 클립보드에 넣어 둔 글을 앞 창에 붙이는 키를 보낸다 (클립보드 보관·되돌리기는 부르는 쪽 일)
  sendPaste(helperBin: string): Promise<PasteResult>;
}

// ── 4. 권한 ───────────────────────────────────────────────────────────
export type PermissionKind = 'microphone' | 'inputMonitoring' | 'systemAudio' | 'accessibility';
export interface Permissions {
  readonly kinds: readonly PermissionKind[]; // 이 OS에서 사용자가 허용해야 하는 권한
  // 권한 도우미 실행: 표준 출력(앞뒤 공백 뺀 것), 실패·시간 초과면 null
  runHelper(helperBin: string, args: string[]): Promise<string | null>;
  // 그 권한을 켜는 시스템 설정 창 주소. 이 OS에서 열 곳이 없으면 null
  privacyPaneUrl(kind: unknown): string | null;
  keyboardSettingsUrl(): string | null;
}

// ── 5. 소리 변환 ──────────────────────────────────────────────────────
// [실행 파일, 인자] — 실행(샌드박스·시간 제한·오류 문장)은 부르는 쪽이 지금처럼 한다
export type Command = [string, string[]];
export type ConvertTo =
  | { format: 'wav'; rate: number; channels: 1 } // 16비트 정수 PCM WAV
  | { format: 'm4a'; codec: 'aac'; bitrate: number };
export interface AudioTools {
  convert(src: string, dst: string, to: ConvertTo): Command;
  info(file: string): Command; // 길이·표본율을 사람이 읽는 글로 내는 명령 (macOS afinfo의 출력 형식을 부르는 쪽이 읽는다)
}

// ── 6. 정해진 자리 (엔진·도구 실행 파일) ───────────────────────────────
export type CliId = 'claude-code' | 'codex';
export interface Paths {
  readonly whisperServer: readonly string[]; // whisper-server를 찾는 자리 (환경 변수 WHISPER_SERVER는 부르는 쪽이 앞에 붙인다)
  readonly brew: readonly string[]; // 엔진 설치에 쓰는 Homebrew
  cli(id: CliId): string[]; // Claude Code·Codex 명령줄 도구를 찾는 자리
  // uv 내려받기 주소와 압축 안 폴더 이름. arch: aarch64 | x86_64. 이 OS용이 없으면 던진다
  uvArchive(arch: string): { url: string; dir: string };
}

// ── 7. 시스템 소리 녹음 방식 ───────────────────────────────────────────
export type SystemAudioCapability = 'process_tap' | 'screen_capture_kit' | 'wasapi_loopback' | 'unsupported';

// ── 8. 샌드박스 (src/core/sandbox.mts를 그대로) ─────────────────────────
export interface Sandbox {
  wrap(cmd: string, args: string[], opts: SandboxOptions): [string, string[]];
  profile(opts: SandboxOptions): string;
  cacheEnv(dir: string): Record<string, string>;
}
export type { Network, SandboxOptions };

// ── 9. 본체가 Electron으로 하는 잡다한 일 중 OS에 따라 하느냐 마느냐 ─────
export interface Shell {
  readonly selftestSound: Command | null; // 셀프테스트가 시스템 소리 트랙 확인용으로 트는 효과음
  readonly hideAppBeforeRepaste: boolean; // 다시 붙여넣기 전에 app.hide() — 직전에 쓰던 앱이 앞으로 온다
  readonly overlayWindow: { type?: 'panel' }; // 떠 있는 막대 BrowserWindow 옵션에 더할 것
  readonly devDockIcon: boolean; // 개발 모드에서 app.dock.setIcon
  readonly askMicAtLaunch: boolean; // 시작할 때 systemPreferences.askForMediaAccess('microphone')
  readonly micAccessFromSystem: boolean; // app:info의 micAccess를 systemPreferences에서 읽는다 (아니면 'granted')
}

export interface Platform {
  readonly os: NodeJS.Platform;
  readonly processes: Processes;
  readonly keyListener: KeyListener;
  readonly paster: Paster;
  readonly permissions: Permissions;
  readonly audio: AudioTools;
  readonly paths: Paths;
  systemAudio(): SystemAudioCapability;
  readonly sandbox: Sandbox;
  readonly shell: Shell;
}
