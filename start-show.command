#!/usr/bin/env bash
# 더블클릭 런처 — 서버 + 공개 터널을 켜고 브라우저까지 자동으로 연다.
# (Finder에서 더블클릭하면 Terminal에서 실행된다. 이 폴더 안에 두고 써야 함.)
cd "$(dirname "$0")" || exit 1
PORT="${1:-8777}"

# 이미 켜져 있으면 브라우저만 연다(중복 실행 방지).
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "이미 켜져 있습니다 — 브라우저만 엽니다."
  open "http://localhost:$PORT/"
  sleep 1
  exit 0
fi

# 공개주소(public_url.txt)가 준비되면 브라우저를 연다(터널 없으면 ~20초 뒤 그냥 연다).
(
  for _ in $(seq 1 40); do [ -s public_url.txt ] && break; sleep 0.5; done
  open "http://localhost:$PORT/"
) &

# 서버 + 터널 시작(Ctrl+C 또는 창 닫으면 함께 종료된다).
exec ./start-show.sh "$PORT"
