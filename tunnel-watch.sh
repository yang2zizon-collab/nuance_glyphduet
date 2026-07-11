#!/usr/bin/env bash
# 터널만 따로 감시·재발급 — 서버(serve.py)를 수동으로 띄워둔 상태에서 사용.
# (./start-show.sh 로 켰다면 워치독이 내장돼 있으니 이 스크립트는 필요 없음.
#  둘을 동시에 돌리지 말 것 — 서로 터널을 갈아치운다.)
#
#   nohup ./tunnel-watch.sh 8777 > tunnel-watch.log 2>&1 &
set -u
cd "$(dirname "$0")"
PORT="${1:-8777}"


push_tunnel_url() {   # 현재 공개주소를 GitHub에 올린다 — 고정 QR(go.html)·폰 자동 이주가 이걸 읽는다
  local u; u=$(cat public_url.txt 2>/dev/null) || return 0
  case "$u" in https://*.trycloudflare.com) : ;; *) return 0 ;; esac
  printf '{"url":"%s","epoch":%s}' "$u" "$(date +%s)" > tunnel_url.json
  git commit -m "터널 주소 갱신(자동)" tunnel_url.json >/dev/null 2>&1 || return 0
  git pull --rebase --autostash >/dev/null 2>&1 || true
  git push origin main >/dev/null 2>&1 && echo "  → 고정 QR에 새 주소 반영됨" || echo "  ⚠ 주소 자동 반영 실패(인터넷?) — 다음 재발급 때 재시도"
}

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
    push_tunnel_url || true
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
