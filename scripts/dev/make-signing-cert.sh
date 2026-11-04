#!/bin/sh
# 이 Mac 로그인 키체인에 코드 서명용 자체 서명 인증서를 만든다 (한 번만).
# ad-hoc 서명은 다시 빌드할 때마다 서명(해시)이 바뀌어 macOS가 새 앱으로 보고 권한(문서 폴더·마이크 등)을 다시 묻는다.
# 이 인증서로 서명하면 빌드가 바뀌어도 같은 앱으로 알아본다. 다른 Mac에서는 ad-hoc과 똑같이 "확인되지 않은 개발자"다.
# 개인 키는 키체인에만 남고 저장소에는 들어가지 않는다. scripts/sign-app.sh가 이 이름으로 찾아 쓴다.
set -e
NAME="Meeting Recorder Local"
if security find-certificate -c "$NAME" >/dev/null 2>&1; then
  echo "이미 있습니다: $NAME"
  exit 0
fi
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/cert.cnf" <<EOF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $NAME
[ext]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
EOF
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -config "$TMP/cert.cnf" -keyout "$TMP/key.pem" -out "$TMP/cert.pem" 2>/dev/null
PASS=$(openssl rand -hex 16)
openssl pkcs12 -export -inkey "$TMP/key.pem" -in "$TMP/cert.pem" -name "$NAME" -out "$TMP/cert.p12" -passout "pass:$PASS"
security import "$TMP/cert.p12" -k "$HOME/Library/Keychains/login.keychain-db" -P "$PASS" -T /usr/bin/codesign
echo "만들었습니다: $NAME"
