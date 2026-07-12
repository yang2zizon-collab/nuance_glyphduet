# CLAUDE.md — "뉘앙스" 글리프 듀엣 (Score 버전)

이 파일은 Claude Code가 이 프로젝트를 이어서 작업할 때 읽는 맥락 문서다.
다른 컴퓨터로 폴더를 옮겨도 이 파일이 함께 가므로, 새 환경에서도 바로 이어서 작업할 수 있다.

## 프로젝트 개요
- **2인 타이핑 대화 게임 / 공연용 오디오비주얼 작품.** 주제는 "소통".
- 픽셀 캐릭터들이 각자의 외계 글리프 언어로 말하고, 두 사람이 한 키보드로 번갈아 친다.
- 대화가 끝나면 그 대화가 하나의 "그래픽 스코어"이자 연주(엔딩)로 재생된다.
- 이 폴더는 **그래픽 스코어(흰 배경·검정 잉크) 버전만** 담은 독립 실행본이다.
  (원래는 dark/CRT/score 3개 테마가 있었고, 이건 score만 추린 클린 빌드다.)

## 실행 / 확인
- 빌드 과정 없음. 정적 사이트(HTML+CSS+ESM). **반드시 로컬 서버로** 연다(`file://` 직접 열기는 ESM 차단으로 실패).
  - `python3 serve.py 8777` → http://localhost:8777/
- 폰트(Datatype, Galmuri)는 CDN 로드 → **인터넷 필요**. 첫 화면 ▶ 클릭해야 오디오가 켜진다(자동재생 정책).
- **변경 검증은 헤드리스 puppeteer 스크린샷으로** 한다(인앱 미리보기는 Desktop 파일 접근 제한이 있어 우회).
  - **반드시 `headless: 'shell'`** — `'new'` 모드는 이 맥에서 컴포지터가 프레임을 안 만드는 상태에 빠질 수 있음
    (rAF 0 → `p.click()`류 CDP 입력이 무한 대기 → ProtocolError 타임아웃. 페이지 evaluate는 멀쩡해서 헷갈림).
  - 크롬 인자: `--autoplay-policy=no-user-gesture-required --mute-audio --force-color-profile=srgb`, viewport 1600×900 @2x
  - 진입 흐름: 타이틀 `[data-action="start"]` **두 번**(1클릭=오디오 깨움·그래뉼러, ~0.9s 뒤
    2클릭=소개로) → select(룰렛 4회) → `#slot-start` → QR 화면 → `[data-action="qr-done"]` → play.
    컷신은 INTRO_PACE 1.25× 실시간이라 대기 여유 필요.
  - **테스트는 반드시 별도 포트로 서버를 새로 띄워서**(예: `python3 serve.py 8899`) — 8777은
    공연용이라 관객 폰이 붙어 있고, 테스트가 /phase 등을 방송하면 폰 화면이 멋대로 넘어간다.

## 파일 구조
```
index.html              진입점. <body class="theme-score">
css/style.css           공통 기본 스타일
css/style-score.css     스코어 테마 스타일(.theme-score 한정)
js/main.js              메인 로직(상태·렌더 루프·입력·엔딩). 나머지 js를 import
js/sprites.js           캐릭터 4종 + 미니 실루엣
js/audio.js             사운드 엔진(타이핑·발화·엔딩 악보/합주·선물 리버브)
js/glyphs.js            외계 글리프 8개 체계(SYSTEMS)
js/language.js          표시용 글자 변환(renderDisplay/toAlien)
js/background.js        배경
serve.py                로컬 서버
```

## 핵심 개념 / 규칙
- **테마 플래그**(main.js): `SCORE = body.classList.contains('theme-score')`, `MINIMAL = ...'theme-crt'`.
  이 빌드는 SCORE만 쓰지만 코드엔 다른 분기가 남아 있다. **새 동작은 `if (SCORE)` / `.theme-score`로 가두는 컨벤션 유지.**
- **캐릭터(sprites.js)**: 4종 — 핑크토마토(0)·심해어(1)·새(2)·생쥐(3).
  각 캐릭터는 `voice` 필드로 **원래 소리·글리프 인덱스**를 가진다(0,1,2,**7**). `characterVoice(i)`가 그 값을 반환.
  - **스프라이트·색·이름** = 배열 인덱스(0~3) 사용.
  - **소리·글리프**(타이핑·발화·말풍선·엔딩 보이스/글자) = `characterVoice(pick)` 사용.
  - glyphs.js의 SYSTEMS, audio.js의 VOICES는 8개이며 modulo 인덱싱이라 0~7 안전.
- **캐릭터 선택 UI**: 왼쪽 한 열(현재 4개). 썸네일 클릭 = **지금 차례인 화자**의 캐릭터를 바꾼다. 정사각 비율 유지.
- **타이핑 차례 = 매번 4명 중 무작위 자동선택**: `pickRandomActive()`가 매 차례(startPlay 첫 차례,
  sendMessage 전송 후, passTurn=Tab) `state.picks[state.turn]`에 무작위 캐릭터를 앉힌다(직전 화자
  `lastActiveChar`는 피함). 슬롯머신 소개·선물은 그대로 4명 고정. 메시지마다 `pick`이 기록돼 엔딩이
  화자별로 재구성됨.
- **캐릭터 컬러**: 모든 화면에서 캐릭터 실루엣만 색을 가진다 — 토마토 핑크(#ff5d8f)·심해어
  남색(#3a4fa0)·새 귤색(#ff9d3b)·생쥐 연보라(#b9a6e8). `silhouetteDraw`가 `characterColor(idx)`로
  픽셀 단위 채색(silhouetteFill rgb 파라미터). CSS의 brightness(0) 필터는 제거됨(다시 넣으면 색이 죽는다).
  **현재 전부 흑백** — silhouetteDraw 기본 검정(마지막 color 인자를 넘길 때만 색, 컷신 재제작 시 사용).
  토마토 A·B컷은 **둘 다 흑백 도트(하프톤)**. 배경을 흑백 ctx에 그리면 끝에서 dither→도트아트가 된다.
  B컷 폴백은 `buildTomBColor(W,H,S)`(컬러 상자 합성, 크기별 캐시)를 ctx에 blit → dither가 명도만 남겨 흑백 도트로.
- **선물(드래그&드롭 이펙트)**: 캐릭터별 `.char-gift`를 다른 캐릭터 썸네일에 드롭 → 받는 캐릭터에 리버브.
  **라운드 동안엔 숨김**(CSS 기본 display:none), `endCycle()`이 `body.gift-time`을 켜야 보인다(선물 단계 전용). gift-time엔 스코어판·입력칸이 0.8s 페이드로 숨고 **캐릭터 열이 화면 정중앙 가로 배치로 커진다**(썸네일 ~150px, 선물 상자 아래).
  선물 단계 진입 시 부호 패드·하트 레이어 제거. 받은 즉시 **배경에 3개씩 떠다닌다**(캐릭터 위 착용 오버레이는 사용자 요청으로 제거)(`floatGift` → #gift-float-layer, opacity 0.2 부유 애니 — giftDoneToEnding·resetGifts가 비움). 받은 선물은 썸네일 아래 `.gift-badges`에 **전부** 아이콘으로
  나열(title에 품목 텍스트 나열).
- **QR 화면(#screen-qr)**: **캐릭터 소개(select)가 끝난 뒤** 나온다 — 흐름: 타이틀 ▶(한 번, 시작
  사운드 없음) → select(룰렛·컷신) → `to-setup` ▶ → **QR 화면** → `qr-done` ▶(randomMatch) → play.
  큰 QR(`renderBigQR`, 420px — /config의 lanUrl=터널 주소)과 주소 텍스트.
  타이틀 리버스 스웰(우웅) 인트로는 사용자 요청으로 **제거됨**(startTitleMusic 미사용).
- **폰 선물 화면**: 메인이 `postPhase('round'|'gift'|'ending')`→서버 `/phase`→SSE `{type:'phase'}` 브로드캐스트.
  폰(tap.html)은 phase에 따라 **대기(#wait-ui "곧 참여가 시작됩니다", idle·ending 기본)** ↔ 투표
  패드(round) ↔ 선물 화면(gift) 전환(늦게 접속하면 /config의 phase로 동기화).
  선물 버튼·흐름 칩은 **캐릭터 스프라이트**(module script가 sprites.js drawCharacter를 import,
  라인아트를 캐릭터 색으로 틴트한 `window.charImg(i,px)`; 모듈 로드 전엔 색 동그라미 폴백).
  받는이 버튼엔 받을 선물 미리보기(GIFT_ICONS 이모지+GIFT_NAMES), 전달 확인에도 이모지.
  폰 선물: **한 화면 2패널**(위: 보내는 이 칩 4개 탭 전환 · 아래: 받는 이 카드 3장 — 카드에 그 조합의 품목 아이콘·이름 표시, 탭=즉시 전송, 보낸 뒤 선택 유지. 단계·뒤로가기·드래그 없음)→POST `/gift {giver,recip}`→SSE `{type:'gift'}`→메인이 선물 단계일 때만
  `giveSpecificGift` 적용.
  - audio.js: `giftedVoices` Set + `giftBus()` + `destFor(voiceId)`. 확장 시 같은 패턴으로 딜레이/피치 추가 가능.
  - 아직 **엔딩 악보/합주에는 미반영**(라이브 소리에만). 드래그는 마우스(HTML5 DnD) 기준 — 터치는 미지원.
- **엔딩(2단계)**:
  **독주 페이스**: endTargetSec 75(절반) + 리듬 15% 가속(긴 발화 3초 압축) + **발화 앞뒤 ~2초 오버랩**
  (advance = max(0.8, dur-2)) — 꼬리가 끝나기 전에 다음 목소리가 들어온다(playEndingMusic). 
  1. **순차 듀엣** — `buildScore()` → `playScore()`. 두 사람이 친 순서/리듬 그대로 한 줄 악보로.
  2. (끝나면 onDone) **오케스트라 합주** — `buildOrchestra()`(발화마다 파트, **랜덤 startBeat**) →
     `playEnsemble(..., {loop:true, gain:1.15})`. 파트별 보표를 쌓은 `drawOrchestraScore()`로 총보처럼 보여줌.
     **합주 소리 규칙**: 오디오 입장 오프셋은 2.5초로 감아(반전 직후 무음 방지) 파트들이 스웰처럼
     차오르고, loop:true로 합주 내내 촘촘히 유지(1회전만 하면 짧은 대화에선 몇 초 만에 성겨져
     "소리가 안 난다"고 들림 — RMS 계측으로 확인). 합주 소리는 시각 종료보다 **8초 길게**(duration+8) 걸어 잼 베드(오프셋 %1.5, 게인 0.7)와
     크로스페이드 — 합주 끝에서 뚝 끊기지 않는다. 관객 음표 소리는 uiClick 2연타(기본+옥타브 위)
     + typeVoice 1.1로 어떤 버스가 죽어도 홀로 또렷. **playEnsemble은 8초 창 굴림 예약**: 전 음을 시간순 평탄화 → 상한 초과분 고른 솎아내기 →
     앞으로 8초치만 그때그때 생성(2.5초마다 창 전진). 예전엔 시작 순간 수백 음×노드 10여 개
     = 수천 노드를 한꺼번에 만들어 **실기기 오디오 스레드가 질식해 "합주 무음"**이 됐다
     (헤드리스 --mute-audio 널 싱크에선 재현 안 되는 함정). MAX_NOTES(700)
     초과분을 **고르게 솎아냄**(keepEvery) — 예전처럼 상한에 닿는 순간 후반이 통째로 무음이 되지 않는다.
  - 오디오: `scoreBus` 게인 0.95, `startEndingScore()`에서 `resumeAudio()`로 긴 세션 후에도 소리 보장.
  - **3D 그래픽 스코어(score 테마 엔딩)**: `drawScore3D()`가 1·2단계 모두 렌더(loop의 ending 분기에서
    SCORE면 호출). `flatScoreNotes()`로 `{beat,midi,lane,player,glyph,accent}` 평탄화 → 고정 3D 공간에
    배치(z=beat·ZS 깊이, y=음높이, x=성부 레인). `beat<=playBeat`인 음만 보임(칠 때 생성·누적). 캔버스
    원근 투영(라이브러리 0, v3* 헬퍼). 카메라는 리드 약간 앞에서 -z로 보며 음악과 함께 전진+잔잔한 sway,
    가까운 음 크고 진하게/먼 음 작고 옅게, 성부별 연결선·3선 받침이 소실점으로. 비SCORE는 기존
    `drawFullScore`/`drawOrchestraScore` 유지.
- **뉘앙스 라운드 사이클 — 관객참여**: 플레이 시작 시 `startCycle()`(startPlay에서 호출).
  라운드 길이가 `ROUND_DURATIONS=[32,16,8,4]`(초)로 순환 반복(`roundIndex%4`), 각 라운드 앞에
  `COUNTIN_SECONDS=4` 예비박. phase는 `'countin' → 'round' → … → 'gift'`. `loop()`의 play
  분기에서 `tickCycle()`이 예비박 카운트(4·3·2·1, `#countin`, uiClick 비트)·라운드 게이지
  (`#round-gauge`) 갱신과 전환을 처리(`phaseEndsAt` 기준, setTimeout 없이 loop로 구동).
  타이핑은 phase==='round'에서만, 투표는 round·countin 둘 다 가능. 퍼포머가 ■
  (`#round-stop`, data-action `round-stop`)로 `endCycle()`→선물 단계. 6개 부호
  `NUANCES=[period,question,bang,ellipsis,tilde,semicolon]` (`MARK_GLYPH` = `. ? ! … ~ ;`).
  - **투표**: `castVote(kind,who)` — 버튼(`#mark-bar`의 `.mark-key`, data-action `mark-tap`) 또는
    폰 SSE. `nuanceVotes` 증가 → `spawnHeart()`(인스타 라이브식 떠오르는 부호, `#heart-layer`,
    `.heart`/`.heart.aud`) + `playMark()` 피드백음 + `updateTally()`(버튼 카운트/`.lead` 강조).
  - **실시간 이펙트**: `computeLeader()`(최다 득표)가 바뀌면 `applyNuanceEffect(lead)` 즉시 적용.
    audio.js의 마스터 인서트(`buildNuanceFx`: lowpass/tremolo/drive/reverb send, master→nuanceFx→comp)를
    `NUANCE_FX[kind]` 파라미터로 setTargetAtTime 램프. `endCycle()`에서 그때의 승자
    (`winningNuance`)를 엔딩까지 고정. `resetNuanceEffect()`=neutral(startCycle·restart 시).
  - **이후 흐름**: ■→`endCycle()`→`state.phase='gift'`(타이핑 잠금, `#gift-bar` 표시) →
    ▶(`to-ending`)=`giftDoneToEnding`→`showEnding`. 선물 드래그&드롭은 기존대로 동작.
  - **관객 폰(실시간)**: `serve.py`가 정적 서빙 + SSE(`/events`)·탭수신(`/tap`, MARKS 6개)·`/config`
    (표준 라이브러리만). 폰 `tap.html`(6버튼)에서 POST → `setupAudience()` EventSource가
    `castVote(kind,'aud')`. 라운드 중 QR 표시(`renderMarkQR`, QRCode CDN).
  - **폰 접속 주소**: 같은 와이파이면 `/config`의 LAN 주소 QR. 데이터(셀룰러)로도 받으려면
    `cloudflared tunnel --url http://localhost:8777`로 공개주소를 만들고 메인을
    `?pub=<공개주소>`로 열면 QR이 그 주소를 가리킨다. 터널 없으면 LAN으로 폴백.
  - **퀵 터널은 종종 혼자 죽는다**(프로세스는 살아 있는데 엣지 연결만 끊겨 000 — 오늘만 두 번).
    `./start-show.sh`에 **워치독** 내장: 45초마다 공개주소 `/config`를 확인하고 죽어 있으면
    자동으로 새 터널 발급 + public_url.txt 갱신(주소가 바뀌므로 메인 새로고침·폰 QR 재스캔 필요).
    수동 복구: cloudflared kill → 재실행 → cf.log에서 URL 추출 → public_url.txt 갱신.
- **고정 입구 주소(재부팅·터널 재발급에도 QR 불변)**: QR은 언제나
  `https://yang2zizon-collab.github.io/nuance_glyphduet/go.html`(serve.py ENTRY_URL, /config
  entryUrl — 메인 큰 QR·라운드 미니 QR 모두 이 주소, ?pub=은 예외로 우선). go.html(레포 루트,
  GitHub Pages가 main 루트 서빙)이 `tunnel_url.json`(레포 루트)을 **2중 소스**로 읽어 현재 터널
  `/tap.html`로 연결: ① jsDelivr(`cdn.jsdelivr.net/gh/...@main/...`) — push 직후 퍼지로 수 초 내
  신선(1순위) ② raw.githubusercontent — **?t= 캐시버스트를 무시하고 ~5분 묵음**(실측), 백업.
  start-show.sh·tunnel-watch.sh의 `push_tunnel_url()`이 터널 (재)발급 때마다 json을
  경로 한정 커밋(`git commit -m … tunnel_url.json`)+push+**jsDelivr 퍼지·검증 반복**
  (`purge.jsdelivr.net/...` — **레이스 주의**: GitHub 원본 전파 전에 퍼지하면 옛 내용이 다시
  신선한 척 캐시됨(실제 발생) → 내용 일치까지 퍼지 반복, 최대 ~60초). **폰 자가 이주**: tap.html 4초 폴링이
  3회 연속 실패하면 json을 읽어 다른 origin이 살아 있으면(또는 갓 발급) `location.replace`로
  갈아탐 — 접속해 있던 폰도 재스캔 없이 따라온다(localStorage uid는 origin별이라 색 순번은
  새로 배정됨). grep은 반드시 `-a`(cf.log 바이너리 판정 시 "Binary file …" 오염 방지) +
  기록 전 URL 형태 검증. **1033(터널 사망) 3중 방어**: ① go.html·tap.html 이주는 `/config`
  200이 **검증된 주소로만**(죽은 주소로 보내면 Cloudflare 에러 페이지에서 우리 코드가 안 돌아
  복구 불능) ② **서비스 워커**(sw.js, tap.html이 등록) — navigate 요청이 실패(네트워크)하거나
  5xx(1033=530)면 캐시된 recover.html 제공 → 거기서 json 읽어 산 주소로 자동 이주(죽은 주소에서
  **새로고침해도** 살아남) ③ 워치독 감지 20초(+curl 6초) + start-show.sh는 발급 실패(주소 없음)
  상태도 성공할 때까지 재시도. **불사 대기 루프**: go.html은 5회(≈25초)·recover.html은
  6회(≈30초) 실패마다 **셀프 새로고침**(수동 새로고침의 자동화 — 루프 예외·CDN 지역 캐시가
  어떻든 리셋; sessionStorage로 시도 횟수 승계, recover는 SW 캐시가 되살림). recover.html을
  고치면 **sw.js CACHE 버전을 반드시 올릴 것**(설치 때 캐시가 박제됨 — v2부터 구캐시 자동 삭제).
  start-show.sh는 `caffeinate -dimsu`로 공연 중 맥 잠들기 방지(잠들면 터널·서버가 끊긴다 —
  "왜 자꾸 끊기나"의 유력 원인).
- **듀엣 연출(play 화면)**: `drawDuetHeads()` — 지금 치는 캐릭터가 입력칸 왼쪽(차례0)/오른쪽(차례1)에
  말할 때만 등장(흑백 실루엣), 타건 직후 450ms 입 움직임(`lastKeyAt`). phase==='round'에서만.
- **아스키아트 전환**: 선물 ▶(`giftDoneToEnding`)→ 선물 UI가 내려가며 **그래픽 스코어만(네모 프레임째, body.score-only — 입력칸·캐릭터 열 숨김) 0.8s 페이드로 재등장 → 3초 보여준 뒤** `startAsciiArt()`(showTimers 타이머 — devJump가 정리). 최다 득표 부호(winningNuance)의
  그림 마스크(`asciiMaskDraw` — 부호를 그대로 그리지 않는 **추상 구도**: ~=간섭하는 물결 다발 ·
  !=한 점에서 터지는 방사선 · .=점과 번지는 파문(동심원) · …=흩어지며 잦아드는 점들 ·
  ?=안으로 말려드는 소용돌이 · ;=허공에서 끊기는 획들+점. 고정시드 `rnd(i)`로 메인·폰 동일)를 샘플링해,
  **밀도 필드 샘플링**(cell=min/58, 작게·촘촘하게): 마스크 진하기 v>150 = 타이핑 글자 촘촘,
  60<v≤150 = 작은 글자·점 혼합, 빈 곳도 hash 24%로 옅은 '·' 들판 — 글자 있는 곳/없는 곳의 경계가
  아니라 밀도의 그라데이션. 원래 자리에서 "슈우우" 날아가(ASCII_FLY=2.4s) 완성되면
  **부호별로 숨쉰다**(`asciiMotion`: ~=넘실 · !=맥동 · .=파문 · …=드리프트 · ?=감돌기 · ;=흔들림,
  settle 페이드인). 렌더는 `glyphSprite` 아틀라스 drawImage(fillText 제거 — 프레임드랍 방지).
  ASCII_HOLD=7s 후 `endAsciiToEnding()`→엔딩. `body.ascii-time`으로 스코어판/열/입력칸 숨김.
  POST `/ascii {mark,chars}`(점 제외 실제 글자만)→SSE로 폰도 같은 밀도 필드+움직임을 렌더
  (tap.html artMaskDraw/artMotion/renderArt — RAF 30fps, 라운드/idle에서 내려감).
- **소개 컷신 배경 사진 필터(사용자 제공 이미지)**:
  tomatoB는 로드 시 `composeTomatoB`로 **사진 자체를 합성 편집**: 위쪽 수풀 밴드를 확대해 배경으로
  깔고(하단 그늘 그라디언트), 상자+토마토 영역을 크롭해 **50% 축소**(살짝 어둡게 + 타원 페더)해
  하단 중앙에 얹는다 → 토마토가 방울토마토 스케일이 됨. 그 뒤 카툰 필터(edge 62). 핑토는 pk=S*0.62로
  축소, py2=H*0.56(토마토 줄 위). loadIntroPhoto(key,srcs,edge,pre)의 pre 인자로 연결.
  로드 시 `cartoonizePhoto`로 **살짝 만화 느낌**(톤 포스터화 CARTOON_LEVELS=6 + 소벨 에지 잉크선
  CARTOON_EDGE=78)을 1회 입혀 캐시(ent.styled) → 그 뒤 dither가 도트로 → 만화 스크린톤 톤.
   `assets/intro/tomato-a.(jpg|png|jpeg)` /
  `tomato-b.*`가 있으면 토마토 A/B컷 배경으로 쓴다 — `loadIntroPhoto`로 프리로드, `drawPhotoCover`가
  커버핏으로 흑백 ctx에 그려 dither→도트아트, 그 위에 핑토를 얹는다. 파일이 없으면 손그림 폴백.
  **저작권 있는 스톡 사진(워터마크/미구매)은 넣지 말 것 — 본인 촬영·정식 라이선스·CC0만.** (assets/intro/README.md)
- **캐릭터 소개 컷신(스토리보드 기반 재제작)**: 룰렛 착지 750ms 후 재생, 디더링(도트)+컬러 레이어.
  사용자 스케치(IMG_0519)·스토리보드(IMG_0520) 기반. `INTRO_PX=2.0`(촘촘한 도트=실사 톤),
  **생쥐 부엌 컷만 `MOUSE_LOFI_PX=4.0`**(도트 크기는 drawIntroScene 첫머리에서 kind·s로 프레임마다
  결정 — 버퍼 리사이즈로 플레이트 캐시도 자동 재생성, 컷 플래시가 전환을 가림),
  전 장면 공통 필름 비네트(카메라 변환 밖, 화면 고정). **실사 톤 기법**: `ctx.filter='blur(Npx)'`로
  층별 피사계심도(원경 흐림·전경 보케), 라디얼 그라디언트 볼륨, 접촉 그림자.
  - **내레이션 자막(INTRO_NARR)**: 컷신마다 맨 아래 대화창(네모칸)에 **한국어(ko)+영어(en) 두 줄**이
    타이핑된다(영어는 작게 #555, 길이 비례 cps로 함께 끝남). INTRO_TYPE_CPS=8(느긋한 낭독 호흡),
    장면당 4~6줄(시적·추상). 찍힌 지 0.4s 지난 글자 **~80%**(hash>0.2, 공백 제외)가 외계어 글리프로
    변한다 — 한글·영어 모두. **낭독(동물의숲식)**: 글자가 찍힐 때마다 그 글자를 `typeKey(ch, 0.16,
    4+(li%2))`로 웅얼웅얼 — 원래 말이 들릴 듯 말 듯 변형된 목소리(introScene.spoken으로 중복 방지).
    **상자 폭 자동 맞춤**: 두 줄 measureText 후 fit 배율로 폰트 축소 — 절대 삐져나가지 않는다.
    캐럿 '▌'는 진행 중인 줄에. sctx에 화면 고정(디더 안 거침).
  - **길이/경계**: INTRO_DUR 19/17/16s(base), TOMATO_CUT=8.5, MOUSE_CUT=6.5, PHONE_B2=5.4·PHONE_B3=10.8.
    장면 내부 이벤트 초들도 그에 맞춰 시프트됨(b2 swim 6.0~8.2, b3 벨 11.6~, 눈물 13.0~ 등).
  - **프레임드랍 최적화**: ① `ditherIntroCanvas` — 문턱값 사전계산 + Uint32 쓰기.
    ② `plate(key, fn)` — 블러·그라디언트 무거운 **정적 배경을 월드 좌표로 1회만** 오프스크린에 굽고
    매 프레임 drawImage 1번(카메라 줌은 변환이 처리). ctx가 `let`이라 fn 안 코드·헬퍼가 그대로 동작.
    플레이트: tomA/tomB/tree/seaSky/seaFloor/street/kitchen. `introLayerCache`는 컷신 시작마다 비움.
    동적 요소(김·부스러기·빗자루·물고기·해파리·기포·해초·빛줄기·캐릭터)는 플레이트 밖에서 매 프레임.
  - tomato(12s, 2장면): A(0~5.2s) 잎 무성한 덩굴밭 — 결각·잎맥 잎(leaf(x,y,sz,ang,L) — L 기준
    라디얼 음영), 뒤층 blur 2.5px·앞층 선명·구석 보케 잎 blur 6px. **A컷 열매는 사용자 요청으로
    전부 제거 — 잎과 핑토만**(tomatoFruit/calyx/clusters는 B컷에서만 사용) →
    화이트 플래시 → B(5.2~12s) 나무 상자 — **살짝 위·옆 3/4 시점**(oxP/oyP 오프셋: 윗면 개구부
    사다리꼴·오른쪽 면 스큐 슬랫·윗테 립·뒤 기둥), 무더기 뒷줄(작게)/앞줄(크게)·접촉 그림자,
    무더기 속 핑토(미운오리새끼), 줌인 후 눈물 또르르(8.2s~), '…'(10.2s).
    열매는 전부 원줄기→노드→꼭지줄기(pedicel)로 연결(공중부양 금지).
  - 심해어(1) 착지만 → phone(새 2 착지 시, 11s, 3비트): ①커다란 느티나무(사진 레퍼런스) — 원경
    산등성이 blur, 풀밭, 뿌리 벌어진 둥치+세로 껍질 결, 잎덩이 클러스터 3층(뒤 어둡고 흐림→앞
    밝고 선명, `clump`), 가지 위 다이얼 전화기 발견(!)
    ②심해(사진 레퍼런스) — 수면 빛웅덩이+갓레이 5가닥, 밝은 물고기떼 14, 해파리 2, 기포,
    울퉁불퉁 바위 능선 2겹(ridge), 해초 9가닥 — 에서 심해어도 폰 발견(!)
    ③클로즈업 — 둘 다 **무선전화기 수화기**(cordlessHandset: 세로 바디·이어슬릿·화면·키패드, 사진
    레퍼런스)를 들고 벨(호 확산)→'?'/'?'→'♪'. 비트 전환은 화이트 플래시. 베이스 전화기(비트①②)는 rotary.
  - mouse(12.5s, 2장면): A(0~4.5s=MOUSE_CUT) **밤의 도시(라따뚜이 무드)** — 달·흐릿한 철탑 실루엣·
    오스만풍 파사드(따뜻한 불 켜진 창+빛 번짐)·카페 차양·자갈길 원근 아치·가로등 불빛 웅덩이,
    생쥐가 총총 내달리다 멈칫 두리번('…') → 화이트 플래시 → B(4.5~12.5s) 부엌(내부 로컬 시계
    `{ const s = sKitchen }` — 장면 안 초 값은 그대로): 부스러기 쫄쫄쫄→빗자루(3.0s~)가 쓸어냄
    (발 쿵 장면은 사용자 요청으로 삭제)→줄행랑→왼쪽에서 빼꼼 '…'.
  - **INTRO_PACE=1.25**: 컷신 내부 시계 s를 1/PACE로 늦춰 전체 호흡을 여유 있게. dur은 PACE배.
    장면 코드의 초 값·INTRO_NARR의 at은 전부 "장면 내부 초" 기준이라 그대로 유효.
  - 캐릭터만 컬러(cctx+characterColor), 배경 흑백 망점. 마지막(생쥐) 컷신 후 ▶ ready.
- **캐릭터 디자인(sprites.js MINI_DRAW)**: 핑토(0)만 신규 — 동그란 몸 + 흰 별 꼭지 + 흰 눈·세모 입.
  심해어/새/생쥐(1·2·3)는 **원래 라인아트 디자인**(검정 잉크, silhouetteFill로 통짜 실루엣화).
  silhouetteFill이 흰 픽셀(합 620↑)을 보존한다(핑토 별·눈, 심해어 발광 깜박).
  컷신 컬러 레이어(introColorCanvas)는 **풀해상도**(W×H) — 저해상 디더를 거치지 않아 픽셀아트가 또렷.
  전화 컷신 소품 rotary는 사진 수준 입체(바닥 그림자·벌어진 스커트 받침·광택 돔 몸통·금속판
  다이얼+도넛 구멍 10개+동심원 메달+멈춤쇠·크래들 기둥·코일 전화선), handset은 두툼한 아치 바+
  라디얼 음영 나팔 컵. `tone()` 헬퍼로 dark/light 반전.
  생쥐 컷신 배경은 사진 레퍼런스 기반 부엌 — **윌리엄 모리스풍 벽지**(Willow Boughs식 굽이치는 줄기+잎
  부채살+열매 점을 오프스크린 타일에 굽고 createPattern 반복, 밝은 벽 바탕 위 잉크 톤)·액자식(섀이커) 찬장 문 4+4짝(`cabDoor`)·서브웨이 타일(엇갈린
  벽돌식)·레인지후드+덕트·걸이봉의 조리도구 4종(국자/뒤집개/팬/거품기)·싱크+구스넥 수도꼭지·도마/유리병·
  김 나는 냄비(애니메이션)·서랍 3단·토킥 그늘·2×2 창살 창문+창턱 화분·원목 마루 널판 결.
  빗자루는 참조 사진 기반 **비트(픽셀) 짚 빗자루** — 어둡고 가는 자루(살짝 굽음)+노끈 밴드+부챗살로 넓게 퍼지며 끝이 갈라지는(프레이) 볏짚을 셀 단위(cs=S*0.072) fillRect로 그린다. 로컬 회전 프레임(pivot→rotate ang-PI/2).
- **개발자 점프 버튼(리허설)**: 좌상단 고정 `#dev-bar` — 8px·투명도 0.1(호버 시 0.85)의 네모 4개,
  순서대로 **타이핑·선물하기·독주·합주**(`data-dev="type|gift|solo|ens"` → `devJump`). 어느 단계에서든
  곧장 뛴다. 대화가 없으면 `devSeedMessages()`가 가짜 대화 3마디(rhythm 포함)를 심어 독주/합주 재료를
  만든다. 합주 점프는 독주를 0.5s 만에 끊고 startOrchestraPhase 직행. 잔여물(gift-time 등)은 점프마다 정리.
- **엔딩 클린 화면**: 3D 스코어 재생 중 춤추는 캐릭터 없음(drawScore3D에서 drawDancers 제거),
  리플레이·재시작 버튼 없음 — **Esc**로 처음(타이틀)으로 돌아간다.
- **타이틀 ▶ 2단 동작**: QR 화면에서 오디오가 미리 깨어나므로, 타이틀 첫 ▶은 `titleIntroStarted`
  플래그로 **우웅(리버스 스웰)만 재생하며 머물고**(scheduleIntroAdvance 10.5s 자동 전환), 두 번째
  ▶이 select로. startScreenAudio('title')는 플래그 있어야 인트로 시작. show('title')서 플래그 리셋.
- **엔딩 HUD 페이드**: showEnding 8초 후 `body.ending-hud-off` → #screen-ending opacity 0(1.8s
  transition) — 소통 게이지·문구가 사라지고 스코어만 꽉 차게. stopEndingScore/타이틀 복귀서 해제.
- **합주 폰 스틸+터치 음표**: `captureScoreStill(live)`가 스코어를 720×900 JPEG로 POST `/still`
  (`live` 플래그 포함) → 서버 보관+SSE `{type:'still',live}` → 폰(#still-ui)이 자동 표시.
  **독주(1단계, 흰 배경)는 live=0 보기 전용** — 완성 악보만 띄우고 터치 잠금("합주가 시작되면
  터치로 함께 연주해요"), **합주 진입(startOrchestraPhase)이 live=1로 다시 올리면 그때부터 터치
  참여 활성화**("터치하면 음표가 하나 태어납니다"; tap.html `stillLive`, jamMode도 true).
  폰 터치 → POST `/addnote` → SSE → 메인 `addAudienceNote()`가 총보 랜덤 파트의 현재
  박에 글리프 음표를 삽입(+소리 typeKey). 폰엔 터치 리플+글리프 팝+"내가 보탠 음표 n개" 카운터.
  라운드/idle에서 스틸 해제(서버도 clear). 폰 라운드 안내문: "가장 많이 눌린 기호가 음악의 말투가 됩니다".
- **관객 음표 소리·강조**: addAudienceNote는 `uiClick`(마스터 직결 — 뉘앙스 이펙트/합주 리버브에
  안 묻혀 **합주 중에도 처음부터 들림**) + `typeVoice`(캐릭터 목소리 색) 두 겹. 음표엔 `aud/born`
  마크 → drawScore3D가 1.4초 팝(×2.2)+이중 확산 링으로 탄생 강조, 이후에도 가는 링 유지.
- **관객 음표 개인 파스텔 색(최대 ~50명)**: 폰이 uid(localStorage `nuanceUid`)를 `/addnote`에 실어
  보내면 서버 `aud_colors`가 **선착순 순번(cidx)** 을 배정(phase round/idle에 리셋), SSE와 응답 양쪽에
  실어준다. 색 공식은 메인·폰 동일 — **골든앵글** `hue=(cidx*137.508)%360` + **채도 4사이클
  (AUD_SATS)·밝기 5사이클(AUD_LOFF)**(`audPastel(i,a,l)`) — 색상환이 돌아 비슷한 h가 나와도 톤이
  달라 같은 색으로 안 보인다. 합주(2단계) 글리프는 뭉텅이 방지로 원래의 1/3(sizeBase 0.1·max 14·min 4 — 붐빌수록 점묘처럼), **크기 곡선**: 합주 시작 2배 → 30초에 걸쳐 1배로(orchestraT0 기준, 성긴 초반은 크게·밀도가 차면 작게). 잼 카메라 시간배율 0.17(대화면 멀미 방지). __probe에 audUsers/audNotes/audTop — 관객 부하 점검용(50명×5탭 부하 테스트로 FPS 60 유지 확인).
  메인은 음표에 cidx를 심고(**flatScoreNotes가 cidx도 복사해야 함 — 필드 추가 시 여기 잊지 말 것**),
  drawScore3D에서 색 음표는 본 패스에서 건너뛰고 **difference 반전 이후에** hsla로 그린다(색이 안
  뒤집힘). 밝기 l은 반전 진행도로 보간(흰 바탕 45 ↔ 검정 바탕 78). 폰은 첫 응답의 cidx로 리플·글리프·
  카운터를 자기 색(l 48)으로 틴트.
- **관객 닉네임 + 미니 랭킹**: 닉네임 = 형용사+명사 무작위 조합(`audNick(cidx)` — AUD_ADJS/NOUNS
  24×24, h32 해시). **tap.html에 같은 목록·해시 사본이 있으니 수정 시 반드시 양쪽 동기화.**
  `audScores`(cidx→음표 수, addAudienceNote에서 집계, startOrchestraPhase/stopEndingScore에서 리셋)
  → drawScore3D 맨 끝(반전 뒤)에서 **우상단에 아주 작게 1~5위**를 각자 파스텔 색으로 그린다.
  폰 카운터엔 "● {닉네임} — 내가 보탠 음표 n개 · 랭킹에 올라갑니다".
- **폰 화면 튕김 방지(replay 가드)**: 서버가 SSE 접속 직후 밀어주는 phase에는 `replay:true`가 붙는다.
  tap.html `setMode(phase, replay)`는 **그림·스틸 표시 중 replay/폴링으로 온 'idle'을 무시** — 서버
  재시작(phase가 idle로 초기화)해도 연주하던 폰이 대기화면으로 튕기지 않는다. 진짜 리셋(Esc)은
  라이브 방송(replay 없음)이라 정상 동작. /config 폴링도 replay 취급.
  **폴링 자가치유**: /config에 `stillLive`·`jam`이 실려 있어, 폰이 SSE(활성 스틸·잼 개시)를 놓쳐도
  4초 폴링이 "보기 전용인데 서버는 활성"이면 스틸을 다시 받아 무장하고, 잼 캡션도 따라잡는다
  (SSE 전면 차단 조건에서 검증 — "관객 터치 소리가 안 난다"의 실제 원인이던 잠김 해소).
- **독주(1단계) 2배속**: startEndingScore가 rhythm rel을 SOLO_SPEED=2로 압축, GAP 0.3.
- **관객 잼(합주 종료 후)**: 합주 progress≥1 → `startJam()`(드로우 프레임 + `jamTimer` 폴백 —
  rAF가 백그라운드로 멈춰도 정시 개시) → POST `/jam` → SSE `{type:'jam'}` → 폰 캡션 "이제 당신의
  차례! 터치로 함께 연주하세요"/서브 "관객 합주". 잼 동안 `addAudienceNote`는 **랜덤 박**에 심어
  구름 전체에 흩뿌려짐. **잼 음악 베드**: 합주 1회전은 짧은 대화면 몇 초 만에 끝나 그 뒤가 무음이었음
  ("합주 때 소리가 안 나") → startJam이 `orchestraTracks`(오프셋 %4로 감음)를
  `playEnsemble({speed:1, duration:22, loop:true, gain:0.55})`로 잔잔히 돌리고 **20초마다 새 판**
  (audio.js MAX_NOTES=700 상한에 걸려 조용해지기 전에 — 리버브 꼬리가 이음매를 가림). playEnsemble에
  `gain` 옵션 추가됨. stopEndingScore가 jamBed/jamBedTimer/orchestraTracks 정리. **그룹 순차 잼**: 잼 개시 → A(30s)→B(30s)→C(30s)→다같이(ALL). 그룹 = 자기 파스텔 색의 최대
  채널(audGroupOf — hsl→rgb argmax, tap.html에 동일 사본). 메인이 /jamgroup POST(서버 current_group,
  /config jamGroup) → 폰 캡션 "○그룹(당신) 차례!"/"듣는 시간", 차례 아니면 전송 안 함 + 메인 게이트도
  이중 차단(퍼포머 익명 탭은 항상 허용). 폰은 참여 열릴 때 /hello로 색 순번을 미리 받는다(음표 없이).
  **아웃트로**: dev-bar 맨 오른쪽 회색 버튼 — 관객 터치 잠금(outroOn) + fadeMasterOut(40s) +
  drawScore3D 검은 덮개 40s 페이드. Esc/리셋이 restoreMaster·해제. **잼 카메라** = SF 우주유영(시간 배율 0.17 — 아주 느긋). **카메라 UI**(#cam-ui, 좌상단 — score-invert 동안만): 동그라미 조이스틱(잡은 방향으로 계속 회전 → camDragYaw/Pitch, 놓으면 점 복귀·정지) + 줌 ±(camDist 0.45~2.2, 누르고 있으면 반복). 캔버스 드래그 회전·탭 음표는 그대로(#cam-ui 위 조작은 음표 제외). stopEndingScore가 셋 다 리셋.
  메인 하단엔 합주 내내 작은 안내("핸드폰 화면을 터치하면…" → 잼엔 "지금이에요 —…") — 캔버스에
  그려져 색 반전과 함께 뒤집힘. 잼 상태는 stopEndingScore가 riset.
  **주의**: showEnding의 HUD 타이머는 반드시 `startEndingScore()` **뒤에** 걸 것(안의
  stopEndingScore가 타이머를 지움 — 실제로 한 번 그 순서 버그가 있었다).
- **타이핑 용량**: GRID_CELL=28(칸 ≈2.5배), --play-w min(1040px,72vw)·--play-h 60vh,
  스코어 테마 .gcell 폰트 clamp(10px,1.35vw,17px).
- **내레이션 폭**: 외계어 글리프(◆)가 영문보다 넓으므로 ko/en 각각 "전부 ◆가 된 문자열" 폭까지
  재서(alien1) 최악값 기준으로 fit — 절대 삐져나가지 않는다. 캐럿 여유 fk*3.0.
- **합주 색 반전**: 1단계(순차 듀엣)는 흰 바탕·검정 잉크, 2단계(오케스트라 합주) 진입 순간
  `orchestraT0` 기준 2.6s 동안 스스슥 반전 → **검정 바탕에 흰 그래픽**. 캔버스는 drawScore3D 끝의
  `difference` 합성 풀스크린 페이드(원본↔반전 선형 크로스페이드), DOM(엔딩 문구·게이지)은
  `body.score-invert` + CSS transition으로 함께 반전. stopEndingScore()가 원복.
- **미학**: 흰 바탕 검정 잉크, 픽셀 실루엣, 크세나키스풍 직선 글리산도 그래픽 스코어.

## 작업 컨벤션
- 주석·UI 문구는 한국어. 코드 스타일은 주변 코드에 맞춘다.
- 변경 후엔 위 헤드리스 플로우로 스크린샷 찍어 시각/콘솔 에러를 확인한다.
- **자동 커밋+push**: 사용자가 "수정할 때마다 자동으로 올려달라"고 했다. 코드를 바꾼 작업(턴)을
  마칠 때마다, 검증이 끝나면 자동으로 `git add -A && git commit && git push` 한다(매번 묻지 않음).
  - 커밋 메시지는 그 턴에 한 변경을 한국어로 요약. 끝에 `Co-Authored-By: Claude ...` 한 줄.
  - 코드를 안 바꾼 턴(질문·설명만)에는 push 하지 않는다.
  - 원격: `origin` = https://github.com/yang2zizon-collab/nuance_glyphduet (main).
  - 새 컴퓨터에서는 그 PC에 `gh auth login`(또는 git 자격증명)이 돼 있어야 push가 된다. 인증 없으면
    커밋까지만 하고 push 실패를 사용자에게 알린다.
