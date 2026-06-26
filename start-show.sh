#!/usr/bin/env bash
# 공연용 실행 — 서버 + 공개 터널을 한 번에 켜고, QR이 자동으로 공개주소를
# 가리키게 한다(폰 데이터로 접속 가능). 그냥 http://localhost:<포트>/ 만 열면 된다.
#
#   ./start-show.sh         # 포트 8777
#   ./start-show.sh 9000    # 다른 포트
#
# 필요한 것: python3, cloudflared(없으면: brew install cloudflared)
set -e
cd "$(dirname "$0")"
PORT="${1:-8777}"
rm -f public_url.txt cf.log

python3 serve.py "$PORT" &
SRV=$!
cleanup() { kill "$SRV" "$CF" 2>/dev/null || true; rm -f public_url.txt; }
trap cleanup INT TERM EXIT

if command -v cloudflared >/dev/null 2>&1; then
  echo "터널 여는 중…(공개주소 받기)"
  cloudflared tunnel --protocol http2 --url "http://localhost:$PORT" > cf.log 2>&1 &
  CF=$!
  URL=""
  for i in $(seq 1 30); do
    URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' cf.log | head -1 || true)
    [ -n "$URL" ] && break
    sleep 1
  done
  if [ -n "$URL" ]; then
    printf '%s' "$URL" > public_url.txt
    echo "✓ 공개주소: $URL"
    echo "  → QR이 자동으로 이 주소를 가리킵니다(폰 데이터 OK)"
  else
    echo "⚠ 터널 URL을 못 받음 — 같은 와이파이(LAN)로만 동작합니다. (cf.log 확인)"
  fi
else
  echo "⚠ cloudflared 가 없어 같은 와이파이(LAN)로만 동작합니다."
  echo "  데이터로도 받으려면:  brew install cloudflared  후 다시 실행"
fi

echo ""
echo "메인 화면 열기:  http://localhost:$PORT/"
echo "끝내려면 Ctrl+C"
wait "$SRV"
