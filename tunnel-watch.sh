#!/usr/bin/env bash
# 터널만 따로 감시·재발급 — 서버(serve.py)를 수동으로 띄워둔 상태에서 사용.
# (./start-show.sh 로 켰다면 워치독이 내장돼 있으니 이 스크립트는 필요 없음.
#  둘을 동시에 돌리지 말 것 — 서로 터널을 갈아치운다.)
#
#   nohup ./tunnel-watch.sh 8777 > tunnel-watch.log 2>&1 &
set -u
cd "$(dirname "$0")"
PORT="${1:-8777}"

open_tunnel() {
  pkill -f "cloudflared tunnel" 2>/dev/null || true
  sleep 1
  : > cf.log
  nohup cloudflared tunnel --protocol http2 --url "http://localhost:$PORT" > cf.log 2>&1 &
  local u=""
  for i in $(seq 1 30); do
    u=$(grep -aoE 'https://[a-z0-9-]+\.trycloudflare\.com' cf.log | head -1 || true)
    [ -n "$u" ] && break
    sleep 1
  done
  case "$u" in https://*.trycloudflare.com)
    printf '%s' "$u" > public_url.txt
    echo "$(date '+%H:%M:%S') ✓ 공개주소: $u"
    return 0;;
  esac
  echo "$(date '+%H:%M:%S') ⚠ 터널 발급 실패"
  return 1
}

# 기존 주소가 살아 있으면 그대로 감시만, 죽었으면 즉시 재발급
while true; do
  U=$(cat public_url.txt 2>/dev/null || true)
  if [ -n "$U" ]; then
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$U/config" || true)
    if [ "$code" != "200" ]; then
      echo "$(date '+%H:%M:%S') ⚠ 터널 응답 없음(code=$code) — 재발급"
      open_tunnel || true
    fi
  else
    open_tunnel || true
  fi
  sleep 45
done
