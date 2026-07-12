#!/usr/bin/env bash
# 공연용 실행 — 서버 + 공개 터널을 한 번에 켜고, QR이 자동으로 공개주소를
# 가리키게 한다(폰 데이터로 접속 가능). 그냥 http://localhost:<포트>/ 만 열면 된다.
#
#   ./start-show.sh         # 포트 8777
#   ./start-show.sh 9000    # 다른 포트
#
# 필요한 것: python3, cloudflared(없으면: brew install cloudflared)
# 퀵 터널은 종종 혼자 죽는다 → 워치독이 45초마다 공개주소를 확인하고,
# 죽어 있으면 자동으로 새 터널을 발급해 public_url.txt를 갱신한다.
# (주소가 바뀌므로 이미 접속한 폰은 QR을 다시 스캔해야 한다 — 메인 화면도 새로고침.)
set -e
cd "$(dirname "$0")"
export PATH="$HOME/bin:/opt/homebrew/bin:$PATH"   # cloudflared가 ~/bin에 있어도 찾도록
PORT="${1:-8777}"
# 단일 인스턴스 보장 — 겹쳐 뜬 이전 공연 프로세스를 먼저 정리.
# (겹친 옛 인스턴스가 나중에 죽으며 cleanup으로 공용 파일을 지우는 사고가 실제로 있었다)
for p in $(pgrep -f "start-show.sh" 2>/dev/null || true); do [ "$p" != "$$" ] && kill "$p" 2>/dev/null || true; done
pkill -f "serve.py $PORT" 2>/dev/null || true
pkill -f "cloudflared tunnel" 2>/dev/null || true
sleep 1
rm -f public_url.txt cf.log cf.pid

python3 serve.py "$PORT" &
SRV=$!
# 공연 중 맥이 잠들면 터널·서버가 끊긴다 — 서버가 사는 동안 잠들기 방지(디스플레이 포함)
caffeinate -dimsu -w "$SRV" >/dev/null 2>&1 &
CAF=$!
cleanup() {
  kill "$SRV" "$WATCH" "$CAF" 2>/dev/null || true
  [ -f cf.pid ] && kill "$(cat cf.pid)" 2>/dev/null || true
  # public_url.txt는 지우지 않는다 — 겹친 인스턴스가 죽으며 남의 파일을 지우는 사고 방지.
  # 묵은 주소가 남아도 워치독·페이지가 검증 후 걸러내니 무해하다.
  rm -f cf.pid
}
trap cleanup INT TERM EXIT


push_tunnel_url() {   # 현재 공개주소를 GitHub에 올린다 — 고정 QR(go.html)·폰 자동 이주가 이걸 읽는다
  local u; u=$(cat public_url.txt 2>/dev/null) || return 0
  case "$u" in https://*.trycloudflare.com) : ;; *) return 0 ;; esac
  printf '{"url":"%s","epoch":%s}' "$u" "$(date +%s)" > tunnel_url.json
  git commit -m "터널 주소 갱신(자동)" tunnel_url.json >/dev/null 2>&1 || return 0
  git pull --rebase --autostash >/dev/null 2>&1 || true
  if git push origin main >/dev/null 2>&1; then
    # jsDelivr 퍼지는 백그라운드에서 수렴까지 반복(원본 전파 전 퍼지 = 옛 내용 재캐시
    # 레이스가 있어 최대 ~6분 재시도). 폰의 1순위 소스는 Pages(~20-60초)라 안 막아도 된다.
    (
      for k in $(seq 1 24); do
        curl -s -o /dev/null --max-time 8 "https://purge.jsdelivr.net/gh/yang2zizon-collab/nuance_glyphduet@main/tunnel_url.json" || true
        sleep 6
        got=$(curl -s --max-time 8 "https://cdn.jsdelivr.net/gh/yang2zizon-collab/nuance_glyphduet@main/tunnel_url.json" 2>/dev/null | grep -Fo "$u" || true)
        [ -n "$got" ] && break
        sleep 9
      done
    ) >/dev/null 2>&1 &
    echo "  → 새 주소 push 완료(전파: Pages ~30초 · jsDelivr 백그라운드 수렴)"
  else
    echo "  ⚠ 주소 자동 반영 실패(인터넷?) — 다음 재발급 때 재시도"
  fi
}

open_tunnel() {   # 터널 하나 열고 URL을 public_url.txt에 기록(성공 시 0)
  : > cf.log
  cloudflared tunnel --protocol http2 --url "http://localhost:$PORT" > cf.log 2>&1 &
  echo $! > cf.pid
  local u=""
  for i in $(seq 1 30); do
    u=$(grep -aoE 'https://[a-z0-9-]+\.trycloudflare\.com' cf.log | grep -v '^https://api\.' | head -1 || true)
    [ -n "$u" ] && break
    sleep 1
  done
  case "$u" in
    https://api.trycloudflare.com) : ;;   # 클플 내부 API 주소 — 터널 주소 아님
    https://*.trycloudflare.com) printf '%s' "$u" > public_url.txt; echo "✓ 공개주소: $u"; push_tunnel_url || true; return 0;;
  esac
  return 1
}

WATCH=""
if command -v cloudflared >/dev/null 2>&1; then
  echo "터널 여는 중…(공개주소 받기)"
  if open_tunnel; then
    echo "  → QR이 자동으로 이 주소를 가리킵니다(폰 데이터 OK)"
  else
    echo "⚠ 터널 URL을 못 받음 — 같은 와이파이(LAN)로만 동작합니다. (cf.log 확인)"
  fi
  # 터널 워치독 — 공개주소가 죽으면 자동 재발급(45초 간격 확인)
  (
    while true; do
      sleep 20
      U=$(cat public_url.txt 2>/dev/null || true)
      if [ -z "$U" ]; then   # 발급 실패 상태 — 성공할 때까지 재시도(데이터 접속은 반드시 살린다)
        echo ""; echo "⚠ 공개주소 없음 — 터널 재발급 시도…"
        [ -f cf.pid ] && kill "$(cat cf.pid)" 2>/dev/null || true
        sleep 1
        open_tunnel || true
        continue
      fi
      code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 6 "$U/config" || true)
      if [ "$code" != "200" ]; then
        echo ""
        echo "⚠ 터널 응답 없음(code=$code) — 새 터널 발급 중…"
        [ -f cf.pid ] && kill "$(cat cf.pid)" 2>/dev/null || true
        sleep 1
        if open_tunnel; then
          echo "  → 주소가 바뀌었습니다. 메인 화면 새로고침 + 폰 QR 다시 스캔!"
        fi
      fi
    done
  ) &
  WATCH=$!
else
  echo "⚠ cloudflared 가 없어 같은 와이파이(LAN)로만 동작합니다."
  echo "  데이터로도 받으려면:  brew install cloudflared  후 다시 실행"
fi

echo ""
echo "메인 화면 열기:  http://localhost:$PORT/"
echo "끝내려면 Ctrl+C"
wait "$SRV"
