#!/bin/sh
# Meeting Recorder 명령줄 도구. 앱에 들어 있는 Electron의 Node로 CLI를 돌린다 — 사용자 Mac에 Node가 없거나 버전이 달라도 된다.
# 앱 안(Contents/Resources/mr)에 있고, `mr install`이 이 파일을 ~/.local/bin/mr로 복사한다. 그래서 앱 위치를 매번 찾는다.
BIN="Contents/MacOS/Meeting Recorder"
here=$(cd "$(dirname "$0")/../.." 2>/dev/null && pwd)
app=""
for a in "$MR_APP" "$here" "/Applications/Meeting Recorder.app" "$HOME/Applications/Meeting Recorder.app"; do
  if [ -n "$a" ] && [ -x "$a/$BIN" ]; then app="$a"; break; fi
done
if [ -z "$app" ]; then
  app=$(mdfind "kMDItemCFBundleIdentifier == 'local.meetingrecorder'" 2>/dev/null | head -n 1)
fi
if [ -z "$app" ] || [ ! -x "$app/$BIN" ]; then
  echo '{"error":{"code":"NO_APP","message":"Meeting Recorder 앱을 찾지 못했습니다","hint":"앱을 응용 프로그램 폴더에 설치하거나 MR_APP에 앱 경로를 지정하세요"}}' >&2
  exit 1
fi
MR_WRAPPER="$0" ELECTRON_RUN_AS_NODE=1 exec "$app/$BIN" "$app/Contents/Resources/app.asar/lib/cli/bin.mjs" "$@"
