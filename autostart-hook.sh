#!/usr/bin/env bash
# Claude Code 세션 시작 시 자동 호출(.claude/settings.local.json의 SessionStart 훅).
# 서버가 안 떠 있으면 서버+공개터널을 백그라운드로 분리 실행하고 즉시 반환한다.
# 이미 떠 있으면 아무것도 하지 않는다(중복 방지). Claude 창을 닫아도 살아 있다.
cd "$(dirname "$0")" || exit 0
PORT="${1:-8777}"

# 이미 켜져 있으면 끝.
lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 && exit 0

# 서버 시작(분리 — Claude 세션이 끝나도 유지)
nohup python3 serve.py "$PORT" >/tmp/sori-server.log 2>&1 &
disown 2>/dev/null || true

# 공개 터널 시작 + 공개주소를 public_url.txt에 기록(있을 때만)
if command -v cloudflared >/dev/null 2>&1; then
  : > cf.log
  nohup cloudflared tunnel --url "http://localhost:$PORT" >cf.log 2>&1 &
  disown 2>/dev/null || true
  (
    for _ in $(seq 1 40); do
      U=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' cf.log | head -1)
      [ -n "$U" ] && { printf '%s' "$U" > public_url.txt; break; }
      sleep 0.5
    done
  ) >/dev/null 2>&1 &
  disown 2>/dev/null || true
fi
exit 0
