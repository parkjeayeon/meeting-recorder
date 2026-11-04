#!/bin/sh
# 빌드한 .app에 서명한다. 키체인에 자체 서명 인증서(scripts/dev/make-signing-cert.sh)가 있으면 그걸로,
# 없으면 ad-hoc으로. 인증서로 서명하면 다시 빌드해도 macOS 권한이 유지된다.
set -e
APP="$1"
NAME="Meeting Recorder Local"
if security find-certificate -c "$NAME" >/dev/null 2>&1; then
  codesign --force --deep --sign "$NAME" "$APP"
  echo "서명: $NAME"
else
  codesign --force --deep --sign - "$APP"
  echo "서명: ad-hoc (인증서가 없음 · 다시 빌드하면 권한을 다시 허용해야 할 수 있음)"
fi
