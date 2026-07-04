// "뉘앙스" 글리프 듀엣 / "Nuance" Glyph Duet — 상태 머신 + 입력 + 렌더 루프.

import { drawCharacter, characterCount, characterName, characterColor, characterVoice, setMinimal } from './sprites.js';
import { initAudio, typeBlip, typeKey, typeVoice, uiClick, speakVoiceEvents, playEnsemble, warmVoices, playScore,
         stopAmbience, playMark, applyNuanceEffect, resetNuanceEffect,
         startTitleMusic, stopTitleMusic, startSelectTone, stopSelectTone,
         startPlayBeat, stopPlayBeat, beatKick, countTick, slotSpin, slotLand,
         playScreenWav, stopScreenWav, resumeAudio, setGift, clearGifts } from './audio.js';
import { renderDisplay, isAlienLook } from './language.js';
import { glyphForCode, glyphForChar, toAlien } from './glyphs.js';
import { drawPairBackground, drawMinimalPairBackground } from './background.js';

const N = characterCount();

// CRT(비트맵) 미니멀 모드 — index-crt.html의 body.theme-crt로 켜짐.
// 켜지면 화려한 배경(디오라마)을 빼고 단색 배경 + 캐릭터만 그린다.
const MINIMAL = document.body.classList.contains('theme-crt');
// 그래픽 스코어 테마(index-score.html): 흰 배경 · 검정 잉크. 배경(디오라마) 없음.
const SCORE = document.body.classList.contains('theme-score');
setMinimal(MINIMAL || SCORE); // CRT·스코어 모드면 캐릭터를 플랫 미니멀 스타일로 그린다

const state = {
  screen: 'title',
  phase: 'talk',          // play 화면 내 단계: 'talk'(대화) → 'mark'(부호 탭)
  picks: [0, 3],          // 캐릭터 인덱스
  turn: 0,                // 현재 차례
  input: '',
  messages: [],           // {player, text, mood, garble}
  rhythms: [],            // {voiceId, events:[{rel,ch}]} — 메시지마다 친 리듬(엔딩 합주용)
  talkUntil: [0, 0],      // 말하는 애니메이션 종료 시각(ms)
  lastMood: 'neutral',    // 마지막 메시지의 무드(표정·반응·앰비언스에 사용)
  reactUntil: [0, 0],     // 반응 이모트 강조 종료 시각(ms)
  ended: false,           // 엔딩 진입 여부 — 중복 진입(악보 재시작·합주 중첩) 방지
};

// 무드는 메시지마다 랜덤. 각 무드가 목소리 이펙트·표정·반응 기호를 결정한다.
const MOODS = ['happy', 'sad', 'angry', 'confused'];
function moodFace(m) { return m === 'happy' ? 'happy' : m === 'sad' ? 'sad' : 'neutral'; }
function moodGlyph(m) {
  return m === 'happy' ? '♪' : m === 'sad' ? '…' : m === 'angry' ? '!' : m === 'confused' ? '?' : '·';
}
// 무드 → 앰비언스 협화도(밝기) 대용값
function moodRapport(m) { return m === 'happy' ? 0.9 : m === 'confused' ? 0.5 : m === 'sad' ? 0.32 : m === 'angry' ? 0.2 : 0.5; }
// 무드 → 엔딩 악보 가블(웅얼거림) 정도
function garbleForMood(m) { return m === 'happy' ? 0.2 : m === 'confused' ? 0.85 : m === 'sad' ? 0.6 : m === 'angry' ? 0.8 : 0.5; }
// ===== 스코어 그리드 — 사각형 공간을 칸으로 나누고, 글자가 빈 칸에 랜덤하게 채워진다 =====
const GRID_CELL = 40;        // 한 칸의 대략 픽셀 크기(목표). 실제 칸 수는 패널 크기로 계산.
let gridCells = [];          // 칸 DOM 요소들
let emptyCells = [];         // 아직 안 채워진 칸 인덱스들
let fillableTotal = 0;       // 채울 수 있는 칸 수(스코어 테마=하트 안쪽 칸만)

// (col,row)가 나무 모양 안인지. 위는 3단으로 점점 넓어지는 잎(침엽수 캐노피),
// 아래는 가운데 기둥. 칸을 넉넉히 채우도록 캐노피를 크게 잡는다.
function inTree(col, row, cols, rows) {
  const cx = (cols - 1) / 2;
  const fx = (col - cx) / (cols / 2);          // 가로 -1(왼) … +1(오)
  const fy = row / Math.max(1, rows - 1);      // 세로 0(위) … 1(아래)
  const ax = Math.abs(fx);
  // 잎(캐노피): 위 0 ~ 0.80 구간. 3단으로 겹쳐 점점 넓어지는 삼각형들.
  if (fy <= 0.80) {
    const tiers = [
      { top: 0.00, bot: 0.34, hw: 0.42 },      // 위 단(좁음)
      { top: 0.24, bot: 0.58, hw: 0.68 },      // 가운데 단
      { top: 0.48, bot: 0.80, hw: 0.96 },      // 아래 단(가장 넓음)
    ];
    for (const t of tiers) {
      if (fy >= t.top && fy <= t.bot) {
        const hw = t.hw * ((fy - t.top) / (t.bot - t.top));   // 각 단: 위 뾰족 → 아래 넓게
        if (ax <= hw) return true;
      }
    }
    return false;
  }
  // 기둥(trunk): 아래 가운데.
  return ax <= 0.14;
}

function buildGrid() {
  const conv = $('#conversation');
  if (!conv) return;
  conv.innerHTML = '';
  conv.classList.add('grid');
  const w = conv.clientWidth || 600, h = conv.clientHeight || 400;
  const cols = Math.max(1, Math.floor(w / GRID_CELL));
  const rows = Math.max(1, Math.floor(h / GRID_CELL));
  conv.style.setProperty('--cols', cols);
  conv.style.setProperty('--rows', rows);
  gridCells = [];
  emptyCells = [];
  const n = cols * rows;
  for (let i = 0; i < n; i++) {
    const c = document.createElement('span');
    c.className = 'gcell';
    conv.appendChild(c);
    gridCells.push(c);
    emptyCells.push(i);   // 일단 화면을 가득 채운다(모양 제한 없음 — inTree/inHeart는 보관만)
  }
  fillableTotal = emptyCells.length;
}

// 글자 하나를 비어있는 칸 중 랜덤한 위치에 채운다.
function placeGlyph(ch, color) {
  if (!emptyCells.length) return false;
  const k = Math.floor(Math.random() * emptyCells.length);
  const idx = emptyCells.splice(k, 1)[0];
  const cell = gridCells[idx];
  cell.textContent = ch;
  cell.style.color = color;
  cell.classList.add('filled');
  return true;
}

// 스코어 그리드가 얼마나 찼는지 0..1 (대화 진행도 = 그리드 채움)
function fillProgress() {
  const total = fillableTotal || gridCells.length || 1;
  return Math.min(1, (total - emptyCells.length) / total);
}
// 그리드가 꽉 찼는가 → 대화 종료 신호
function scoreFull() {
  return gridCells.length > 0 && emptyCells.length === 0;
}

// ===== DOM =====
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const scene = $('#scene');
const sctx = scene.getContext('2d');
const screens = {
  title: $('#screen-title'), select: $('#screen-select'),
  setup: $('#screen-setup'), play: $('#screen-play'), ending: $('#screen-ending'),
};
const pickCanvases = [...$$('.pick-canvas')];
const pickNames = [...$$('.pick-name')];

// 도감(스코어 테마 전용) — 그리드에서 한 칸씩 탭하면 가운데에 크게 보여준다.
const dexStage = $('#dex-stage');
const dexGrid = $('#dex-grid');
let dexView = 0;

// ===== 슬롯머신 캐릭터 소개(스코어 테마) =====
// 창 하나에서 세로 릴이 돌고(가속→감속), 레버를 내릴 때마다 다음 캐릭터가 정해진 순서로
// 부드럽게 멈춰 소개된다. 이웃 칸은 위·아래로 살짝 비치고, 착지 때 살짝 튀어오른다.
const SLOT_ORDER = [0, 1, 2, 3];    // 소개 순서(토마토→심해어→새→생쥐)
let slotIndex = 0;                   // 다음 소개할 순번(0..N)
let slotSpinning = false;
let slotTarget = 0;
let slotDisplay = -1;                // 마지막으로 착지한 캐릭터(-1=시작 전)
let slotScroll = 0;                  // 릴 스크롤(칸 높이=캔버스 폭 단위)
let slotScrollFrom = 0, slotScrollTo = 0;
let slotSpinStart = 0, slotSpinDur = 1500;
let slotLandAt = -1;                 // 착지 시각(바운스)
let slotTickIdx = -1;                // 스핀 틱 사운드용

function resetSlot() {
  slotIndex = 0; slotSpinning = false; slotDisplay = -1; slotScroll = 0; slotLandAt = -1;
  const nm = $('#slot-name'); if (nm) { nm.textContent = ''; nm.classList.remove('show'); }
  const cnt = $('#slot-count'); if (cnt) cnt.textContent = `0 / ${N}`;
  const st = $('#slot-start'); if (st) st.classList.remove('ready');
}

function pullSlot() {
  if (!SCORE || slotSpinning || slotIndex >= N) return;
  slotTarget = (SLOT_ORDER[slotIndex] != null) ? SLOT_ORDER[slotIndex] : slotIndex;
  const CH = dexStage ? dexStage.width : 128;
  const span = N * CH;
  const cur = ((slotScroll % span) + span) % span;
  let delta = (slotTarget * CH - cur); delta = ((delta % span) + span) % span;
  slotScrollFrom = slotScroll;
  slotScrollTo = slotScroll + 3 * span + delta;   // 3바퀴 돌고 target에 착지
  slotSpinStart = performance.now();
  slotSpinDur = 1500;
  slotSpinning = true; slotTickIdx = -1;
  const nm = $('#slot-name'); if (nm) nm.classList.remove('show');
  uiClick(0.45);
  slotSpin(slotSpinDur / 1000);   // 키치한 또로로로롱 — 긴장 쌓기
  const lever = $('#slot-lever');
  if (lever) { lever.classList.add('pulled'); setTimeout(() => lever.classList.remove('pulled'), 430); }
}

// 릴이 멈춰 한 캐릭터에 착지했을 때 — 이름·카운트 갱신, 다 끝나면 시작 버튼 노출.
// (소개 컷신은 추후 레퍼런스 기반으로 새로 제작 예정 — 지금은 착지만.)
function onSlotLanded() {
  const nm = $('#slot-name'); if (nm) { nm.textContent = characterName(slotDisplay); nm.classList.add('show'); }
  const cnt = $('#slot-count'); if (cnt) cnt.textContent = `${slotIndex} / ${N}`;
  const win = $('#slot-window'); if (win) { win.classList.remove('land'); void win.offsetWidth; win.classList.add('land'); }
  uiClick(0.85);   // 착지 딩
  slotLand();      // 밝은 화음으로 이완(릴리스)
  speakVoiceEvents([{ rel: 0, ch: 'a' }], characterVoice(slotDisplay), 'happy');
  if (slotIndex >= N) { const st = $('#slot-start'); if (st) st.classList.add('ready'); }
}

function drawSlotWindow(t) {
  if (!dexStage) return;
  const c = dexStage.getContext('2d');
  c.imageSmoothingEnabled = false;
  const S = dexStage.width, CH = S;
  c.clearRect(0, 0, S, S);
  const now = performance.now();

  if (slotSpinning) {
    const p = Math.min(1, (now - slotSpinStart) / slotSpinDur);
    const e = 1 - Math.pow(1 - p, 3);                       // easeOutCubic
    slotScroll = slotScrollFrom + (slotScrollTo - slotScrollFrom) * e;
    if (p >= 1) { slotScroll = slotScrollTo; slotSpinning = false; slotDisplay = slotTarget; slotIndex++; slotLandAt = now; onSlotLanded(); }
  }

  if (slotDisplay < 0 && !slotSpinning) {                    // 시작 전 — 물음표
    c.fillStyle = '#000';
    c.font = `${Math.round(S * 0.46)}px Datatype, Galmuri11, monospace`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('?', S / 2, S / 2);
    return;
  }

  // 세로 릴 — 가운데 칸 + 위/아래 이웃이 스크롤(가운데서 멀수록 흐리게)
  const base = Math.floor(slotScroll / CH);
  const frac = slotScroll / CH - base;
  let bounce = 1;
  if (!slotSpinning && slotLandAt > 0) {
    const bp = (now - slotLandAt) / 280;
    if (bp < 1) bounce = 1 + Math.sin(bp * Math.PI) * 0.12;  // 착지 살짝 튀어오름
  }
  for (let k = -1; k <= 2; k++) {
    const idx = (((base + k) % N) + N) % N;
    const y = (k - frac) * CH;
    const dist = Math.abs(y) / S;
    if (dist > 1.05) continue;
    const alpha = Math.max(0.12, 1 - dist * 0.95);
    const sz = S * ((k === 0 && !slotSpinning) ? bounce : 1);
    c.save(); c.globalAlpha = alpha;
    silhouetteDraw(c, idx, (S - sz) / 2, y + (S - sz) / 2, sz, t, false, 'neutral', false);
    c.restore();
  }
  if (slotSpinning) {                                        // 릴 틱 사운드(가운데 칸 바뀔 때)
    const centerIdx = ((Math.round(slotScroll / CH) % N) + N) % N;
    if (centerIdx !== slotTickIdx) { slotTickIdx = centerIdx; uiClick(0.22, 0.5); }   // 룰렛 드르륵 — 크게
  }
}


// 숨겨진 입력기 (한글 IME 대응)
const hidden = document.createElement('textarea');
hidden.setAttribute('autocomplete', 'off');
hidden.setAttribute('autocorrect', 'off');
hidden.setAttribute('autocapitalize', 'off');
hidden.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;width:10px;height:10px;';
document.body.appendChild(hidden);

// ===== 화면 전환 =====
function show(name) {
  const prev = state.screen;
  state.screen = name;
  // 일부 테마(예: 그래픽 스코어)는 setup 화면이 없을 수 있다 → null 안전하게 건너뛴다
  for (const k in screens) { if (screens[k]) screens[k].classList.toggle('active', k === name); }
  // 이전 화면의 음악/사운드 정리
  if (prev !== name) {
    if (prev === 'play') { stopAmbience(); stopPlayBeat(); }
    if (prev === 'title') stopTitleMusic();
    if (prev === 'select') stopSelectTone();
    stopScreenWav();   // 이전 화면의 배경 WAV(있다면) 페이드 아웃
  }
  if (name === 'play') startPlay();
  if (SCORE && name === 'title') {   // 처음으로 — 단계 상태 정리
    asciiArt = null;
    document.body.classList.remove('ascii-time', 'gift-time');
    postPhase('idle');
  }
  if (SCORE && name === 'select') resetSlot();   // 소개 슬롯 초기화
  startScreenAudio(name);
}

// 화면별 배경 사운드 시작 (오디오가 준비된 경우에만).
// audio/<screen>.wav 가 있으면 그걸 루프 재생하고, 없으면 합성 배경음으로 폴백한다.
function startScreenAudio(name) {
  if (!audioReady) return;
  playScreenWav(name).then((played) => {
    if (played) return;                 // WAV가 깔렸으면 합성 배경 생략
    if (state.screen !== name) return;  // 그새 화면이 바뀌었으면 무시
    if (name === 'title') { startTitleMusic(); scheduleIntroAdvance(); }
    else if (name === 'select') startSelectTone();
    else if (name === 'play') startPlayBeat();   // 타자에 박자를 입히는 킥 그리드
    // 대화(play) 화면은 합성 엠비언스 없음 — 타자 킥만 그리드에 스냅된다.
  });
}

// 브라우저 자동재생 정책: 첫 사용자 제스처에서 오디오를 깨우고
// 현재 화면의 배경 사운드를 시작한다.
let audioReady = false;
let audioWokenAt = 0;
function ensureAudio() {
  if (audioReady) return;
  initAudio(); warmVoices();
  audioReady = true;
  audioWokenAt = performance.now();
  startScreenAudio(state.screen);
}
window.addEventListener('pointerdown', ensureAudio);
window.addEventListener('keydown', ensureAudio);

// 타이틀 인트로(리버스 스웰)가 끝나면 자동으로 캐릭터 선택 화면으로 넘어간다.
// 인트로 ~10초 + 마지막 "커넥션" 피크 여운까지 들려준 뒤 전환.
let titleIntroTimer = null;   // (친구의 컷신용 introTimer와 별개)
function scheduleIntroAdvance() {
  clearTimeout(titleIntroTimer);
  titleIntroTimer = setTimeout(() => {
    titleIntroTimer = null;
    if (state.screen === 'title') { updateSelectUI(); show('select'); }
  }, 10500);
}

function base(player) { return (state.picks[player] % N) / N; }

// ===== 캔버스 크기 =====
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  scene.width = Math.floor(window.innerWidth * dpr);
  scene.height = Math.floor(window.innerHeight * dpr);
  sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  sctx.imageSmoothingEnabled = false;
}
window.addEventListener('resize', resize);

// ===== 배경 별 =====
const stars = Array.from({ length: 90 }, () => ({
  x: Math.random(), y: Math.random(), s: 1 + Math.random() * 2, p: Math.random() * 6.28,
}));

function drawBackground(t, W, H) {
  const grad = sctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#0d0b1a');
  grad.addColorStop(1, '#1a1238');
  sctx.fillStyle = grad;
  sctx.fillRect(0, 0, W, H);
  for (const st of stars) {
    const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * 1.5 + st.p));
    sctx.fillStyle = `rgba(255,240,200,${tw * 0.7})`;
    sctx.fillRect(st.x * W, st.y * H, st.s, st.s);
  }
}

// 미니멀(비트맵) 배경 — 단색만. 고대비 CSS 필터로 1비트처럼 보이게 됨.
// 스코어 테마에선 배경을 아예 비워(투명) 페이지 흰색이 그대로 비치게 한다.
function drawMinimalBg(W, H) {
  if (SCORE) { sctx.clearRect(0, 0, W, H); return; }
  sctx.fillStyle = '#040804';
  sctx.fillRect(0, 0, W, H);
}

// ===== 메인 루프 =====
function loop(now) {
  const t = now / 1000;
  const W = window.innerWidth, H = window.innerHeight;

  if (state.screen === 'play') {
    if (SCORE) tickCycle();           // 예비박/라운드 진행·전환 + 게이지 갱신
    const progress = fillProgress();
    if (SCORE) drawMinimalBg(W, H);   // 스코어 테마: 배경·캐릭터 없이 텅 빈 흰 화면
    if (SCORE && state.phase === 'ascii') drawAsciiArt(t);   // 글자들이 날아가 부호 그림을 그린다
    else if (SCORE) drawDuetHeads(t);                        // 듀엣 — 말하는 캐릭터가 입력칸 옆에
    else if (MINIMAL) drawMinimalPairBackground(sctx, W, H, t, state.picks[0], state.picks[1], progress);
    else drawPairBackground(sctx, W, H, t, state.picks[0], state.picks[1], moodRapport(state.lastMood), progress);
    if (!SCORE) drawDuo(t, W, H, true);
  } else if (state.screen === 'setup') {
    if (SCORE) drawMinimalBg(W, H);
    else if (MINIMAL) drawMinimalPairBackground(sctx, W, H, t, state.picks[0], state.picks[1], 0.3);
    else drawPairBackground(sctx, W, H, t, state.picks[0], state.picks[1], 0.5, 0.2);
    drawDuo(t, W, H, false);
  } else if (state.screen === 'select') {
    if (MINIMAL || SCORE) drawMinimalBg(W, H); else drawBackground(t, W, H);
    if (SCORE) {
      // 슬롯머신 창 — 릴 회전/착지 애니메이션
      drawSlotWindow(t);
    } else {
      drawDuo(t, W, H, false);
      pickCanvases.forEach((cv, p) => {
        const c = cv.getContext('2d');
        c.imageSmoothingEnabled = false;
        c.clearRect(0, 0, cv.width, cv.height);
        drawCharacter(c, state.picks[p], 0, Math.sin(t * 2 + p) * 4, cv.width, t + p * 3);
      });
    }
  } else if (state.screen === 'ending') {
    // 1단계: 순차 듀엣 악보 / 2단계: 오케스트라 총보. 맨 밑엔 캐릭터들이 춤춘다.
    if (SCORE) drawScore3D(sctx, W, H, t, scoreProgress());   // 스코어 테마: 3D 그래픽 스코어
    else if (endingPhase === 2 && orchestraScore) drawOrchestraScore(sctx, W, H, t, scoreProgress());
    else drawFullScore(sctx, W, H, t, scoreProgress());
  } else {
    // title
    if (MINIMAL || SCORE) drawMinimalBg(W, H); else drawBackground(t, W, H);
    // 스코어 테마: 타이틀 캐릭터 줄 없이 텅 빈 흰 화면
    if (!SCORE) {
      const size = Math.min(110, W / (N + 2));
      const gap = W / (N + 1);
      for (let i = 0; i < N; i++) {
        const bob = Math.sin(t * 2 + i) * 8;
        paintChar(i, gap * (i + 1) - size / 2, H - size - 40 + bob, size, t + i, false, 'neutral', false);
      }
    }
  }

  requestAnimationFrame(loop);
}

// 캐릭터 그리기(좌우 반전 옵션). 미니멀 모드에선 따로 실루엣화하지 않고
// 원래대로 그린다 — CRT 녹색 고대비 필터(#scene)가 자동으로 2톤(밝은 몸 +
// 어두운 눈·입)으로 납작하게 만들어 1비트 비트맵 느낌을 내면서도 표정은 남는다.
// ── 검정 통짜 실루엣 ─────────────────────────────────────────────
// 스코어 테마에선 캐릭터를 라인이 아니라 "검정으로 통째로" 칠한 실루엣으로 본다.
// 캐릭터를 오프스크린에 그린 뒤, 테두리에서 플러드필로 '바깥'을 찾고(투명),
// 나머지(윤곽선 + 안쪽 빈 곳)를 전부 불투명 검정으로 채운다. 다리 사이처럼 바깥과
// 이어진 오목한 틈은 그대로 흰 채로 남아 실루엣다운 형태가 유지된다.
let silCanvas = null, silCtx = null;
// '#rrggbb' → [r,g,b]
function hexRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return [0, 0, 0];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function silhouetteFill(ctx, w, h, rgb = [0, 0, 0]) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const n = w * h;
  const outside = new Uint8Array(n);
  const stack = [];
  const A = 24;   // 이 알파 이하는 '빈 곳'으로 본다
  const push = (i) => { if (!outside[i] && d[i * 4 + 3] <= A) { outside[i] = 1; stack.push(i); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (stack.length) {
    const i = stack.pop();
    const x = i % w, y = (i - x) / w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (outside[i]) { d[o + 3] = 0; }
    else { d[o] = rgb[0]; d[o + 1] = rgb[1]; d[o + 2] = rgb[2]; d[o + 3] = 255; }
  }
  ctx.putImageData(img, 0, 0);
}
// dst 컨텍스트에 (x,y) 위치·size로 캐릭터를 통짜 실루엣으로 그린다.
// 기본은 검정(작품 전체가 흑백) — 소개 컷신에서만 color로 캐릭터 색을 넘긴다.
// (토마토=핑크·심해어=남색·새=귤색·생쥐=연보라)
function silhouetteDraw(dst, idx, x, y, size, t, talking, mood, flip, color) {
  const pad = Math.ceil(size * 0.35);
  const dim = Math.ceil(size + pad * 2);
  if (!silCanvas) { silCanvas = document.createElement('canvas'); silCtx = silCanvas.getContext('2d'); }
  if (silCanvas.width !== dim || silCanvas.height !== dim) { silCanvas.width = dim; silCanvas.height = dim; }
  silCtx.imageSmoothingEnabled = false;
  silCtx.clearRect(0, 0, dim, dim);
  silCtx.save();
  if (flip) { silCtx.translate(dim, 0); silCtx.scale(-1, 1); }
  drawCharacter(silCtx, idx, pad, pad, size, t, talking, mood);
  silCtx.restore();
  silhouetteFill(silCtx, dim, dim, hexRgb(color || '#000000'));
  dst.drawImage(silCanvas, x - pad, y - pad);
}

function paintChar(idx, x, y, size, t, talking, mood, flip) {
  if (SCORE) { silhouetteDraw(sctx, idx, x, y, size, t, talking, mood, flip); return; }
  if (flip) {
    sctx.save(); sctx.translate(x + size, 0); sctx.scale(-1, 1);
    drawCharacter(sctx, idx, 0, y, size, t, talking, mood); sctx.restore();
  } else {
    drawCharacter(sctx, idx, x, y, size, t, talking, mood);
  }
}

// 머리 위 반응 이모트 — 크고 도드라지게(말풍선 배경 + 통통 튀는 팝)
function drawReaction(cx, topY, glyph, color, t, emphasized, scale = 1) {
  const pop = (emphasized ? 1.35 + Math.sin(t * 16) * 0.18 : 1) * scale;
  const fs = Math.round(40 * pop);
  const yy = topY + Math.sin(t * 2.5) * 5;
  sctx.save();
  sctx.font = `${fs}px Datatype, Galmuri11, monospace`;
  sctx.textAlign = 'center';
  sctx.textBaseline = 'middle';
  // 작은 말풍선 배경(원)으로 기호를 더 강조
  sctx.beginPath();
  sctx.arc(cx, yy, fs * 0.72, 0, Math.PI * 2);
  sctx.fillStyle = SCORE ? 'rgba(0,0,0,0.06)' : 'rgba(0,0,0,0.32)';
  sctx.fill();
  // 외곽선 + 채움 — 스코어 테마는 검정 잉크
  sctx.lineWidth = 3; sctx.strokeStyle = SCORE ? '#000' : color;
  sctx.strokeText(glyph, cx, yy);
  sctx.fillStyle = SCORE ? '#000' : '#fff';
  sctx.fillText(glyph, cx, yy);
  sctx.restore();
}

// 두 캐릭터를 마주 보게 배치 (플레이 중엔 하단 중앙에 모아 강조)
function drawDuo(t, W, H, playing) {
  const size = playing ? Math.min(170, W * 0.2) : Math.min(220, W * 0.26);
  const y = playing ? H * 0.6 : H * 0.5 - size / 2;
  const now = performance.now();
  const showMood = playing || state.screen === 'ending';
  const mood = showMood ? moodFace(state.lastMood) : 'neutral';
  const glyph = moodGlyph(state.lastMood);
  const gap = playing ? 24 : 30;

  // 왼쪽(P1) — 말할 때 더 크게 들썩이며 표정 강조
  const talk0 = playing && now < state.talkUntil[0];
  const bob0 = Math.sin(t * 2) * 6 + (talk0 ? Math.sin(t * 18) * 6 : 0);
  const x0 = W * 0.5 - size - gap;
  paintChar(state.picks[0], x0, y + bob0, size, t, talk0, mood, false);
  // 오른쪽(P2) — 좌우 반전해서 마주 보게
  const talk1 = playing && now < state.talkUntil[1];
  const bob1 = Math.sin(t * 2 + 1) * 6 + (talk1 ? Math.sin(t * 18) * 6 : 0);
  const x1 = W * 0.5 + gap;
  paintChar(state.picks[1], x1, y + bob1, size, t + 2, talk1, mood, true);

  if (showMood) {
    const rs = playing ? 1.15 : 1;  // 플레이 중엔 기호를 더 크게
    drawReaction(x0 + size / 2, y - size * 0.12, glyph, characterColor(state.picks[0]), t, now < state.reactUntil[0], rs);
    drawReaction(x1 + size / 2, y - size * 0.12, glyph, characterColor(state.picks[1]), t + 1, now < state.reactUntil[1], rs);
  }
}

// ===== 선택 화면 =====
function updateSelectUI() {
  state.picks.forEach((idx, p) => {
    if (!pickNames[p]) return;   // 스코어 도감엔 이름표가 없다
    pickNames[p].textContent = characterName(idx);
    pickNames[p].style.color = characterColor(idx);
  });
  highlightPicks();   // 플레이 중 사이드 선택 열의 활성 표시 갱신
}
function cyclePick(player, dir) {
  state.picks[player] = (state.picks[player] + dir + N) % N;
  updateSelectUI();
}
// 게임 중 직접 선택해서 캐릭터 교체 (사이드 열의 썸네일 클릭)
function setPick(player, idx) {
  state.picks[player] = ((idx % N) + N) % N;
  updateSelectUI();
}

// ===== 플레이 중 좌/우 캐릭터 선택 열 =====
// 양옆에 캐릭터 썸네일을 세로로 깔고, 클릭하면 그 플레이어의 캐릭터가 바뀐다.
const pickCols = [$('#pick-col-0'), $('#pick-col-1')];
const pickThumbs = [[], []]; // [player][idx] = canvas
function buildPickColumns() {
  pickCols.forEach((col, player) => {
    if (!col) return;
    col.innerHTML = '';
    pickThumbs[player] = [];
    // 스코어: 왼쪽 한 열(0번)만 쓴다 — 사용자 1/2 구분 없이 8개 중에서 고른다.
    if (SCORE && player === 1) return;
    for (let i = 0; i < N; i++) {
      const b = document.createElement('button');
      b.className = 'pick-thumb';
      // 스코어: 'turn' → 지금 차례인 사람의 캐릭터를 바꾼다. 그 외: 고정 플레이어.
      b.dataset.pickSet = SCORE ? 'turn' : player;
      b.dataset.idx = i;              // 어떤 캐릭터인지
      b.title = characterName(i);
      const cv = document.createElement('canvas');
      cv.width = 64; cv.height = 64;
      const c = cv.getContext('2d');
      c.imageSmoothingEnabled = false;
      if (SCORE) silhouetteDraw(c, i, 0, 0, 64, i * 1.3, false, 'neutral', false);
      else drawCharacter(c, i, 0, 0, 64, i * 1.3);
      b.appendChild(cv);
      pickThumbs[player].push(b);
      if (SCORE) {
        // 캐릭터 옆에 "자기 선물" — 다른 캐릭터에게 끌어다 주면 그 캐릭터에 리버브.
        const row = document.createElement('div');
        row.className = 'pick-row';
        const gift = document.createElement('div');
        gift.className = 'char-gift';
        gift.draggable = true;
        gift.dataset.giver = i;
        gift.title = characterName(i) + '의 선물 — 다른 캐릭터에게 끌어다 놓기';
        const gcv = document.createElement('canvas');
        gcv.width = 48; gcv.height = 48;
        drawGiftIcon(gcv);
        gift.appendChild(gcv);
        row.appendChild(b);
        row.appendChild(gift);
        col.appendChild(row);
      } else {
        col.appendChild(b);
      }
    }
  });
  highlightPicks();
  if (SCORE) highlightGifts();
}
function highlightPicks() {
  if (SCORE) {
    // 단일 왼쪽 열 — 지금 차례인 사람의 캐릭터를 강조한다.
    const active = state.picks[state.turn];
    pickThumbs[0].forEach((b, i) => b.classList.toggle('active', i === active));
    return;
  }
  pickThumbs.forEach((thumbs, player) => {
    thumbs.forEach((b, i) => b.classList.toggle('active', state.picks[player] === i));
  });
}
function randomMatch() {
  state.picks[0] = Math.floor(Math.random() * N);
  do { state.picks[1] = Math.floor(Math.random() * N); } while (state.picks[1] === state.picks[0] && N > 1);
  updateSelectUI();
}

// ===== 선물(드래그&드롭 → 그 캐릭터 소리에 리버브) =====
const giftedChars = new Set();   // 선물 받은 캐릭터 인덱스

// 선물 상자 아이콘을 캔버스에 그린다(검정 실루엣 + 흰 리본 — 스코어 테마 톤).
function drawGiftIcon(cv) {
  // 외곽선 스타일 — 작은 크기에서도 '선물 상자'로 읽히게(까만 덩어리 방지).
  const g = cv.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, cv.width, cv.height);
  const s = cv.width / 32;
  const INK = '#000';
  g.strokeStyle = INK; g.lineWidth = Math.max(2, 2.4 * s); g.lineJoin = 'round';
  g.fillStyle = '#fff';
  // 몸통 + 뚜껑(흰 속, 검정 테)
  g.fillRect(7 * s, 14 * s, 18 * s, 13 * s); g.strokeRect(7 * s, 14 * s, 18 * s, 13 * s);
  g.fillRect(5 * s, 9 * s, 22 * s, 5 * s); g.strokeRect(5 * s, 9 * s, 22 * s, 5 * s);
  // 세로 리본
  g.beginPath(); g.moveTo(16 * s, 9 * s); g.lineTo(16 * s, 27 * s); g.stroke();
  // 나비 리본(두 고리)
  g.beginPath(); g.ellipse(12 * s, 6.4 * s, 3.4 * s, 2.4 * s, -0.3, 0, 7); g.stroke();
  g.beginPath(); g.ellipse(20 * s, 6.4 * s, 3.4 * s, 2.4 * s, 0.3, 0, 7); g.stroke();
}

// 방향별 선물 — GIFTS[주는이][받는이] = { name, kind }. (인덱스: 0토마토 1심해어 2새 3쥐)
const GIFTS = {
  0: { 1: { name: '모자', kind: 'hat' },        2: { name: '둥지', kind: 'nest' },   3: { name: '액자', kind: 'frame' } },
  1: { 0: { name: '잠수안경', kind: 'goggles' }, 2: { name: '물방울', kind: 'drop' }, 3: { name: '돌미역', kind: 'seaweed' } },
  2: { 0: { name: '무지개', kind: 'rainbow' },   1: { name: '구름', kind: 'cloud' },  3: { name: '치즈', kind: 'cheese' } },
  3: { 0: { name: '용과', kind: 'dragonfruit' }, 1: { name: '바질', kind: 'basil' },  2: { name: '반지', kind: 'ring' } },
};
function giftFor(giver, recipient) {
  return (GIFTS[giver] && GIFTS[giver][recipient]) || null;
}

// 선물 품목 아이콘(검정 잉크, 32그리드) — 위 GIFTS의 kind별로 그린다.
function drawItem(cv, kind) {
  const g = cv.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, cv.width, cv.height);
  const u = cv.width / 32; const PI = Math.PI;
  g.strokeStyle = '#000'; g.lineJoin = 'round'; g.lineCap = 'round';
  const px = (x, y, w, h, c) => { g.fillStyle = c || '#000'; g.fillRect(Math.round(x * u), Math.round(y * u), Math.round(w * u), Math.round(h * u)); };
  const disc = (x, y, r, c) => { g.fillStyle = c || '#000'; g.beginPath(); g.arc(x * u, y * u, r * u, 0, 7); g.fill(); };
  const ell = (x, y, rx, ry, c) => { g.fillStyle = c || '#000'; g.beginPath(); g.ellipse(x * u, y * u, rx * u, ry * u, 0, 0, 7); g.fill(); };
  const ring = (x, y, r, lw) => { g.save(); g.lineWidth = lw * u; g.beginPath(); g.arc(x * u, y * u, r * u, 0, 7); g.stroke(); g.restore(); };
  const line = (x1, y1, x2, y2, lw) => { g.save(); g.lineWidth = (lw || 1.6) * u; g.beginPath(); g.moveTo(x1 * u, y1 * u); g.lineTo(x2 * u, y2 * u); g.stroke(); g.restore(); };
  const poly = (pts, c) => { g.fillStyle = c || '#000'; g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0] * u, p[1] * u) : g.moveTo(p[0] * u, p[1] * u)); g.closePath(); g.fill(); };
  const arc = (x, y, r, a0, a1, lw) => { g.save(); g.lineWidth = (lw || 1.6) * u; g.beginPath(); g.arc(x * u, y * u, r * u, a0, a1); g.stroke(); g.restore(); };
  switch (kind) {
    case 'dragonfruit':
      ell(16, 18, 7, 9, '#000');
      [[14, 16], [18, 15], [16, 20], [13, 22], [19, 22]].forEach(([x, y]) => disc(x, y, 0.7, '#fff'));
      poly([[16, 9], [12, 2], [19, 7]], '#000'); poly([[21, 11], [27, 5], [22, 14]], '#000'); poly([[11, 11], [5, 6], [11, 14]], '#000');
      break;
    case 'frame':
      px(6, 8, 20, 17, '#000'); px(8, 10, 16, 13, '#fff');
      disc(13, 15, 1.1, '#000'); disc(19, 15, 1.1, '#000'); px(13, 19, 6, 1.4, '#000');
      break;
    case 'ring':
      ring(16, 21, 6, 2);
      poly([[16, 3], [21, 11], [16, 17], [11, 11]], '#000');
      break;
    case 'cheese':
      poly([[5, 22], [27, 22], [27, 9]], '#000');
      disc(20, 18, 1.5, '#fff'); disc(23, 14, 1.2, '#fff'); disc(16, 19, 1.2, '#fff');
      break;
    case 'cloud':
      disc(11, 19, 4.5, '#000'); disc(21, 19, 5, '#000'); disc(16, 15, 6, '#000'); px(8, 18, 17, 5, '#000');
      break;
    case 'drop':
      disc(16, 21, 6, '#000'); poly([[10.2, 20], [21.8, 20], [16, 5]], '#000');
      break;
    case 'goggles':
      ring(11, 17, 4, 2); ring(21, 17, 4, 2); line(15, 17, 17, 17, 2);
      line(7, 16, 3, 13, 1.6); line(25, 16, 29, 13, 1.6);
      break;
    case 'hat':
      ell(16, 18, 7, 6, '#000'); px(5, 21, 22, 2, '#000');
      [[16, 5], [12, 8], [20, 8], [13, 12], [19, 12]].forEach(([x, y]) => line(16, 12, x, y, 1.6));
      break;
    case 'seaweed':
      [10, 16, 22].forEach((x, k) => { g.save(); g.lineWidth = 1.8 * u; g.beginPath(); for (let y = 6; y <= 27; y++) { const xx = (x + Math.sin((y / 3) + k) * 2.2) * u; if (y === 6) g.moveTo(xx, y * u); else g.lineTo(xx, y * u); } g.stroke(); g.restore(); });
      break;
    case 'basil':
      line(16, 28, 16, 13, 1.8);
      ell(11, 11, 4, 6, '#000'); ell(21, 11, 4, 6, '#000');
      break;
    case 'nest':
      g.fillStyle = '#000'; g.beginPath(); g.ellipse(16 * u, 18 * u, 10 * u, 7 * u, 0, 0, PI); g.closePath(); g.fill();
      g.strokeStyle = '#fff'; line(9, 20, 23, 20, 1.2); line(11, 23, 21, 23, 1.2); g.strokeStyle = '#000';
      disc(12, 17, 1.7, '#000'); disc(16, 16, 1.9, '#000'); disc(20, 17, 1.7, '#000');
      break;
    case 'rainbow':
      arc(16, 24, 11, PI, 2 * PI, 2); arc(16, 24, 8, PI, 2 * PI, 2); arc(16, 24, 5, PI, 2 * PI, 2);
      break;
    default: drawGiftIcon(cv);
  }
}

let giftDragFrom = null;   // 지금 드래그 중인 선물을 "준" 캐릭터 인덱스

// 캐릭터 열에 드래그&드롭을 위임으로 건다(썸네일/선물은 buildPickColumns에서 매번 생성).
function setupGift() {
  const col = pickCols[0];
  if (!col) return;
  // 선물(.char-gift) 집어 들기 — 어느 캐릭터가 주는지 기록.
  col.addEventListener('dragstart', (e) => {
    const g = e.target.closest('.char-gift');
    if (!g) return;
    giftDragFrom = +g.dataset.giver;
    e.dataTransfer.setData('text/plain', String(giftDragFrom));
    e.dataTransfer.effectAllowed = 'copy';
    g.classList.add('dragging');
  });
  col.addEventListener('dragend', (e) => {
    const g = e.target.closest('.char-gift');
    if (g) g.classList.remove('dragging');
    giftDragFrom = null;
    col.querySelectorAll('.pick-thumb.drag-over').forEach((x) => x.classList.remove('drag-over'));
  });
  // 다른 캐릭터(.pick-thumb) 위에 놓으면 그 캐릭터가 선물을 받는다(자기 자신은 제외).
  col.addEventListener('dragover', (e) => {
    const b = e.target.closest('.pick-thumb');
    if (!b) return;
    if (giftDragFrom != null && +b.dataset.idx === giftDragFrom) return;   // 자기 자신에겐 못 줌
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!b.classList.contains('drag-over')) {
      col.querySelectorAll('.pick-thumb.drag-over').forEach((x) => x.classList.remove('drag-over'));
      b.classList.add('drag-over');
    }
  });
  col.addEventListener('dragleave', (e) => {
    const b = e.target.closest('.pick-thumb');
    if (b) b.classList.remove('drag-over');
  });
  col.addEventListener('drop', (e) => {
    const b = e.target.closest('.pick-thumb');
    if (!b) return;
    e.preventDefault();
    b.classList.remove('drag-over');
    const recip = +b.dataset.idx;
    let giver = giftDragFrom;
    if (giver == null) { const d = e.dataTransfer.getData('text/plain'); giver = (d === '') ? null : +d; }
    if (giver != null && recip === giver) return;   // 자기 자신 무시
    giveSpecificGift(recip, giver);
  });
}

const received = new Map();   // 받는이 idx -> [{ kind, name, from }]

// 준 캐릭터(giver)가 받는 캐릭터(recip)에게 정해진 선물을 준다 → 받는 캐릭터에 리버브.
function giveSpecificGift(recip, giver) {
  if (giver == null) return;
  const item = giftFor(giver, recip);
  if (!item) return;
  const list = received.get(recip) || [];
  list.push({ ...item, from: giver });
  received.set(recip, list);
  giftedChars.add(recip);
  setGift(characterVoice(recip), true);   // 효과: 일단 리버브 ON
  highlightGifts();
  updateGiftBadge(recip);
  showGiftPopup(recip, giver, item);
  uiClick(0.7);
  // 받은 즉시 그 목소리로 짧게 울려 리버브를 들려준다.
  speakVoiceEvents([{ rel: 0, ch: 'a' }, { rel: 0.16, ch: 'o' }], characterVoice(recip), 'happy');
}

function highlightGifts() {
  pickThumbs[0].forEach((b, i) => b.classList.toggle('gifted', giftedChars.has(i)));
}

// 받은 캐릭터 썸네일 아래 — 받은 선물 "전부"를 아이콘 줄로 나열한다.
function updateGiftBadge(recip) {
  const b = pickThumbs[0][recip]; if (!b) return;
  let row = b.querySelector('.gift-badges');
  if (!row) { row = document.createElement('div'); row.className = 'gift-badges'; b.appendChild(row); }
  row.innerHTML = '';
  const list = received.get(recip) || [];
  list.forEach((it) => {
    const cv = document.createElement('canvas');
    cv.width = 32; cv.height = 32;
    cv.title = it.name;
    drawItem(cv, it.kind);
    row.appendChild(cv);
  });
  b.title = characterName(recip) + ' — 받은 선물: ' + list.map((x) => x.name).join(', ');
}

// 받침 유무로 목적격 조사(을/를) 선택. 한글이 아니면 기본 '를'.
function objParticle(word) {
  const c = word.charCodeAt(word.length - 1);
  if (c < 0xAC00 || c > 0xD7A3) return '를';
  return ((c - 0xAC00) % 28) !== 0 ? '을' : '를';
}

// 선물을 받는 순간 "○○ 님이 ○○ 님에게 △△ 선물했습니다" 카드를 받는 캐릭터 옆에 잠깐 띄운다.
function showGiftPopup(recip, giver, item) {
  const b = pickThumbs[0][recip]; if (!b) return;
  // 같은 캐릭터의 이전 팝업은 치워 겹치지 않게.
  document.querySelectorAll(`.gift-popup[data-recip="${recip}"]`).forEach((el) => el.remove());
  const r = b.getBoundingClientRect();
  const pop = document.createElement('div');
  pop.className = 'gift-popup';
  pop.dataset.recip = recip;
  const cv = document.createElement('canvas'); cv.width = 48; cv.height = 48; drawItem(cv, item.kind);
  pop.appendChild(cv);
  const label = document.createElement('div');
  label.className = 'gift-popup-label';
  label.textContent = `${characterName(giver)} 님이 ${characterName(recip)} 님에게 ${item.name}${objParticle(item.name)} 선물했습니다`;
  pop.appendChild(label);
  document.body.appendChild(pop);
  pop.style.left = `${r.right + 12}px`;
  pop.style.top = `${r.top + r.height / 2}px`;
  requestAnimationFrame(() => pop.classList.add('show'));
  setTimeout(() => { pop.classList.remove('show'); setTimeout(() => pop.remove(), 400); }, 1600);
}

function resetGifts() {
  giftedChars.clear();
  received.clear();
  clearGifts();
  document.querySelectorAll('.gift-badge, .gift-badges, .gift-popup').forEach((el) => el.remove());
  if (pickThumbs[0]) highlightGifts();
}

// ===== 뉘앙스 라운드 사이클 (타이핑 + 실시간 투표 동시) =====
// 플레이가 시작되면 라운드가 32→16→8→4초로 순환하며 계속 반복된다. 각 라운드
// 앞엔 4초 예비박(카운트인 4·3·2·1). 라운드 동안 퍼포머가 타이핑(악보 채움)하고,
// 퍼포머·관객(폰)이 6개 부호(. ? ! … ~ ;)에 투표한다. 누를 때마다 인스타 라이브
// 하트처럼 아이콘이 떠오르고, 가장 많이 눌린 부호가 사운드 이펙트를 실시간 결정.
// 퍼포머가 ■(round-stop)로 마치면 그 순간 말투를 고정하고 선물 단계로 넘어간다.
const BEATS_PER_ROUND = 8;       // 라운드당 8박
const COUNTIN_BEATS = 4;         // 예비박 4박(4·3·2·1)
const BPM_START = 80;            // 시작 템포(느리게 시작 → 라운드마다 가속)
const BPM_ACCEL = 1.18;          // 라운드마다 ×1.18로 가속 → 갈수록 빨라짐
const BPM_MAX = 220;             // 템포 상한
const NUANCES = ['period', 'question', 'bang', 'ellipsis', 'tilde', 'semicolon'];
const MARK_GLYPH = { period: '.', question: '?', bang: '!', ellipsis: '…', tilde: '~', semicolon: ';' };
let cycleOn = false;          // 라운드 사이클 진행 중
let roundIndex = 0;          // 몇 번째 라운드인지(가속 계산·표시용)
let bpm = BPM_START;         // 현재 템포 — 라운드마다 빨라진다
let phaseEndsAt = 0;         // 현재 phase(countin/round) 종료 시각
let beatsLeft = 0;           // 현재 phase에 남은 박
let nextBeatAt = 0;          // 다음 박을 칠 시각(performance.now ms)
let nuanceVotes = {};
let liveLeader = null;
let winningNuance = null;

function resetVotes() {
  nuanceVotes = {};
  for (const k of NUANCES) nuanceVotes[k] = 0;
  liveLeader = null;
  winningNuance = null;
}

// 관객 폰에 현재 단계 알림 — 폰 화면(투표 패드 ↔ 선물 화면)이 이걸 보고 전환된다.
function postPhase(phase) {
  try { fetch('/phase', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phase }) }).catch(() => {}); } catch (e) { /* 정적 서버 — 무시 */ }
}

// 사이클 시작 — startPlay에서 호출. 첫 라운드(32초) 예비박부터.
function startCycle() {
  cycleOn = true;
  roundIndex = 0;
  bpm = BPM_START;             // 템포 초기화(라운드마다 가속)
  resetVotes();
  resetNuanceEffect();
  document.body.classList.remove('gift-time');   // 라운드 동안 선물 숨김
  postPhase('round');
  const layer = $('#heart-layer'); if (layer) layer.innerHTML = '';
  $('#gift-bar')?.classList.add('hidden');
  $('#mark-bar')?.classList.remove('hidden');   // 투표 패드는 예비박부터 보임
  $('#round-stop')?.classList.remove('hidden');
  $('#input-bar')?.classList.remove('hidden');
  renderMarkQR();         // 관객 폰 참여 QR
  updateTally();
  beginCountIn();
}

// 현재 템포의 한 박 길이(ms).
function beatMs() { return 60000 / bpm; }

// 예비박(4박 카운트인) — 타이핑은 잠그되 투표는 계속 받는다.
function beginCountIn() {
  state.phase = 'countin';
  beatsLeft = COUNTIN_BEATS;
  nextBeatAt = performance.now();                     // 첫 박 즉시
  phaseEndsAt = performance.now() + COUNTIN_BEATS * beatMs();
  if (hidden) hidden.blur();
  $('#round-gauge')?.classList.add('hidden');
  const lbl = $('#countin-label'); if (lbl) lbl.textContent = `${Math.round(bpm)} BPM · ready`;
  $('#countin')?.classList.remove('hidden');
}

// 라운드 본 구간 — 타이핑 + 투표. 4박이며 템포는 라운드마다 빨라진다.
function beginRound() {
  state.phase = 'round';
  beatsLeft = BEATS_PER_ROUND;
  nextBeatAt = performance.now();                     // 라운드 첫 박 즉시
  phaseEndsAt = performance.now() + BEATS_PER_ROUND * beatMs();
  $('#countin')?.classList.add('hidden');
  $('#round-gauge')?.classList.remove('hidden');
  const dl = $('#round-dur'); if (dl) dl.textContent = `${Math.round(bpm)}BPM`;
  const dots = $('#beat-dots');   // 박 수만큼 빈 동그라미로 리셋
  if (dots) dots.innerHTML = Array.from({ length: BEATS_PER_ROUND }, () => '<span class="beat-dot"></span>').join('');
  setTimeout(() => hidden.focus(), 40);
}

// 매 프레임(loop)에서 호출 — 메트로놈 박(가속) + 예비박/라운드 전환 처리.
function tickCycle() {
  if (!cycleOn) return;
  const now = performance.now();
  const bMs = beatMs();
  const countin = state.phase === 'countin';
  // 메트로놈 — 박마다 트랩 비트. 라운드가 갈수록 고조(heat 0→1).
  const heat = Math.min(1, roundIndex / 5);
  while (beatsLeft > 0 && now >= nextBeatAt) {
    if (countin) {
      const numEl = $('#countin-num');
      if (numEl) {
        numEl.textContent = String(beatsLeft);
        numEl.classList.remove('tick'); void numEl.offsetWidth; numEl.classList.add('tick');
      }
      countTick(beatsLeft, roundIndex);                        // 4·3·2·1 — 라운드마다 업그레이드
      beatKick(beatsLeft === 1, bMs / 1000, false, heat);      // 예비박 킥(마지막 '1' 더 세게)
    } else {
      const strong = beatsLeft === BEATS_PER_ROUND;            // 라운드 첫 박 강조
      const snare = beatsLeft % 2 === 1;                       // 2·4박에 백비트 클랩
      beatKick(strong, bMs / 1000, snare, heat);
      // 비트 동그라미 — 이번 박을 검게 채우고 톡 튀게
      const dots = $$('#beat-dots .beat-dot');
      const idx = BEATS_PER_ROUND - beatsLeft;
      if (dots[idx]) { dots[idx].classList.add('on', 'now'); setTimeout(() => dots[idx]?.classList.remove('now'), 320); }
    }
    beatsLeft--;
    nextBeatAt += bMs;
  }
  const remain = Math.max(0, phaseEndsAt - now);
  if (remain <= 0) {
    if (countin) { beginRound(); }
    else {
      commitPendingInput();              // 박 끝 = 자동 엔터(치던 입력 전송)
      if (!cycleOn) return;              // 그 입력으로 그리드가 꽉 차 선물 단계로 갔으면 멈춤
      roundIndex++;
      bpm = Math.min(BPM_MAX, bpm * BPM_ACCEL);   // 다음 라운드 가속
      beginCountIn();
    }
  }
}

// 부호 한 표 — 퍼포머(버튼) / 관객(폰 SSE) 공통 진입점. 예비박·라운드 둘 다 투표 가능.
function castVote(kind, who = 'perf') {
  if (!cycleOn || (state.phase !== 'round' && state.phase !== 'countin') || !MARK_GLYPH[kind]) return;
  nuanceVotes[kind] = (nuanceVotes[kind] || 0) + 1;
  spawnHeart(kind, who);
  flashMarkKey(kind);
  // 부호 누르는 소리는 내지 않는다 — 대신 타이핑 목소리의 억양이 확 바뀐다.
  updateTally();
  // 실시간 리더가 바뀌면 그 말투를 즉시(짧은 스무딩) 타이핑 목소리에 입힌다.
  const lead = computeLeader();
  if (lead && lead !== liveLeader) { liveLeader = lead; applyNuanceEffect(lead, 0.06); }
}

// 인스타 라이브 하트처럼 — 누른 부호 아이콘이 아래에서 위로 떠오르며 사라진다.
function spawnHeart(kind, who) {
  const layer = $('#heart-layer'); if (!layer) return;
  const el = document.createElement('span');
  el.className = `heart${who === 'aud' ? ' aud' : ''}`;
  el.textContent = MARK_GLYPH[kind];
  el.style.left = `${6 + Math.random() * 22}%`;        // 왼쪽 아래에서 출발(IG 라이브 느낌)
  el.style.fontSize = `${22 + Math.random() * 22}px`;
  el.style.setProperty('--dx', `${(Math.random() * 2 - 1) * 60}px`);
  el.style.setProperty('--rot', `${(Math.random() * 2 - 1) * 24}deg`);
  el.addEventListener('animationend', () => el.remove());
  layer.appendChild(el);
  while (layer.children.length > 120) layer.removeChild(layer.firstChild);
}

function flashMarkKey(kind) {
  const b = document.querySelector(`.mark-key[data-mark="${kind}"]`);
  if (!b) return;
  b.classList.add('hit');
  setTimeout(() => b.classList.remove('hit'), 110);
}

// 현재까지 최다 득표 부호(동률이면 NUANCES 우선순위).
function computeLeader() {
  let best = null, bestN = 0;
  for (const k of NUANCES) { if ((nuanceVotes[k] || 0) > bestN) { bestN = nuanceVotes[k]; best = k; } }
  return best;
}

// 버튼별 실시간 카운트 + 리더 강조.
function updateTally() {
  const lead = computeLeader();
  for (const k of NUANCES) {
    const b = document.querySelector(`.mark-key[data-mark="${k}"]`);
    if (!b) continue;
    const ct = b.querySelector('.mk-ct'); if (ct) ct.textContent = String(nuanceVotes[k] || 0);
    b.classList.toggle('lead', k === lead);
  }
}

// 퍼포머가 ■로 사이클을 마침 — 타이핑 잠그고, 그 순간 말투(승자) 고정, 선물 단계로.
function endCycle() {
  if (!cycleOn) return;
  cycleOn = false;          // 먼저 잠가 재진입 방지(commit→scoreFull→endCycle 루프 차단)
  commitPendingInput();     // 마치는 순간 치던 입력도 자동 전송
  state.phase = 'gift';
  if (hidden) hidden.blur();
  winningNuance = computeLeader();
  applyNuanceEffect(winningNuance || 'neutral', 0.4);   // 승자 말투를 엔딩까지 고정
  $('#round-gauge')?.classList.add('hidden');
  $('#countin')?.classList.add('hidden');
  $('#round-stop')?.classList.add('hidden');
  $('#mark-bar')?.classList.add('hidden');
  const hl = $('#heart-layer'); if (hl) hl.innerHTML = '';   // 기호(하트)도 모두 제거
  // 선물 단계 — 이제야 선물이 보인다(라운드 동안 숨김). 폰도 선물 화면으로.
  document.body.classList.add('gift-time');
  postPhase('gift');
  const gb = $('#gift-bar');
  if (gb) {
    const hint = $('#gift-hint');
    if (hint) hint.textContent = winningNuance
      ? `'${MARK_GLYPH[winningNuance]}' 의 말투로 — 이제 선물을 주고받으세요`
      : '이제 선물을 주고받으세요';
    gb.classList.remove('hidden');
  }
  uiClick(0.5);
}

// 선물 단계 종료 → 아스키아트(글자들이 날아가 부호 그림) → 엔딩 연주.
function giftDoneToEnding() {
  $('#gift-bar')?.classList.add('hidden');
  $('#mark-qr')?.classList.add('hidden');
  document.body.classList.remove('gift-time');
  startAsciiArt();
}

// ===== 아스키아트 전환 =====
// 선물이 끝나면, 그래픽 스코어에 타이핑된 글자들이 "슈우우" 날아가
// 최다 득표 부호에 걸맞은 그림을 화면 가득 그린다. 잠시 머문 뒤 엔딩 연주로.
const ASCII_FLY = 2400;    // 비행 시간(ms)
const ASCII_HOLD = 5000;   // 완성 후 머무는 시간(ms)
let asciiArt = null;       // { targets, start, cell, mark, done }

// 부호별 그림(마스크) — 검정으로 칠한 곳에 글자가 앉는다. 화면 가득 채우는 구도.
function asciiMaskDraw(g, mark, w, h) {
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#000'; g.strokeStyle = '#000'; g.lineCap = 'round'; g.lineJoin = 'round';
  const m = Math.min(w, h);
  if (mark === 'tilde') {
    // 커다란 파도 세 겹
    for (let k = 0; k < 3; k++) {
      g.lineWidth = m * (0.11 - k * 0.02);
      g.beginPath();
      for (let x = w * 0.05; x <= w * 0.95; x += 8) {
        const y = h * (0.28 + k * 0.22) + Math.sin((x / w) * Math.PI * 2.2 + k * 0.9) * h * 0.11;
        x <= w * 0.05 + 8 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.stroke();
    }
  } else if (mark === 'bang') {
    // 하늘을 가르는 번개 + 아래 점
    const cx = w * 0.5;
    g.beginPath();
    g.moveTo(cx + m * 0.10, h * 0.05); g.lineTo(cx - m * 0.17, h * 0.42); g.lineTo(cx - m * 0.03, h * 0.44);
    g.lineTo(cx - m * 0.21, h * 0.74); g.lineTo(cx + m * 0.17, h * 0.36); g.lineTo(cx + m * 0.03, h * 0.34);
    g.lineTo(cx + m * 0.23, h * 0.05); g.closePath(); g.fill();
    g.beginPath(); g.arc(cx - m * 0.05, h * 0.88, m * 0.055, 0, 7); g.fill();
  } else if (mark === 'period') {
    // 지평선 위 커다란 해(마침표)
    g.beginPath(); g.arc(w * 0.5, h * 0.40, m * 0.27, 0, 7); g.fill();
    g.lineWidth = m * 0.05;
    g.beginPath(); g.moveTo(w * 0.07, h * 0.80); g.lineTo(w * 0.93, h * 0.80); g.stroke();
  } else if (mark === 'ellipsis') {
    // 발자국처럼 이어지는 세 점
    [[0.22, 0.72], [0.5, 0.5], [0.78, 0.28]].forEach(([fx, fy], i) => {
      g.beginPath(); g.arc(w * fx, h * fy, m * (0.11 + i * 0.03), 0, 7); g.fill();
    });
  } else if (mark === 'semicolon') {
    // 화면 가득 세미콜론 — 잠깐 멈춤의 기호
    g.font = `${Math.floor(h * 0.94)}px Datatype, Galmuri11, monospace`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(';', w * 0.5, h * 0.5);
  } else {
    // 화면 가득 물음표
    g.font = `${Math.floor(h * 0.94)}px Datatype, Galmuri11, monospace`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('?', w * 0.5, h * 0.52);
  }
}

function startAsciiArt() {
  const mark = winningNuance || computeLeader() || 'tilde';
  // 소스 글자 — 스코어에 실제 타이핑된 글자들과 그 화면 위치(중복 사용 허용).
  const srcs = [];
  document.querySelectorAll('.gcell.filled').forEach((c) => {
    if (!c.textContent) return;
    const r = c.getBoundingClientRect();
    srcs.push({ ch: c.textContent, x: r.left + r.width / 2, y: r.top + r.height / 2 });
  });
  if (!srcs.length) srcs.push({ ch: '·', x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const W = window.innerWidth, H = window.innerHeight;
  const cell = Math.max(16, Math.floor(Math.min(W, H) / 40));
  const mc = document.createElement('canvas'); mc.width = W; mc.height = H;
  const g = mc.getContext('2d', { willReadFrequently: true });
  asciiMaskDraw(g, mark, W, H);
  const img = g.getImageData(0, 0, W, H).data;
  const targets = [];
  let k = 0;
  for (let y = Math.floor(cell / 2); y < H; y += cell) {
    for (let x = Math.floor(cell / 2); x < W; x += cell) {
      if (img[(y * W + x) * 4 + 3] > 128) {
        const sc = srcs[k % srcs.length]; k++;
        targets.push({ ch: sc.ch, sx: sc.x, sy: sc.y, tx: x, ty: y, delay: Math.random() * 700 });
      }
    }
  }
  asciiArt = { targets, start: performance.now(), cell, mark, done: false };
  state.phase = 'ascii';
  document.body.classList.add('ascii-time');   // 스코어판·캐릭터 열·입력칸 숨김
  // 폰에도 같은 그림을 띄운다(부호 + 사용 글자들)
  try {
    fetch('/ascii', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mark, chars: targets.slice(0, 500).map((o) => o.ch).join('') }),
    }).catch(() => {});
  } catch (e) { /* 정적 서버 — 무시 */ }
}

function drawAsciiArt(t) {
  if (!asciiArt) return;
  const W = window.innerWidth, H = window.innerHeight;
  sctx.fillStyle = '#fff'; sctx.fillRect(0, 0, W, H);
  const el = performance.now() - asciiArt.start;
  sctx.fillStyle = '#000';
  sctx.textAlign = 'center'; sctx.textBaseline = 'middle';
  sctx.font = `${(asciiArt.cell * 1.05).toFixed(1)}px Datatype, Galmuri11, monospace`;
  for (const tg of asciiArt.targets) {
    const p = Math.max(0, Math.min(1, (el - tg.delay) / ASCII_FLY));
    const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;   // easeInOutCubic — 슈우우
    sctx.fillText(tg.ch, tg.sx + (tg.tx - tg.sx) * e, tg.sy + (tg.ty - tg.sy) * e);
  }
  if (!asciiArt.done && el > ASCII_FLY + 700 + ASCII_HOLD) {
    asciiArt.done = true;
    endAsciiToEnding();
  }
}

function endAsciiToEnding() {
  document.body.classList.remove('ascii-time');
  asciiArt = null;
  state.phase = 'talk';
  postPhase('ending');
  showEnding();
}

// ===== 듀엣 연출 =====
// 번갈아 말하는 두 자리 — 지금 치는 캐릭터가 입력칸 왼쪽(차례 0)/오른쪽(차례 1)에
// 말할 때만 등장한다. 타건 직후엔 입을 움직인다. (흑백 실루엣)
let lastKeyAt = 0;
function drawDuetHeads(t) {
  if (state.phase !== 'round') return;
  const bar = $('#input-bar'); if (!bar) return;
  const r = bar.getBoundingClientRect();
  if (!r.width) return;
  const size = Math.min(120, Math.max(72, r.height * 1.8));
  const p = state.turn;
  const idx = state.picks[p];
  const talking = performance.now() - lastKeyAt < 450;
  const bob = Math.sin(t * 2.6) * 3 + (talking ? Math.sin(t * 11) * 2 : 0);
  const x = p === 0 ? r.left - size - 18 : r.right + 18;
  const y = r.top + r.height / 2 - size / 2 + bob;
  silhouetteDraw(sctx, idx, x, y, size, t, talking, 'neutral', p === 1);
}

// ===== 관객 폰 실시간 참여 =====
// serve.py 의 SSE(/events)로 폰(/tap.html)이 보낸 부호를 받아 castVote(…, 'aud').
// QR은 8초 라운드 동안 띄운다. 서버가 정적뿐이면(SSE 없음) 퍼포머 전용으로 동작.
let audienceTapUrl = null;   // 폰이 열 주소 (?pub=공개주소 우선, 없으면 서버 LAN 주소)
let audienceES = null;

function setupAudience() {
  const pub = new URLSearchParams(location.search).get('pub');
  if (pub) audienceTapUrl = pub.replace(/\/+$/, '') + '/tap.html';
  // 서버가 알려주는 같은-와이파이 LAN 주소(공개주소가 없을 때만 사용)
  fetch('/config').then((r) => r.json()).then((c) => {
    if (!audienceTapUrl && c && c.lanUrl) audienceTapUrl = c.lanUrl;
    if (cycleOn) renderMarkQR();   // 그새 사이클에 들어가 있었으면 갱신
  }).catch(() => {});
  try {
    audienceES = new EventSource('/events');
    audienceES.onmessage = (ev) => {
      let d; try { d = JSON.parse(ev.data); } catch (e) { return; }
      if (!d) return;
      if (d.mark) castVote(d.mark, 'aud');
      // 폰에서 온 선물 — 선물 단계에서만, 자기 자신 제외, 인덱스 검증.
      else if (d.type === 'gift' && state.phase === 'gift') {
        const g = +d.giver, r = +d.recip;
        if (Number.isInteger(g) && Number.isInteger(r) && g !== r && g >= 0 && g < N && r >= 0 && r < N) {
          giveSpecificGift(r, g);
        }
      }
    };
    audienceES.onerror = () => {};   // 브라우저가 자동 재연결 — 조용히
  } catch (e) { /* SSE 미지원 서버 — 퍼포머 전용 */ }
}

// 라운드 중 관객 참여 QR을 그린다(주소·라이브러리 있을 때만).
function renderMarkQR() {
  const box = $('#mark-qr'); const code = $('#mark-qr-code');
  if (!box || !code) return;
  if (!audienceTapUrl || typeof QRCode === 'undefined') { box.classList.add('hidden'); return; }
  code.innerHTML = '';
  new QRCode(code, {
    text: audienceTapUrl, width: 128, height: 128,
    colorDark: '#000', colorLight: '#fff', correctLevel: QRCode.CorrectLevel.M,
  });
  box.classList.remove('hidden');
}

// ===== 도감 그리드 (스코어 테마) =====
// N개의 캐릭터를 그리드로 깔고, 탭하면 가운데 큰 캔버스(#dex-stage)에 보여준다.
function buildDex() {
  if (!dexGrid) return;
  dexGrid.innerHTML = '';
  for (let i = 0; i < N; i++) {
    const b = document.createElement('button');
    b.className = 'dex-cell';
    b.dataset.dex = i;
    const cv = document.createElement('canvas');
    cv.width = 64; cv.height = 64;
    const c = cv.getContext('2d');
    c.imageSmoothingEnabled = false;
    if (SCORE) silhouetteDraw(c, i, 0, 0, 64, i * 1.3, false, 'neutral', false);
    else drawCharacter(c, i, 0, 0, 64, i * 1.3);
    b.appendChild(cv);
    dexGrid.appendChild(b);
  }
  highlightDex();
}
function highlightDex() {
  if (!dexGrid) return;
  [...dexGrid.children].forEach((b, i) => b.classList.toggle('active', dexView === i));
}

// ===== 플레이 =====
function startPlay() {
  state.messages = [];
  state.rhythms = [];
  state.input = '';
  state.turn = 0;
  state.lastMood = 'neutral';
  state.ended = false;   // 새 게임 — 엔딩 진입 가드 해제
  asciiArt = null;
  document.body.classList.remove('ascii-time');
  resetGifts();          // 새 게임 — 선물(리버브) 초기화
  const hl = $('#heart-layer'); if (hl) hl.innerHTML = '';
  buildGrid();   // 스코어 사각형 그리드를 만든다 (글자가 랜덤 칸에 채워질 공간)
  hidden.value = '';
  typeEvents = [];
  lastActiveChar = -1;
  pickRandomActive();   // 첫 차례 캐릭터 무작위 선택
  startCycle();   // 뉘앙스 라운드 사이클 시작(32→16→8→4 순환, 매 라운드 4초 예비박)
}

// 한·영 병기 헬퍼 (CRT 모드에서만 영어를 덧붙인다)
function bi(ko, en) { return MINIMAL ? `${ko} · ${en}` : ko; }
// 엔딩 게이지 색(해피엔딩 연출용)
function connColor(r) {
  return r >= 0.6 ? '#7be08a' : r >= 0.4 ? '#ffd166' : '#ff6b6b';
}

function refreshTurn() {
  const p = state.turn;
  if (SCORE) {
    // 단일 왼쪽 열 — 항상 켜 두고, 지금 차례인 사람의 캐릭터만 강조한다.
    highlightPicks();
  } else {
    // 차례 표시: "플레이어 N 차례" 문구 대신, 좌/우 캐릭터 열을 활성/비활성으로 전환한다.
    pickCols.forEach((col, i) => {
      if (!col) return;
      col.classList.toggle('turn-on', i === p);
      col.classList.toggle('turn-off', i !== p);
    });
  }
  $('#screen-play').className = `screen active ${p === 0 ? 'p1-tint' : 'p2-tint'}`;
  renderInput();
}

// 매 차례 4명 중 무작위로 "지금 칠 캐릭터"를 자동 선택한다(직전 화자는 피해 다양하게).
// 슬롯머신 소개·선물 등은 그대로 4명을 쓰고, 타이핑 차례만 무작위로 돌아간다.
let lastActiveChar = -1;
function pickRandomActive() {
  let r = Math.floor(Math.random() * N);
  if (N > 1) { let guard = 0; while (r === lastActiveChar && guard++ < 20) r = Math.floor(Math.random() * N); }
  lastActiveChar = r;
  state.picks[state.turn] = r;   // 현재 차례 슬롯에 무작위 캐릭터를 앉힌다
  refreshTurn();
}

// 라운드 초가 다 지나면 = 자동으로 엔터친 것처럼 현재 입력을 전송한다(비어있으면 무시).
function commitPendingInput() {
  if (hidden && hidden.value.trim()) sendMessage();
}

function renderInput() {
  const p = state.turn;
  const shown = renderDisplay(state.input, characterVoice(state.picks[p]));
  $('#input-text').textContent = shown;
  $('#input-line').classList.add('alien');   // 입력도 늘 미지의 언어
}

function sendMessage() {
  const text = hidden.value.trim();
  if (!text) return;
  const p = state.turn;
  // 무드는 메시지마다 랜덤 — 목소리 이펙트·표정·반응을 결정
  const mood = MOODS[Math.floor(Math.random() * MOODS.length)];
  const garble = garbleForMood(mood);
  // 친 키보드 리듬 그대로 발음 — 누른 키 하나하나를 정확한 시각에 반복 재생
  const rhythm = buildRhythmEvents();
  // 메시지에 리듬을 직접 붙여 둔다 → 엔딩 악보가 화자별로 빠짐없이(실제 리듬으로) 재구성된다.
  // pick = 캐릭터 인덱스(스프라이트·색·이름). voiceId = 원래 소리·글리프 체계 인덱스.
  const voiceId = characterVoice(state.picks[p]);
  // 보낸 순간의 뉘앙스(투표 리더)도 함께 저장 → 엔딩 악보에서 문장부호로 발음된다.
  state.messages.push({ player: p, pick: state.picks[p], voiceId, text, mood, garble, rhythm, nuance: computeLeader() || 'period' });
  state.lastMood = mood;
  addBubble(p, text);                          // 스코어에 화자 기호로 쌓는다
  // 메시지 읽어주기(speakVoiceEvents)는 다음 파트에서 쓰기로 하고 잠시 꺼둠 — 리듬은 엔딩 합주용으로 계속 보관.
  if (rhythm.length) state.rhythms.push({ player: p, voiceId, events: rhythm, garble });  // 엔딩 합주용 보관(실제 리듬+화자+가블)
  typeEvents = [];                             // 다음 메시지를 위해 리셋

  const now = performance.now();
  state.talkUntil[p] = now + Math.min(4000, 400 + text.length * 120);
  state.reactUntil[0] = state.reactUntil[1] = now + 700;

  // 입력 비우고 차례 넘김 — 다음 칠 캐릭터를 4명 중 무작위로 자동 선택
  hidden.value = '';
  state.input = '';
  state.turn = 1 - p;
  pickRandomActive();

  // 그리드가 꽉 차면 사이클을 멈추고 선물 단계로 넘어간다.
  if (scoreFull()) endCycle();
}

// 엔딩은 언제나 해피엔딩 — 여정은 달라도 끝내 마음은 닿는다.
const HAPPY_ENDINGS = [
  { ko: '마음이 닿았다', en: 'Their hearts reached each other' },
  { ko: '서로에게 스며들었다', en: 'They seeped into each other' },
  { ko: '같은 노래가 되었다', en: 'They became the same song' },
  { ko: '끝내 알아들었다', en: 'In the end, they understood' },
  { ko: '둘만의 말이 생겼다', en: 'A language of their own was born' },
];
// ===== 엔딩 악보 =====
// 대화를 "하나의 곡"으로 작곡한다. 무작위 나열이 아니라:
//   1) 첫 대화에서 짧은 모티브(음형 4개 + 리듬)를 도출하고
//   2) 그 모티브를 기·승·전·결로 발전시킨다
//      기(intro)  : 모티브를 낮고 느리게 제시
//      승(rise)   : 음형을 차례로 위로 옮겨가며(시퀀스) 전개, 두 목소리 교대
//      전(peak)   : 옥타브 위·반전·축소로 절정, 악센트와 밀도 최고
//      결(cadence): 모티브로 돌아와 으뜸음으로 길게 가라앉으며 마무리
//   대화 내용은 모티브·변형·강세를 결정하지만, 음높이는 늘 모티브에서 파생된다.
const PENTA = [0, 2, 4, 7, 9];                 // D 펜타토닉
const VOWELS = ['a', 'e', 'i', 'o', 'u'];      // 포먼트 합성용 모음
const ROOT_MIDI = 38;                          // 드론/조성 근음 (D)
const MAX_NOTES = 600;                          // 안전 상한(대화가 아주 길 때만 도달)
const TARGET_SECONDS = 60;                      // 엔딩 곡 목표 길이(초)
const SCORE_PAGE_BEATS = 22;                    // 악보 한 페이지가 담는 박수(끝나면 다음 페이지로 넘김)
let endingScore = null;                        // { notes, totalBeats, root, sections }
let stopScore = null;                          // 진행 중 연주 중단 함수
let stopEnsemble = null;                        // 엔딩 합주(1·2 리듬 겹침) 중단 함수
let scoreAnim = null;                          // 악보 애니메이션 rAF
let scoreStartWall = 0, scoreTotalMs = 0;      // 비주얼 진행 계산용
let endingPhase = 0;                            // 0=없음, 1=순차 듀엣, 2=오케스트라 합주
let orchestraScore = null;                      // 2단계 다성부 악보 데이터
const SCORE_TEMPO = 156;

// 정수 해시 — 글자마다 여러 독립적인 결정값을 뽑기 위해
function h32(n) {
  n = Math.imul((n >> 16) ^ n, 0x45d9f3b);
  n = Math.imul((n >> 16) ^ n, 0x45d9f3b);
  n = (n >> 16) ^ n;
  return n < 0 ? -n : n;
}

// 스케일 인덱스(0,1,2…) → MIDI. 5를 넘으면 다음 옥타브로, 음수면 아래 옥타브로.
function deg2midi(idx, octave) {
  const wrapped = ((idx % 5) + 5) % 5;
  const extra = Math.floor(idx / 5);
  return 50 + PENTA[wrapped] + 12 * (octave + extra);   // D3 부근 기준
}

// 타이핑한 글자들을 "재료"로 한 곡을 작곡한다.
//  · 대화 전체의 글자를 모아 → 스케일(펜타토닉) 음형 재료로 변환
//  · 처음 등장하는 서로 다른 음 4개로 핵심 동기(모티브)를 뽑고
//  · 그 동기를 아치형(제시→전개→절정→회귀)으로 발전시킨다(라벨 없이, 음악으로만)
//  · 두 목소리가 악구마다 번갈아(콜&리스폰스), 악센트·가블·모음·글리프는 글자에서 가져온다
//  쓴 순서를 그대로 늘어놓지 않고, 동기를 변형·시퀀스·반전·축소해 한 곡으로 짠다.
// 재료 한 글자 → 음표 머리 글리프. 실제 타이핑 글자를 그 캐릭터의 글리프 체계로 변환.
// (한글은 2글리프를 내므로 첫 글리프만 쓴다.) 매핑이 비면 음높이 파생으로 폴백.
function typedGlyph(c) {
  if (!c) return glyphForCode(0);
  const g = glyphForChar(c.ch, c.sys);
  const first = g ? [...g][0] : null;
  return first || glyphForCode(c.code, c.sys);
}

// 대화를 "그대로" 한 곡으로 — 실제로 친 타건 리듬·순서·글자를 살려 작곡한다.
//  · 음표 길이 = 실제 키 사이 간격(빠른 연타→짧은 음, 머뭇거림→긴 음)
//  · 진행 순서 = 실제 대화 순서(차례가 오가며 두 언어가 자연히 콜&리스폰스)
//  · 음고 = 글자코드로 결정되는 부드러운 랜덤워크(고정 모티브 반복 없이 유기적으로 떠돈다)
//  · 길이가 모자라면 옥타브·윤곽을 바꾼 "변주 패스"를 이어 붙여 ~1분을 채운다(단순 반복 X)
function buildScore() {
  const msgs = state.messages;
  if (!msgs.length) return { notes: [], totalBeats: 1, root: ROOT_MIDI };
  const spb = 60 / SCORE_TEMPO;

  // 1) 청크 = 메시지(보낸 순서 그대로). 두 화자가 빠짐없이 들어간다.
  //    타이밍은 메시지에 붙은 실제 리듬(m.rhythm)을 쓰고, 없으면 글자로 균일 합성.
  //    각 청크: { player, voiceId(글리프 체계), garble, events:[{rel(초), ch}] }
  const chunks = msgs.map((m) => {
    const real = m.rhythm && m.rhythm.length
      ? m.rhythm.filter((e) => e.ch && e.ch !== ' ' && e.ch !== '\n')
      : null;
    const events = (real && real.length)
      ? real
      : [...(m.text || '')].filter((c) => c !== ' ' && c !== '\n').map((ch, i) => ({ rel: i * 0.26, ch }));
    return {
      player: m.player || 0,
      voiceId: m.voiceId != null ? m.voiceId : (m.pick != null ? characterVoice(m.pick) : (m.player || 0)),
      garble: m.garble != null ? m.garble : 0.5,
      events,
    };
  }).filter((c) => c.events.length);
  if (!chunks.length) return { notes: [], totalBeats: 1, root: ROOT_MIDI };

  // 2) 길이 보정 — 한 패스(대화 1회분)의 생음 길이를 재서, 너무 길면 압축/짧으면 그대로.
  let rawSec = 0, glyphCount = 0;
  chunks.forEach((c) => {
    let prev = null;
    c.events.forEach((e) => {
      if (e.ch === ' ' || e.ch === '\n' || e.ch == null) return;
      const gap = prev == null ? 0.30 : Math.max(0.05, e.rel - prev);
      prev = e.rel; rawSec += gap; glyphCount++;
    });
    rawSec += 0.45;   // 메시지 사이 숨
  });
  if (!glyphCount) return { notes: [], totalBeats: 1, root: ROOT_MIDI };
  const rawBeats = rawSec / spb;
  const targetBeats = TARGET_SECONDS / spb;          // ≈ 156박(약 60초)
  // 한 패스가 목표보다 많이 길면 ~60초로 압축, 짧으면 실제 속도 유지(0.7~1.6 사이로 클램프).
  const durScale = Math.max(0.45, Math.min(1.6, rawBeats > targetBeats * 1.15 ? targetBeats / rawBeats : 1));

  const stepTbl = [-3, -2, -1, -1, 1, 1, 2, 3];      // 랜덤워크 보폭(글자코드로 선택)
  const deg = [0, 1];                                 // 목소리별 현재 음계 위치(연속적으로 이어감)
  const notes = [];
  let total = 0;

  // 한 청크를 음표들로 펼친다. pass>0이면 변주(옥타브 이동·윤곽 반전).
  function emitChunk(c, pass) {
    const v = (c.player === 1) ? 1 : 0;
    const sys = c.voiceId != null ? c.voiceId : v;
    const g = c.garble != null ? c.garble : 0.5;
    const technique = v === 0 ? 'voice' : 'piano';
    const octBias = pass === 0 ? 0 : (pass % 2 === 1 ? 1 : -1);   // 변주마다 음역 이동
    const flip = pass % 2 === 1;                                  // 변주마다 윤곽 반전
    let prev = null, k = 0;
    c.events.forEach((e) => {
      const ch = e.ch;
      if (ch === ' ' || ch === '\n' || ch == null) return;
      const code = ch.codePointAt(0);
      const gap = prev == null ? 0.30 : Math.max(0.05, e.rel - prev);
      prev = e.rel;
      let step = stepTbl[h32(code + pass * 17) % stepTbl.length];
      if (flip) step = -step;
      deg[v] = Math.max(-4, Math.min(11, deg[v] + step));         // 약 2.5옥타브 음역
      // 길이 = 실제 키 간격. 단 아주 긴 머뭇거림은 살짝 압축해(>1박은 절반 기울기)
      // 페이지가 비지 않고 촘촘·풍부하게 짜이도록 한다(상대적 빠름/느림은 유지).
      let beats = (gap / spb) * durScale;
      if (beats > 1) beats = 1 + (beats - 1) * 0.45;
      const rdur = Math.max(0.18, Math.min(2.2, beats));
      const midi = deg2midi(deg[v], octBias > 0 ? 1 : 0) + (octBias < 0 ? -12 : 0);
      notes.push({
        midi,
        dur: +rdur.toFixed(3),
        player: v,
        garble: g,
        vowel: VOWELS[(((deg[v] % 5) + 5) % 5)],
        technique,
        accent: (h32(code) % 6 === 0),                            // 글자에 따라 가끔 악센트
        glyph: typedGlyph({ ch, code, sys }),                     // 실제 친 글자의 글리프(그 화자 체계)
      });
      total += rdur;
      k++;
    });
    const breath = Math.max(0.25, 0.45 / spb * durScale);
    notes.push({ rest: true, dur: breath });
    total += breath;
  }

  // 패스 1 = 실제 대화 그대로. 모자라면 변주 패스를 이어 붙여 ~목표 길이까지(최대 6패스).
  let pass = 0;
  while (total < targetBeats && pass < 6 && notes.length < MAX_NOTES) {
    for (const c of chunks) {
      emitChunk(c, pass);
      if (total >= targetBeats || notes.length >= MAX_NOTES) break;
    }
    pass++;
  }

  // 결: 두 목소리가 으뜸음 근처로 모이며 길게 가라앉는다.
  notes.push({ midi: deg2midi(0, 0), dur: 2.4, player: 0, garble: 0.3, vowel: 'o', technique: 'voice', accent: false, glyph: typedGlyph({ ch: '·', code: 46, sys: chunks[0].voiceId }) });
  total += 2.4;

  return { notes, totalBeats: Math.max(1, total), root: ROOT_MIDI };
}

// 2단계 오케스트라 총보 — 발화(메시지)마다 "파트" 하나씩.
//  · 각 파트는 자기 음표열(실제 친 리듬으로 길이, 글자코드 랜덤워크로 음고)을 가진다.
//  · 파트 시작 시각(startBeat)을 랜덤하게 흩어, 악기들이 제각기 입장하듯 겹쳐 울린다.
//  · 시각적으로는 파트별 보표를 위아래로 쌓아 오케스트라 총보처럼 보여준다.
function buildOrchestra() {
  const msgs = state.messages;
  if (!msgs.length) return null;
  const spb = 60 / SCORE_TEMPO;

  const chunks = msgs.map((m) => {
    const real = m.rhythm && m.rhythm.length
      ? m.rhythm.filter((e) => e.ch && e.ch !== ' ' && e.ch !== '\n')
      : null;
    const events = (real && real.length)
      ? real
      : [...(m.text || '')].filter((c) => c !== ' ' && c !== '\n').map((ch, i) => ({ rel: i * 0.26, ch }));
    return {
      player: m.player || 0,
      voiceId: m.voiceId != null ? m.voiceId : (m.pick != null ? characterVoice(m.pick) : (m.player || 0)),
      garble: m.garble != null ? m.garble : 0.5,
      events,
    };
  }).filter((c) => c.events.length);
  if (!chunks.length) return null;

  const stepTbl = [-3, -2, -1, -1, 1, 1, 2, 3];
  const parts = [];
  chunks.forEach((c, ci) => {
    const v = (c.player === 1) ? 1 : 0;
    const sys = c.voiceId != null ? c.voiceId : v;
    let deg = (v === 0) ? 0 : 1;
    let prev = null;
    const notes = [];
    let lenBeats = 0;
    c.events.forEach((e) => {
      const ch = e.ch;
      if (ch === ' ' || ch === '\n' || ch == null) return;
      const code = ch.codePointAt(0);
      const gap = prev == null ? 0.30 : Math.max(0.05, e.rel - prev);
      prev = e.rel;
      let step = stepTbl[h32(code + ci * 17) % stepTbl.length];
      deg = Math.max(-4, Math.min(11, deg + step));
      let beats = gap / spb;
      if (beats > 1) beats = 1 + (beats - 1) * 0.45;
      const dur = Math.max(0.18, Math.min(2.2, beats));
      notes.push({ midi: deg2midi(deg, 0), dur, beat: lenBeats, glyph: typedGlyph({ ch, code, sys }), accent: (h32(code) % 6 === 0) });
      lenBeats += dur;
    });
    if (!notes.length) return;
    parts.push({ voiceId: sys, player: v, garble: c.garble, events: c.events, notes, lenBeats });
  });
  if (!parts.length) return null;

  // 랜덤 입장 — 악기 수가 많을수록 더 넓게 흩어 천천히 쌓이는 오케스트라처럼.
  const longest = Math.max(...parts.map((p) => p.lenBeats));
  const spread = Math.max(longest * 1.2, parts.length * 0.9, 12);
  parts.forEach((p, i) => {
    const r = (h32((i + 1) * 97 + (p.voiceId + 1) * 131) % 1000) / 1000;
    p.startBeat = r * spread;
  });
  let maxEnd = 0, lo = Infinity, hi = -Infinity;
  parts.forEach((p) => {
    const end = p.startBeat + p.lenBeats; if (end > maxEnd) maxEnd = end;
    p.notes.forEach((n) => { if (n.midi < lo) lo = n.midi; if (n.midi > hi) hi = n.midi; });
  });
  return { parts, totalBeats: maxEnd + 6, lo, span: Math.max(1, hi - lo), root: ROOT_MIDI };
}

// 악보를 그래픽 노테이션으로 그린다. progress = 0..1 (연주 진행도).
// 현재 진행도(0..1) — 연주 시작 시각 기준.
function scoreProgress() {
  if (!scoreTotalMs) return 0;
  return Math.max(0, Math.min(1, (performance.now() - scoreStartWall) / scoreTotalMs));
}

// 플레이어별로 "방금 연주된 음표가 몇 박 전이었는지" — 춤 박자에 쓴다.
function lastNoteRecency(playBeat) {
  if (!endingScore) return [null, null];
  let beat = 0; const last = [null, null];
  for (const n of endingScore.notes) {
    if (!n.rest && beat <= playBeat) last[n.player] = playBeat - beat;
    beat += n.dur;
    if (beat > playBeat + 0.01) break;
  }
  return last;
}

// 1·2단계 악보를 절대 박(beat) 기준 평탄 음표 목록으로 — 3D 렌더 공용.
function flatScoreNotes() {
  if (endingPhase === 2 && orchestraScore) {
    const out = [];
    orchestraScore.parts.forEach((p, pi) => {
      p.notes.forEach((n) => out.push({ beat: p.startBeat + n.beat, midi: n.midi, lane: p.voiceId, part: pi, player: p.player, glyph: n.glyph, accent: n.accent }));
    });
    return { notes: out, lo: orchestraScore.lo, span: orchestraScore.span, totalBeats: orchestraScore.totalBeats, phase: 2 };
  }
  if (endingScore) {
    const out = []; let beat = 0;
    endingScore.notes.forEach((n) => {
      if (!n.rest) out.push({ beat, midi: n.midi, lane: n.player, player: n.player, glyph: n.glyph, accent: n.accent });
      beat += n.dur;
    });
    if (!out.length) return null;
    const ps = out.map((o) => o.midi);
    const lo = Math.min(...ps), span = Math.max(1, Math.max(...ps) - lo);
    return { notes: out, lo, span, totalBeats: endingScore.totalBeats, phase: 1 };
  }
  return null;
}

// ===== 3D 그래픽 스코어 =====
// 고정된 3D 공간에 음이 칠 때마다 점·선이 생성되어 쌓이고(이미 생긴 건 월드 좌표에 고정),
// z(깊이)는 박(beat)에 비례한다. 카메라는 가장 최근 음(리드) 약간 앞에서 -z 방향으로 보며,
// 음악이 진행되면 함께 전진한다(잔잔한 sway). 새 음은 카메라 가까이 생겨 점점 멀어진다.
// 라이브러리 없이 캔버스 원근 투영. 흰 배경·검정 잉크 미학 유지.
const ZS = 1.45;          // 박당 깊이(월드 단위)
const ORG = 1.0;          // 유기적 흩뿌림 정도(0=격자처럼 정렬, 클수록 자유롭게 흩어짐)
function laneX(d, phase) {
  return phase === 2 ? ((((d.lane % 4) + 4) % 4) - 1.5) * 1.25 : (d.player === 1 ? 1.6 : -1.6);
}
// 음마다 고정된 의사난수(해시) — 같은 음은 늘 같은 자리에 찍힌다(고정).
function hash01(s) { const x = Math.sin(s) * 43758.5453; return x - Math.floor(x); }
function v3sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function v3dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function v3cross(a, b) { return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }; }
function v3norm(a) { const m = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / m, y: a.y / m, z: a.z / m }; }

const SPH = 7.4;          // 2단계 구형 점구름 반지름
// 음의 월드 좌표. 1단계=박 깊이로 전진하는 선율, 2단계=중심 둘레의 구형 점구름.
function noteWorld(d, phase, lo, span) {
  if (phase === 2) {
    // 그래프 뷰처럼 — 발화(파트)마다 한 덩어리(클러스터)로 뭉친다. 클러스터 위치·크기·밀도가
    // 제각각이라 어떤 덴 빽빽, 어떤 덴 성기게. 연결선은 같은 덩어리 안에서만 이어져 짧다.
    const cp = d.part != null ? d.part : d.lane;
    const cs = (cp + 1) * 31.7;
    const cth = hash01(cs * 1.1) * 6.2831853;
    const cphi = Math.acos(2 * hash01(cs * 1.7 + 2.3) - 1);
    const cr = SPH * (0.12 + 1.05 * hash01(cs * 2.9 + 5.1));  // 거리 편차 큼 — 바깥에 튀는 덩어리도, 중심 가까이도
    const cst = Math.sin(cphi);
    const center = { x: cr * cst * Math.cos(cth), y: cr * Math.cos(cphi), z: cr * cst * Math.sin(cth) };
    const tight = 0.7 + 1.5 * hash01(cs * 3.7 + 8.8);         // 덩어리 반경(뭉침 정도) 제각각
    const sd = d.beat * 7.7 + d.midi * 1.3;
    const lt = hash01(sd * 1.1) * 6.2831853;
    const lp = Math.acos(2 * hash01(sd * 1.7 + 3.1) - 1);
    const lr = tight * Math.cbrt(hash01(sd * 2.3 + 7.7));     // cbrt → 중심에 더 모여 밀도감
    const lst = Math.sin(lp);
    const fx = center.x + lr * lst * Math.cos(lt);
    const fy = center.y + lr * Math.cos(lp);
    const fz = center.z + lr * lst * Math.sin(lt);
    // 비대칭 스케일 — 구를 깨 울퉁불퉁한 덩어리로(회전하면 폭이 변한다).
    return { x: fx * 1.45, y: fy * 0.7, z: fz * 1.05 };
  }
  const sd = d.beat * 13.13 + d.midi * 0.77 + d.lane * 4.7;
  return {
    x: laneX(d, phase) + (hash01(sd) - 0.5) * ORG * 1.7,
    y: ((d.midi - lo) / span - 0.5) * 5.4 + (hash01(sd * 1.7 + 3.1) - 0.5) * ORG * 1.3,
    z: d.beat * ZS + (hash01(sd * 2.3 + 7.7) - 0.5) * ORG * 1.3,
  };
}

function drawScore3D(ctx, W, H, t, progress) {
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
  const S = flatScoreNotes();
  if (!S) return;
  const { notes, lo, span, totalBeats, phase } = S;
  const playBeat = progress * totalBeats;
  const leadZ = playBeat * ZS;
  const sphere = phase === 2;

  // 카메라 — 1단계: 리드 약간 앞에서 -z로 음악과 함께 전진(잔잔한 sway).
  //          2단계: 위치 고정, 중심(원점)을 기준으로 천천히 공전(=구가 회전하는 느낌).
  let cam, target;
  if (sphere) {
    const orbit = t * 0.17;                      // 느린 회전
    const camR = 17.5;
    cam = { x: Math.sin(orbit) * camR, y: 2.2 + Math.sin(t * 0.12) * 1.0, z: Math.cos(orbit) * camR };
    target = { x: Math.sin(t * 0.2) * 0.4, y: 0, z: 0 };
  } else {
    const swayX = Math.sin(t * 0.32) * 0.85, swayY = Math.sin(t * 0.24 + 1) * 0.4;
    cam = { x: swayX, y: 0.9 + swayY, z: leadZ + 5.6 };
    target = { x: swayX * 0.25, y: 0.3, z: leadZ - 1.6 };
  }
  const fwd = v3norm(v3sub(target, cam));
  const right = v3norm(v3cross(fwd, { x: 0, y: 1, z: 0 }));
  const upv = v3cross(right, fwd);
  const focal = W * 0.86, cx = W / 2, cy = H * (sphere ? 0.46 : 0.5);

  function project(P) {
    const dp = v3sub(P, cam);
    const vz = v3dot(fwd, dp);
    if (vz < 0.4) return null;
    return { sx: cx + focal * v3dot(right, dp) / vz, sy: cy - focal * v3dot(upv, dp) / vz, vz };
  }
  const near = sphere ? 11 : 3, far = sphere ? 26 : 46;
  const depthAlpha = (vz) => Math.max(0.1, Math.min(1, (far - vz) / (far - near)));

  // 받침 — 1단계만: y 레벨 3줄(3선보표)이 깊이로 뻗어 소실점으로.
  if (!sphere) {
    ctx.lineWidth = 1;
    [-2.3, 0, 2.3].forEach((yL) => {
      ctx.beginPath(); let started = false;
      const step = Math.max(0.6, leadZ / 70);
      for (let z = 0; z <= leadZ + 0.001; z += step) {
        const pr = project({ x: 0, y: yL, z });
        if (!pr) { started = false; continue; }
        if (!started) { ctx.moveTo(pr.sx, pr.sy); started = true; } else ctx.lineTo(pr.sx, pr.sy);
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.08)'; ctx.stroke();
    });
  }

  // 생성된 음표(beat<=playBeat)를 월드 좌표에 배치 + 화면 투영.
  const placed = [];
  for (const d of notes) {
    if (d.beat > playBeat) continue;
    const pr = project(noteWorld(d, phase, lo, span));
    if (pr) placed.push({ d, pr });
  }

  // 연결선 — 1단계는 성부(lane)별, 2단계는 덩어리(part)별로만 이어 선이 짧게 머문다.
  const lanes = {};
  placed.forEach((o) => { const k = sphere ? (o.d.part != null ? 'p' + o.d.part : o.d.lane) : o.d.lane; (lanes[k] = lanes[k] || []).push(o); });
  Object.keys(lanes).forEach((k) => {
    const arr = lanes[k].sort((a, b) => a.d.beat - b.d.beat);
    if (arr.length < 2) return;
    const maxLen = W * 0.16;   // 너무 멀리 가는 엣지는 그리지 않는다(선이 가까이 머물게)
    for (let i = 1; i < arr.length; i++) {
      const a = arr[i - 1].pr, b = arr[i].pr;
      if (sphere && Math.hypot(a.sx - b.sx, a.sy - b.sy) > maxLen) continue;
      ctx.strokeStyle = `rgba(0,0,0,${((sphere ? 0.18 : 0.22) * depthAlpha((a.vz + b.vz) / 2)).toFixed(3)})`;
      ctx.lineWidth = Math.max(0.5, 2.2 / (((a.vz + b.vz) / 2) * 0.12 + 1));
      ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
    }
  });

  // 음표 글리프 — 가까울수록 크고 진하게. 막 친 음은 살짝 팝. 2단계는 점구름이라 더 작게.
  const sizeBase = sphere ? 0.3 : 0.5, sizeMax = sphere ? 40 : 64;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  placed.forEach(({ d, pr }) => {
    const fresh = (playBeat - d.beat) < 0.45;
    const a = Math.min(1, depthAlpha(pr.vz) * (d.accent ? 1 : 0.92) + (fresh ? 0.25 : 0));
    const fpx = Math.max(8, Math.min(sizeMax, focal * (sizeBase + (d.accent ? 0.16 : 0) + (fresh ? 0.22 : 0)) / pr.vz));
    ctx.fillStyle = `rgba(0,0,0,${a.toFixed(3)})`;
    ctx.font = `${fpx.toFixed(1)}px Datatype, Galmuri11, monospace`;
    ctx.fillText(d.glyph || '◇', pr.sx, pr.sy);
    if (d.accent) {
      ctx.strokeStyle = `rgba(0,0,0,${(a * 0.7).toFixed(3)})`; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(pr.sx, pr.sy, fpx * 0.62, 0, Math.PI * 2); ctx.stroke();
    }
  });
}

// 엔딩 화면 전체: 악보로 꽉 채우고, 맨 밑에 작은 캐릭터들이 음악에 맞춰 춤춘다.
function drawFullScore(ctx, W, H, t, progress) {
  // 배경
  if (SCORE) {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
  } else {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    if (MINIMAL) { bg.addColorStop(0, '#04140a'); bg.addColorStop(1, '#010a04'); }
    else { bg.addColorStop(0, '#0d0b1a'); bg.addColorStop(1, '#161029'); }
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  }
  if (!endingScore) return;

  const { notes, totalBeats } = endingScore;
  const pitches = notes.filter((n) => !n.rest).map((n) => n.midi);
  if (!pitches.length) return;
  const lo = Math.min(...pitches), span = Math.max(1, Math.max(...pitches) - lo);

  // 악보 영역(위쪽 텍스트와 아래쪽 댄서·버튼을 피해 화면 중앙을 크게 채운다)
  const left = W * 0.06, top = H * 0.30, w = W * 0.88, h = H * 0.32;
  const playBeat = progress * totalBeats;

  const C = SCORE
    ? { staff: 'rgba(0,0,0,0.16)', p0: '#000', p1: '#000', play: 'rgba(0,0,0,0.85)', glow: 'rgba(0,0,0,0.0)' }
    : MINIMAL
    ? { staff: 'rgba(77,255,122,0.16)', p0: '#7dff9c', p1: '#34c468', play: 'rgba(194,255,216,0.95)', glow: '#9dffbd' }
    : { staff: 'rgba(255,255,255,0.10)', p0: '#ff5d8f', p1: '#4fd1c5', play: 'rgba(255,209,102,0.95)', glow: '#ffd166' };

  if (SCORE) {
    // 페이징 — 악보를 SCORE_PAGE_BEATS 박씩 끊어, 한 페이지가 끝나면 다음 페이지로 교체.
    // 현재 재생 박(playBeat)이 속한 페이지만 그린다(x는 페이지 안에서 0..1로 재배치).
    const PAGE = SCORE_PAGE_BEATS;
    const maxPage = Math.max(0, Math.ceil(totalBeats / PAGE) - 1);
    const page = Math.min(maxPage, Math.floor(playBeat / PAGE));
    const pageStart = page * PAGE;
    const pageEnd = pageStart + PAGE;

    let beat = 0;
    const pts = [[], []];
    notes.forEach((n) => {
      if (!n.rest && beat >= pageStart && beat < pageEnd) {
        const x = left + ((beat - pageStart) / PAGE) * w;
        const y = top + h - ((n.midi - lo) / span) * h;
        pts[n.player].push({ x, y, beat, n });
      }
      beat += n.dur;
    });
    const headFrac = Math.max(0, Math.min(1, (playBeat - pageStart) / PAGE));
    drawRuledScore(ctx, pts, { left, top, w, h, playBeat, headFrac, page, maxPage });
    drawDancers(ctx, W, H, t, playBeat);
    return;
  }

  // 음표 좌표 수집(플레이어별) — 다크/CRT용(전체를 한 화면에 압축)
  let beat = 0;
  const pts = [[], []];
  notes.forEach((n) => {
    if (!n.rest) {
      const x = left + (beat / totalBeats) * w;
      const y = top + h - ((n.midi - lo) / span) * h;
      pts[n.player].push({ x, y, beat, n });
    }
    beat += n.dur;
  });

  {
    // ── 기존(다크/CRT) 렌더: 보표 + 곡선 윤곽 + 글로우 글리프 ──
    ctx.strokeStyle = C.staff; ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = top + (h * i) / 4;
      ctx.beginPath(); ctx.moveTo(left, y + 0.5); ctx.lineTo(left + w, y + 0.5); ctx.stroke();
    }
    [0, 1].forEach((pl) => {
      const arr = pts[pl]; if (arr.length < 2) return;
      ctx.strokeStyle = pl === 0 ? C.p0 : C.p1; ctx.globalAlpha = 0.3; ctx.lineWidth = 2;
      ctx.beginPath();
      arr.forEach((p, i) => {
        if (!i) { ctx.moveTo(p.x, p.y); return; }
        const prev = arr[i - 1];
        ctx.quadraticCurveTo(prev.x, prev.y, (prev.x + p.x) / 2, (prev.y + p.y) / 2);
        ctx.lineTo(p.x, p.y);
      });
      ctx.stroke(); ctx.globalAlpha = 1;
    });
    [0, 1].forEach((pl) => pts[pl].forEach((p) => {
      const { n } = p;
      const played = p.beat <= playBeat;
      const near = played && (playBeat - p.beat) < 0.6;
      const col = pl === 0 ? C.p0 : C.p1;
      const fs = Math.round(15 + n.dur * 8 + (n.accent ? 6 : 0) + (near ? 4 : 0));
      ctx.save();
      ctx.globalAlpha = played ? 1 : 0.3;
      if (near) { ctx.shadowBlur = 24; ctx.shadowColor = C.glow; }
      ctx.fillStyle = col;
      ctx.font = `${fs}px Datatype, Galmuri11, monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(n.glyph || '◇', p.x, p.y);
      if (n.accent) {
        ctx.shadowBlur = 0; ctx.strokeStyle = col; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, fs * 0.72, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }));
    const px = left + Math.min(1, progress) * w;
    ctx.strokeStyle = C.play; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(px, top - 10); ctx.lineTo(px, top + h + 10); ctx.stroke();
  }

  // 맨 밑 댄서들
  drawDancers(ctx, W, H, t, playBeat);
}

// 2단계 오케스트라 총보 — 파트(발화)별 보표를 위아래로 쌓고, 각자 랜덤하게 입장해
// 동시에 겹쳐 흐른다. 재생 헤드가 좌→우로 지나며 울린 음표를 진하게 드러낸다.
function drawOrchestraScore(ctx, W, H, t, progress) {
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
  const O = orchestraScore;
  if (!O || !O.parts.length) return;
  const { parts, totalBeats, lo, span } = O;
  const playBeat = progress * totalBeats;

  const left = W * 0.07, w = W * 0.86;
  const top = H * 0.10, totalH = H * 0.66;
  const count = parts.length;
  const laneH = totalH / count;
  const beat2x = (b) => left + (b / totalBeats) * w;

  // 댄서용 — 플레이어별 가장 최근에 울린 음표가 몇 박 전이었는지.
  const recency = [null, null];

  parts.forEach((p, i) => {
    const laneTop = top + i * laneH;
    const mid = laneTop + laneH * 0.5;
    const col = '#000';

    // 보표 기준선(아주 옅게) + 왼쪽 파트 마커
    ctx.strokeStyle = 'rgba(0,0,0,0.10)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(left, mid + 0.5); ctx.lineTo(left + w, mid + 0.5); ctx.stroke();
    ctx.fillStyle = p.player === 0 ? '#000' : 'rgba(0,0,0,0.45)';
    ctx.fillRect(left - 18, mid - 4, 8, 8);

    // 음표 좌표
    const ppts = p.notes.map((n) => {
      const absBeat = p.startBeat + n.beat;
      const x = beat2x(absBeat);
      const y = mid - (((n.midi - lo) / span) - 0.5) * laneH * 0.62;
      return { x, y, absBeat, n };
    });

    // 입장 표식 — 파트 시작점 작은 세로 괄호
    const sx = beat2x(p.startBeat);
    ctx.strokeStyle = 'rgba(0,0,0,0.30)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(sx, laneTop + laneH * 0.18); ctx.lineTo(sx, laneTop + laneH * 0.82); ctx.stroke();

    // 파트 윤곽선(연주된 구간은 진하게, 앞으로 올 구간은 옅게)
    for (let k = 1; k < ppts.length; k++) {
      const a = ppts[k - 1], b = ppts[k];
      const played = b.absBeat <= playBeat;
      ctx.strokeStyle = col;
      ctx.globalAlpha = played ? 0.55 : 0.14;
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // 음표 머리(글리프)
    const fs = Math.max(9, Math.min(22, laneH * 0.42));
    ctx.font = `${fs}px Datatype, Galmuri11, monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ppts.forEach((pt) => {
      const played = pt.absBeat <= playBeat;
      const near = played && (playBeat - pt.absBeat) < 0.6;
      ctx.fillStyle = col;
      ctx.globalAlpha = played ? 1 : 0.22;
      ctx.fillText(pt.n.glyph || '◇', pt.x, pt.y + (near ? -2 : 0));
      if (played) {
        const r = playBeat - pt.absBeat;
        if (recency[p.player] == null || r < recency[p.player]) recency[p.player] = r;
      }
    });
    ctx.globalAlpha = 1;
  });

  // 재생 헤드
  const px = left + Math.max(0, Math.min(1, progress)) * w;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(px, top - 8); ctx.lineTo(px, top + totalH + 8); ctx.stroke();

  drawDancers(ctx, W, H, t, playBeat, recency);
}

// 스코어 테마 전용 — 크세나키스풍 "루드 라인 듀엣".
// 두 화자의 선율선을 자로 그은 직선으로 잇고, 그 사이를 직선 다발로 짜서
// 글리산도 면을 만든다(연주 진행에 따라 왼→오른쪽으로 자라남). 글로우·악센트 고리 없음.
function drawRuledScore(ctx, pts, g) {
  const { left, top, w, h, playBeat, headFrac } = g;
  const INK = '#000';

  // 1) 관계의 그물 — 음표를 시간순으로 늘어놓고, 각 음표에서 뒤따르는 여러 음표로
  //    사선을 긋는다(콜&리스폰스). 서로 다른 시점의 점을 잇기 때문에 단순한 수직선이
  //    아니라, 점마다 앞뒤 관계가 드러나는 사선 그물(크세나키스풍 부채꼴)이 짜인다.
  //    가까운 관계일수록 진하게, 먼 관계일수록 옅게.
  const seq = [...pts[0], ...pts[1]]
    .filter((p) => p.beat <= playBeat)
    .sort((a, b) => a.beat - b.beat);
  const REACH = 5;
  ctx.lineWidth = 1; ctx.strokeStyle = INK;
  for (let i = 0; i < seq.length; i++) {
    for (let r = 1; r <= REACH && i + r < seq.length; r++) {
      const alpha = 0.20 - (r - 1) * 0.032;
      if (alpha <= 0) continue;
      const a = seq[i], c = seq[i + r];
      ctx.globalAlpha = alpha;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke();
    }
  }

  // 1b) 두 성부 사이의 짜임(weave) — 한 성부의 음표에서 시간상 가까운 반대 성부 음표
  //     몇 개로 옅은 직선 다발을 보낸다. 두 언어 사이가 면(面)처럼 엮여 풍부해진다.
  const A = pts[0].filter((p) => p.beat <= playBeat);
  const B = pts[1].filter((p) => p.beat <= playBeat);
  if (A.length && B.length) {
    ctx.strokeStyle = INK;
    for (const a of A) {
      // 시간상 가장 가까운 반대 성부 음표 2개
      let near = B
        .map((b) => ({ b, d: Math.abs(b.beat - a.beat) }))
        .sort((x, y) => x.d - y.d)
        .slice(0, 2);
      for (let j = 0; j < near.length; j++) {
        ctx.globalAlpha = 0.10 - j * 0.04;
        if (ctx.globalAlpha <= 0) continue;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(near[j].b.x, near[j].b.y); ctx.stroke();
      }
    }
  }
  ctx.globalAlpha = 1;

  // 2) 각 성부의 선율선 — 가는 직선 글리산도. 연주분은 진하게, 미연주분은 옅게.
  [0, 1].forEach((pl) => {
    const arr = pts[pl]; if (arr.length < 2) return;
    ctx.strokeStyle = INK; ctx.lineWidth = 1;
    for (let i = 1; i < arr.length; i++) {
      const a = arr[i - 1], c = arr[i];
      ctx.globalAlpha = c.beat <= playBeat ? 0.5 : 0.16;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  });

  // 3) 음표 머리 = 타이핑한 글리프. 균일한 작은 크기, 장식 없음.
  //    지금 울리는 음표만 살짝 키우고 가는 원으로 표시(글로우 X).
  [0, 1].forEach((pl) => pts[pl].forEach((p) => {
    const { n } = p;
    const played = p.beat <= playBeat;
    const near = played && (playBeat - p.beat) < 0.5;
    const fs = Math.round(15 + (near ? 5 : 0));
    ctx.save();
    ctx.globalAlpha = played ? 1 : 0.22;
    ctx.fillStyle = INK;
    ctx.font = `${fs}px Datatype, Galmuri11, monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(n.glyph || '◇', p.x, p.y);
    if (near) {
      ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.arc(p.x, p.y, fs * 0.78, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }));

  // 4) 플레이헤드 — 가는 1px 직선(현재 페이지 안에서의 위치).
  const px = left + Math.max(0, Math.min(1, headFrac)) * w;
  ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.globalAlpha = 0.55;
  ctx.beginPath(); ctx.moveTo(px, top - 12); ctx.lineTo(px, top + h + 12); ctx.stroke();
  ctx.globalAlpha = 1;
}

// 그동안 "말한 캐릭터들"을 모두 모은다(게임 중 캐릭터를 바꿔가며 말했어도 전부).
//  → [{ pick: 캐릭터인덱스, player: 0|1 }]  (등장 순서대로, 중복 제거)
function spokenChars() {
  const seen = new Map();   // pick → player(처음 그 캐릭터로 말한 사람)
  for (const m of state.messages) {
    const pk = (m.pick != null) ? m.pick : state.picks[m.player];
    if (!seen.has(pk)) seen.set(pk, m.player);
  }
  if (!seen.size) { seen.set(state.picks[0], 0); seen.set(state.picks[1], 1); }
  return [...seen.entries()].map(([pick, player]) => ({ pick, player }));
}

// 말한 캐릭터들이 오른쪽 아래 구석에 작게, 흩어져서 춤춘다. 자기 음표가 울릴 때마다 깡총 뛴다.
function drawDancers(ctx, W, H, t, playBeat, recencyOverride) {
  const chars = spokenChars();
  const count = chars.length;
  const recency = recencyOverride || lastNoteRecency(playBeat);
  // 작게 — 등장 수가 많을수록 더 줄여 구석에 다 들어가게
  const size = Math.max(26, Math.min(50, (W * 0.34) / Math.max(count, 3)));
  // 배치 영역: 오른쪽 아래 (리플레이 버튼과 안 겹치게 그 위/오른쪽)
  const rx0 = W * 0.62, rx1 = W * 0.96;   // 가로 범위
  const ry0 = H * 0.60, ry1 = H * 0.90;   // 발 바닥선 세로 범위
  for (let i = 0; i < count; i++) {
    const { pick, player } = chars[i];
    // pick/i 기반 결정적 난수 — 매 프레임 같은 자리(깜빡임 없음), 보기엔 랜덤하게 흩어짐
    const seed = ((pick + 1) * 2654435761 + i * 40503) >>> 0;
    const rndA = (seed % 997) / 997;
    const rndB = ((Math.imul(seed, 7) + 13) >>> 0) % 991 / 991;
    const baseX = rx0 + rndA * (rx1 - rx0);
    const baseY = ry0 + rndB * (ry1 - ry0);
    const phase = rndA * 6.28;
    const bob = Math.sin(t * 3 + phase) * size * 0.10;
    const sway = Math.sin(t * 2 + phase) * size * 0.05;
    const r = recency[player];
    const hop = (r != null && r < 0.5) ? -Math.sin((0.5 - r) / 0.5 * Math.PI) * size * 0.32 : 0;
    const talk = r != null && r < 0.22;
    paintChar(pick, baseX - size / 2 + sway, baseY - size + bob + hop, size, t + phase, talk, 'happy', player === 1);
  }
}

// 엔딩 합주용 리듬 — 플레이어별로 "한 트랙"씩 만든다(딱 2개 목소리만 동시에).
// 각 플레이어가 그동안 보낸 메시지들의 리듬을 시간순으로 이어 붙여 하나의 긴 연주로.
// 메시지 사이엔 작은 숨(GAP)을 둔다. 이렇게 하면 합주가 "두 사람의 대화"처럼 들리고,
// 13덩어리를 동시에 트는 과부하(무음/뭉개짐)도 사라진다.
function ensembleRhythms() {
  // 메시지마다 붙은 실제 리듬을 쓴다(두 화자 모두 빠짐없이). 없으면 글자로 합성.
  const chunks = state.messages.map((m) => {
    const real = m.rhythm && m.rhythm.length
      ? m.rhythm.filter((e) => e.ch && e.ch !== ' ' && e.ch !== '\n')
      : null;
    const events = (real && real.length)
      ? real
      : [...(m.text || '')].filter((c) => c !== ' ' && c !== '\n').map((ch, i) => ({ rel: i * 0.18, ch }));
    return { player: m.player, voiceId: m.voiceId != null ? m.voiceId : characterVoice(m.pick != null ? m.pick : state.picks[m.player]), events };
  }).filter((r) => r.events.length);

  const GAP = 0.3;                       // 메시지 사이 숨(초)
  const tracks = [null, null];           // 플레이어 0/1 트랙
  const cursor = [0, 0];                 // 각 트랙의 현재 끝 시각(초)

  // 상한 없이 — 타이핑한 모든 글자가 합주에 다 들어간다(잘리지 않게).
  chunks.forEach((c) => {
    const pl = (c.player === 1) ? 1 : 0;
    if (!tracks[pl]) tracks[pl] = { voiceId: c.voiceId, events: [] };
    let span = 0;
    c.events.forEach((e) => {
      tracks[pl].events.push({ rel: cursor[pl] + e.rel, ch: e.ch });
      if (e.rel > span) span = e.rel;
    });
    cursor[pl] += span + GAP;
  });

  return tracks.filter((t) => t && t.events.length);
}

// 1단계 — 순차 듀엣: 두 사람이 말한 순서대로 한 줄 악보로 연주한다(현행).
//          이게 끝나면 onDone에서 2단계(오케스트라 합주)로 넘어간다.
function startEndingScore() {
  stopEndingScore();
  resumeAudio();   // 긴 플레이로 컨텍스트가 멈춰 있어도 엔딩 소리가 나오게
  endingPhase = 1;
  orchestraScore = null;
  endingScore = buildScore();   // 그리기(악보 시각화)는 그대로 이 데이터로
  // 1단계 소리 — 라이브에서 아껴둔 "원래 읽어주는 소리"로 대화를 악보처럼 차례로 재생하고,
  // 각 문장 끝에 그때 투표된 문장부호(뉘앙스)를 발음한다. 이것이 곧 악보화다.
  const msgs = state.messages.filter((m) => m.rhythm && m.rhythm.length);
  const timers = [];
  let tSec = 0.2;
  const GAP = 0.55;                                    // 문장 사이 숨
  msgs.forEach((m) => {
    const last = m.rhythm[m.rhythm.length - 1];
    const dur = (last ? last.rel : 0) + 0.5;           // 이 발화의 실제 길이
    timers.push(setTimeout(() => speakVoiceEvents(m.rhythm, m.voiceId, m.mood), tSec * 1000));
    timers.push(setTimeout(() => playMark(m.nuance || 'period', 0, 0.9), (tSec + dur) * 1000));  // 문장부호
    tSec += dur + GAP;
  });
  scoreTotalMs = Math.max(1000, tSec * 1000);          // 그리기 진행도 재생 길이에 맞춤
  scoreStartWall = performance.now() + 200;
  // 순차 듀엣이 끝나면 곧바로 오케스트라(합주) 단계로.
  timers.push(setTimeout(() => {
    if (endingPhase === 1 && state.screen === 'ending') startOrchestraPhase();
  }, scoreTotalMs + 400));
  stopScore = () => timers.forEach(clearTimeout);
  // 승자 뉘앙스 이펙트(applyNuanceEffect)는 목소리 버스에 걸려 있어 발화에 입혀진다.
  // 실제 그리기는 메인 loop()의 ending 분기에서 매 프레임 수행한다.
}

// 2단계 — 오케스트라 합주: 각 발화(파트)의 시작 시각을 랜덤하게 흩어 동시에 겹쳐 연주하고,
//          오케스트라 총보처럼 파트별 보표를 위아래로 쌓아 보여준다.
function startOrchestraPhase() {
  resumeAudio();
  endingPhase = 2;
  orchestraScore = buildOrchestra();
  if (!orchestraScore) { endingPhase = 0; return; }
  const spb = 60 / SCORE_TEMPO;
  scoreTotalMs = orchestraScore.totalBeats * spb * 1000;
  scoreStartWall = performance.now() + 150;
  // 파트마다 실제 리듬을 트랙으로 — startBeat(랜덤 입장)을 offset(초)으로 준다.
  const tracks = orchestraScore.parts.map((p) => ({
    voiceId: p.voiceId,
    offset: p.startBeat * spb,
    events: (p.events || []).filter((e) => e.ch && e.ch !== ' ' && e.ch !== '\n'),
  })).filter((t) => t.events.length);
  if (tracks.length) {
    const duration = scoreTotalMs / 1000;
    stopEnsemble = playEnsemble(tracks, { speed: 1, duration, loop: false });
  }
}

function stopEndingScore() {
  if (stopScore) { stopScore(); stopScore = null; }
  if (stopEnsemble) { stopEnsemble(); stopEnsemble = null; }
  if (scoreAnim) { cancelAnimationFrame(scoreAnim); scoreAnim = null; }
  endingPhase = 0;
  orchestraScore = null;
}

function showEnding() {
  if (state.ended) return;   // 이미 엔딩에 들어갔으면 무시(악보·합주 재시작으로 인한 무음 방지)
  state.ended = true;
  const n0 = characterName(state.picks[0]);
  const n1 = characterName(state.picks[1]);
  const end = HAPPY_ENDINGS[Math.floor(Math.random() * HAPPY_ENDINGS.length)];
  const di = Math.floor(Math.random() * 3);
  const descsKo = [
    `${n0}와 ${n1}는 말이 달라도 서로를 알아보았다.`,
    `완벽하진 않았지만, ${n0}와 ${n1} 사이엔 분명 무언가 오갔다.`,
    `${n0}와 ${n1}는 마침내 같은 마음에 도착했다.`,
  ];
  const descsEn = [
    `${n0} and ${n1} recognized each other despite different words.`,
    `It wasn't perfect, but something surely passed between ${n0} and ${n1}.`,
    `${n0} and ${n1} finally arrived at the same heart.`,
  ];
  // 화면 게이지는 따뜻하게 차오른 모습으로 — 늘 해피엔딩 연출
  const shown = 0.85;
  const pct = Math.round(shown * 100);
  // 스코어 테마: 엔딩 문구 없이 숫자만 (예: "9 · 85%")
  $('#ending-title').innerHTML = SCORE ? '' : MINIMAL
    ? `${end.ko}<br><span class="en">${end.en}</span>`
    : end.ko;
  $('#ending-desc').innerHTML = SCORE ? '' : MINIMAL
    ? `${descsKo[di]}<br><span class="en">${descsEn[di]}</span>`
    : descsKo[di];
  $('#ending-fill').style.width = `${pct}%`;
  $('#ending-fill').style.background = connColor(shown);
  $('#ending-stat').innerHTML = SCORE
    ? `소통 ${pct}% · 주고받은 말 ${state.messages.length}마디<br><span class="en">Communication ${pct}% · ${state.messages.length} interactions</span>`
    : MINIMAL
    ? `주고받은 말 ${state.messages.length}마디 · 소통 ${pct}%  /  ${state.messages.length} words exchanged · ${pct}% rapport`
    : `주고받은 말 ${state.messages.length}마디 · 소통 ${pct}%`;
  show('ending');
  // 대화가 하나의 악보가 되어 연주된다
  startEndingScore();
}

// 대화를 "스코어"로 — 보낸 말을 외계 기호로 바꿔, 글자 하나하나를
// 그리드의 빈 칸 중 랜덤한 위치에 흩뿌린다. 플레이어 색으로 누구 말인지 구분.
function addBubble(player, text) {
  if (!gridCells.length) buildGrid();
  const color = characterColor(state.picks[player]);
  const alien = toAlien(text, characterVoice(state.picks[player]));
  for (const ch of alien) {
    if (ch === ' ' || ch === '\n') continue;
    if (!placeGlyph(ch, color)) break;   // 그리드가 꽉 차면 멈춘다
  }
}

function passTurn() {
  hidden.value = '';
  state.input = '';
  typeEvents = [];
  state.turn = 1 - state.turn;
  pickRandomActive();   // Tab — 다음 칠 캐릭터를 4명 중 무작위로 다시 뽑는다
}

// ===== 입력 이벤트 =====
// 타이핑 리듬 기록 — 키를 누른 시각과 글자를 그대로 적어 두었다가
// 전송 시 "친 그대로" 정확히 반복 재생한다.
let typeEvents = [];   // [{ t: ms, ch }]

// 기록된 키 입력 → 첫 키 기준 상대시각(초) + 글자. 클램프 없이 정확히 그대로.
function buildRhythmEvents() {
  if (!typeEvents.length) return [];
  const t0 = typeEvents[0].t;
  return typeEvents.map((e) => ({ rel: (e.t - t0) / 1000, ch: e.ch }));
}

// 텍스트 동기화만 담당(소리는 keydown에서 모든 키에 대해 낸다)
hidden.addEventListener('input', () => {
  if (state.screen !== 'play') return;
  state.input = hidden.value;
  renderInput();
});

const IGNORE_KEYS = ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock',
  'Enter', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

window.addEventListener('keydown', (e) => {
  if (state.screen === 'ending' && e.key === 'Escape') { e.preventDefault(); stopEndingScore(); show('title'); return; }
  if (state.screen !== 'play') return;
  if (e.key === 'Escape') { e.preventDefault(); show('title'); return; }
  if (state.phase !== 'round') return;   // 예비박·선물 단계에선 타이핑 잠금
  const mod = e.ctrlKey || e.metaKey;

  // 어떤 키든(자음 단독·한글 조합 중 포함) 타건음을 낸다.
  if (!mod && !IGNORE_KEYS.includes(e.key)) {
    const ch = (e.key && e.key.length === 1) ? e.key : null;
    typeVoice(e.key, base(state.turn), characterVoice(state.picks[state.turn]));   // 타자 = 캐릭터 목소리(뉘앙스가 억양을 바꾼다)
    typeEvents.push({ t: performance.now(), ch }); // 친 시각+글자 그대로 기록
    lastKeyAt = performance.now();                 // 듀엣 연출 — 입 움직임 타이밍
  }

  if (e.isComposing) return; // 한글 조합 중엔 Enter/Tab 등 가로채지 않음
  if (e.key === 'Enter') { e.preventDefault(); sendMessage(); }
  else if (e.key === 'Tab') { e.preventDefault(); passTurn(); }
  else if (e.key === 'Escape') { e.preventDefault(); show('title'); }
  else { hidden.focus(); }
});
// 클릭으로 포커스 잃지 않도록
$('#screen-play').addEventListener('mousedown', (e) => {
  if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
  setTimeout(() => hidden.focus(), 0);
});

// ===== 버튼 핸들러 =====
document.body.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action], [data-pick-prev], [data-pick-next], [data-pick-set], [data-dex]');
  if (!btn) return;
  const act = btn.dataset.action;
  if (act === 'start') {
    // 첫 클릭은 오디오를 깨우고 리버스 스웰 인트로를 시작한다(머문다).
    // 같은 제스처로 바로 넘어가면 인트로가 안 들리므로, 방금 깨운
    // 경우엔 화면을 넘기지 않고 인트로를 들려준다(끝나면 자동 전환).
    if (!audioReady || performance.now() - audioWokenAt < 600) { ensureAudio(); return; }
    // 인트로 도중 다시 누르면 건너뛰고 바로 캐릭터 선택으로.
    clearTimeout(titleIntroTimer); titleIntroTimer = null;
    updateSelectUI(); show('select');
  }
  else if (act === 'random') { uiClick(Math.random()); randomMatch(); }
  // 대화 시작 — 이해도 설정 건너뜀(모두 미지의 언어). 스코어 도감은 고르기를 안 하므로
  // 플레이할 두 캐릭터를 이때 무작위로 배정한다(인게임 좌/우 열에서 교체 가능).
  else if (act === 'to-setup') { uiClick(0.75); if (SCORE) randomMatch(); show('play'); }
  else if (act === 'to-select') { uiClick(0.4); show('select'); }
  else if (act === 'slot-pull') { pullSlot(); }
  else if (act === 'mark-tap') { castVote(btn.dataset.mark, 'perf'); }
  else if (act === 'round-stop') { endCycle(); }
  else if (act === 'to-ending') { uiClick(0.7); giftDoneToEnding(); }
  else if (act === 'play') { uiClick(0.75); show('play'); }
  else if (act === 'replay-score') { startEndingScore(); }
  else if (act === 'restart') { stopEndingScore(); resetNuanceEffect(); show('title'); }
  if (btn.dataset.pickPrev !== undefined) { uiClick(0.35); cyclePick(+btn.dataset.pickPrev, -1); }
  if (btn.dataset.pickNext !== undefined) { uiClick(0.6); cyclePick(+btn.dataset.pickNext, +1); }
  if (btn.dataset.pickSet !== undefined) {
    uiClick(0.5);
    // 스코어: 'turn' → 지금 차례인 사람의 캐릭터를 바꾼다.
    const who = btn.dataset.pickSet === 'turn' ? state.turn : +btn.dataset.pickSet;
    setPick(who, +btn.dataset.idx);
  }
  if (btn.dataset.dex !== undefined) { uiClick(0.5); dexView = +btn.dataset.dex; highlightDex(); }
});

// ===== 시작 =====
resize();
buildPickColumns();   // 플레이 중 좌/우 캐릭터 선택 열 생성
if (SCORE) setupGift();   // 선물 아이콘 + 드래그&드롭(리버브) 준비
if (SCORE) setupAudience();   // 관객 폰 실시간 부호 탭(SSE) 연결 준비
buildDex();           // 스코어 테마: 도감 그리드 생성
updateSelectUI();
requestAnimationFrame(loop);
