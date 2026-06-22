#!/usr/bin/env bash
# 자동 실행된 서버·터널을 끈다.
pkill -f "serve.py" 2>/dev/null && echo "서버 종료" || echo "서버 안 떠 있음"
pkill -f "cloudflared tunnel --url" 2>/dev/null && echo "터널 종료" || echo "터널 안 떠 있음"
rm -f "$(dirname "$0")/public_url.txt"
