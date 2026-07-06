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
  - 크롬 인자: `--autoplay-policy=no-user-gesture-required --mute-audio --force-color-profile=srgb`, viewport 1600×900 @2x
  - 진입 흐름: `[data-action="start"]` 클릭(1번째=오디오 깨우기) → 다시 클릭 → `[data-action="to-setup"]` → 플레이.

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
- **선물(드래그&드롭 이펙트)**: 캐릭터별 `.char-gift`를 다른 캐릭터 썸네일에 드롭 → 받는 캐릭터에 리버브.
  **라운드 동안엔 숨김**(CSS 기본 display:none), `endCycle()`이 `body.gift-time`을 켜야 보인다(선물 단계 전용).
  선물 단계 진입 시 부호 패드·하트 레이어 제거. 받은 선물은 썸네일 아래 `.gift-badges`에 **전부** 아이콘으로
  나열(title에 품목 텍스트 나열).
- **QR 대기화면(#screen-qr)**: 앱의 첫 화면(타이틀 앞, `state.screen='qr'` 초기값·`screens.qr` 등록).
  큰 QR(`renderBigQR`, 420px — /config의 lanUrl=터널 주소)과 주소 텍스트, ▶(`qr-done`)로 타이틀로.
  주의: QR 화면 ▶이 오디오를 깨우므로 타이틀 인트로가 끝나면 select로 **자동 전환**된다(기존 동작).
- **폰 선물 화면**: 메인이 `postPhase('round'|'gift'|'ending')`→서버 `/phase`→SSE `{type:'phase'}` 브로드캐스트.
  폰(tap.html)은 phase에 따라 투표 패드↔선물 화면 전환(늦게 접속하면 /config의 phase로 동기화).
  폰 선물: 누가→누구에게 두 번 탭→POST `/gift {giver,recip}`→SSE `{type:'gift'}`→메인이 선물 단계일 때만
  `giveSpecificGift` 적용.
  - audio.js: `giftedVoices` Set + `giftBus()` + `destFor(voiceId)`. 확장 시 같은 패턴으로 딜레이/피치 추가 가능.
  - 아직 **엔딩 악보/합주에는 미반영**(라이브 소리에만). 드래그는 마우스(HTML5 DnD) 기준 — 터치는 미지원.
- **엔딩(2단계)**:
  1. **순차 듀엣** — `buildScore()` → `playScore()`. 두 사람이 친 순서/리듬 그대로 한 줄 악보로.
  2. (끝나면 onDone) **오케스트라 합주** — `buildOrchestra()`(발화마다 파트, **랜덤 startBeat**) →
     `playEnsemble(..., {loop:false})`. 파트별 보표를 쌓은 `drawOrchestraScore()`로 총보처럼 보여줌.
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
- **듀엣 연출(play 화면)**: `drawDuetHeads()` — 지금 치는 캐릭터가 입력칸 왼쪽(차례0)/오른쪽(차례1)에
  말할 때만 등장(흑백 실루엣), 타건 직후 450ms 입 움직임(`lastKeyAt`). phase==='round'에서만.
- **아스키아트 전환**: 선물 ▶(`giftDoneToEnding`)→`startAsciiArt()`. 최다 득표 부호(winningNuance)의
  그림 마스크(`asciiMaskDraw` — 부호를 그대로 그리지 않는 **추상 구도**: ~=간섭하는 물결 다발 ·
  !=한 점에서 터지는 방사선 · .=점과 번지는 파문(동심원) · …=흩어지며 잦아드는 점들 ·
  ?=안으로 말려드는 소용돌이 · ;=허공에서 끊기는 획들+점. 고정시드 `rnd(i)`로 메인·폰 동일)를 샘플링해,
  스코어에 타이핑된 글자들이 원래 자리에서 "슈우우" 날아가(easeInOutCubic, ASCII_FLY=2.4s) 화면 가득
  그림을 만들고 ASCII_HOLD=5s 머문 뒤 `endAsciiToEnding()`→엔딩. `body.ascii-time`으로 스코어판/열/입력칸 숨김.
  POST `/ascii {mark,chars}`→SSE로 폰도 같은 그림을 폰 규격으로 렌더(tap.html artMaskDraw/renderArt,
  라운드/idle에서 내려감).
- **캐릭터 소개 컷신(스토리보드 기반 재제작)**: 룰렛 착지 750ms 후 재생, 디더링(도트)+컬러 레이어.
  사용자 스케치(IMG_0519)·스토리보드(IMG_0520) 기반. `INTRO_PX=2.0`(촘촘한 도트=실사 톤),
  전 장면 공통 필름 비네트(카메라 변환 밖, 화면 고정). **실사 톤 기법**: `ctx.filter='blur(Npx)'`로
  층별 피사계심도(원경 흐림·전경 보케), 라디얼 그라디언트 볼륨, 접촉 그림자.
  - **내레이션 자막(INTRO_NARR)**: 컷신마다 맨 아래 대화창(네모칸)에 이야기 문장이 한 글자씩
    타이핑(INTRO_TYPE_CPS=16)되고, 찍힌 지 0.5s 지난 글자 일부(hash 확률)가 외계어 글리프
    (INTRO_ALIEN '◆●■▲▼…')로 변한다. 캐럿 '▌' 깜박임. sctx에 화면 고정(디더 안 거침).
  - tomato(12s, 2장면): A(0~5.2s) 잎 무성한 덩굴밭 — 결각·잎맥 잎(leaf(x,y,sz,ang,L) — L 기준
    라디얼 음영), 뒤층 blur 2.5px·앞층 선명·구석 보케 잎 blur 6px, 광택 열매+별 꽃받침
    (tomatoFruit/calyx, 어두운 할로), 맨 위 안 익은 초록 하나, 핑토도 매달려 있음 →
    화이트 플래시 → B(5.2~12s) 나무 상자 — 슬랫·나뭇결·모서리 기둥·좌우 입체 음영·열매 접촉
    그림자, 무더기 속 핑토(미운오리새끼), 줌인 후 눈물 또르르(8.2s~), '…'(10.2s)
  - 심해어(1) 착지만 → phone(새 2 착지 시, 11s, 3비트): ①커다란 느티나무(사진 레퍼런스) — 원경
    산등성이 blur, 풀밭, 뿌리 벌어진 둥치+세로 껍질 결, 잎덩이 클러스터 3층(뒤 어둡고 흐림→앞
    밝고 선명, `clump`), 가지 위 다이얼 전화기 발견(!)
    ②심해(사진 레퍼런스) — 수면 빛웅덩이+갓레이 5가닥, 밝은 물고기떼 14, 해파리 2, 기포,
    울퉁불퉁 바위 능선 2겹(ridge), 해초 9가닥 — 에서 심해어도 폰 발견(!)
    ③클로즈업 — 둘 다 **무선전화기 수화기**(cordlessHandset: 세로 바디·이어슬릿·화면·키패드, 사진
    레퍼런스)를 들고 벨(호 확산)→'?'/'?'→'♪'. 비트 전환은 화이트 플래시. 베이스 전화기(비트①②)는 rotary.
  - mouse(8s): 부엌(싱크대·창문 빛), 부스러기 따라 쫄쫄쫄(먹으면 사라짐)→**빗자루가 들어와(3.0s~)
    스윽스윽 쓸어냄**(발 쿵 장면은 사용자 요청으로 삭제)→줄행랑→왼쪽에서 빼꼼 '…'.
  - 캐릭터만 컬러(cctx+characterColor), 배경 흑백 망점. 마지막(생쥐) 컷신 후 ▶ ready.
- **캐릭터 디자인(sprites.js MINI_DRAW)**: 핑토(0)만 신규 — 동그란 몸 + 흰 별 꼭지 + 흰 눈·세모 입.
  심해어/새/생쥐(1·2·3)는 **원래 라인아트 디자인**(검정 잉크, silhouetteFill로 통짜 실루엣화).
  silhouetteFill이 흰 픽셀(합 620↑)을 보존한다(핑토 별·눈, 심해어 발광 깜박).
  컷신 컬러 레이어(introColorCanvas)는 **풀해상도**(W×H) — 저해상 디더를 거치지 않아 픽셀아트가 또렷.
  전화 컷신 소품 rotary는 사진 수준 입체(바닥 그림자·벌어진 스커트 받침·광택 돔 몸통·금속판
  다이얼+도넛 구멍 10개+동심원 메달+멈춤쇠·크래들 기둥·코일 전화선), handset은 두툼한 아치 바+
  라디얼 음영 나팔 컵. `tone()` 헬퍼로 dark/light 반전.
  생쥐 컷신 배경은 사진 레퍼런스 기반 부엌 — 액자식(섀이커) 찬장 문 4+4짝(`cabDoor`)·서브웨이 타일(엇갈린
  벽돌식)·레인지후드+덕트·걸이봉의 조리도구 4종(국자/뒤집개/팬/거품기)·싱크+구스넥 수도꼭지·도마/유리병·
  김 나는 냄비(애니메이션)·서랍 3단·토킥 그늘·2×2 창살 창문+창턱 화분·원목 마루 널판 결.
  빗자루는 짚 빗자루(사진 레퍼런스) — 자루 H*0.58 + 종 모양 짚단 실루엣(brushLen≥S*1.5, 폭≈S*1.9),
  짚 가닥 38줄+갈라진 끝단 30줄+노끈 5회 감기. swing에 짚끝이 휜다.
- **엔딩 클린 화면**: 3D 스코어 재생 중 춤추는 캐릭터 없음(drawScore3D에서 drawDancers 제거),
  리플레이·재시작 버튼 없음 — **Esc**로 처음(타이틀)으로 돌아간다.
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
