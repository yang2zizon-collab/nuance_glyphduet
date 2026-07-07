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
  screen: 'title',        // 첫 화면은 타이틀. QR 화면은 캐릭터 소개가 끝난 뒤에 나온다
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
const GRID_CELL = 28;        // 한 칸의 대략 픽셀 크기(목표) — 작을수록 칸이 많다(타이핑 용량 ≈2배↑).
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
  qr: $('#screen-qr'),   // 관객 QR 대기화면(타이틀 앞)
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
  introScene = null;
  if (introTimer) { clearTimeout(introTimer); introTimer = null; }
  const sm = $('#slot-machine'); if (sm) sm.style.visibility = '';
  const nm = $('#slot-name'); if (nm) { nm.textContent = ''; nm.classList.remove('show'); }
  const cnt = $('#slot-count'); if (cnt) cnt.textContent = `0 / ${N}`;
  const st = $('#slot-start'); if (st) st.classList.remove('ready');
}

function pullSlot() {
  if (!SCORE || slotSpinning || slotIndex >= N || introScene) return;
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

// 릴이 멈춰 한 캐릭터에 착지했을 때 — 이름·카운트 갱신 + 소개 컷신 시작.
// 토마토(0)=덩굴밭 줌인 / 새(2)=심해어와 공동 '전화 발견' / 생쥐(3)=부엌 발·빗자루. 심해어(1)는 착지만.
function onSlotLanded() {
  const nm = $('#slot-name'); if (nm) { nm.textContent = characterName(slotDisplay); nm.classList.add('show'); }
  const cnt = $('#slot-count'); if (cnt) cnt.textContent = `${slotIndex} / ${N}`;
  const win = $('#slot-window'); if (win) { win.classList.remove('land'); void win.offsetWidth; win.classList.add('land'); }
  uiClick(0.85);   // 착지 딩
  slotLand();      // 밝은 화음으로 이완(릴리스)
  speakVoiceEvents([{ rel: 0, ch: 'a' }], characterVoice(slotDisplay), 'happy');
  const kind = slotDisplay === 0 ? 'tomato' : slotDisplay === 2 ? 'phone' : slotDisplay === 3 ? 'mouse' : null;
  if (kind) {
    introTimer = setTimeout(() => { introTimer = null; startIntroScene(kind); }, 750);
  } else if (slotIndex >= N) {
    const st = $('#slot-start'); if (st) st.classList.add('ready');
  }
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


// ===== 캐릭터 소개 컷신 (스토리보드 기반 재제작) =====
// 룰렛 착지 → 그 캐릭터의 소개 영상이 풀스크린 디더링(도트)으로 재생.
// 캐릭터만 컬러(별도 레이어), 배경은 흑백 망점. 재생 중 레버 잠금.
//  tomato: 토마토 덩굴밭 — 핑크토마토에게 서서히 줌인, 눈물 그렁그렁.
//  phone : (새+심해어 공동, 3비트) 새가 나무로 날아와 전화기 발견 →
//          심해어도 어두운 심해에서 폰 발견 → 둘이 수화기를 들고 "?" — 연결.
//  mouse : 부엌, 부스러기를 따라 쫄쫄쫄 → 빗자루가 들어와 쓸어냄, 줄행랑.
let introScene = null;    // { kind, start, dur, fx:{} }
let introTimer = null;    // 착지 후 컷신 시작 지연 타이머

// 장면 내부 시계 기준. 마지막 내레이션이 다 찍힌 뒤 **4초 이상** 머물고 넘어가도록 여유를 뒀다.
const INTRO_DUR = { tomato: 23000, phone: 22000, mouse: 19000 };
const INTRO_PACE = 1.25;  // 전체 호흡 — 클수록 컷신이 여유 있게 흐른다(내부 s가 1/PACE로 느려짐)
const TOMATO_CUT = 8.5;   // 토마토 장면 전환 시각(초) — 덩굴밭 → 상자
const MOUSE_CUT = 6.5;    // 생쥐 장면 전환 시각(초) — 밤거리 → 부엌
const PHONE_B2 = 5.4, PHONE_B3 = 10.8;   // 전화 컷신 비트 경계

// 컷신 내레이션 — 맨 아래 대화창에 한국어·영어 두 줄이 타이핑되고,
// 찍힌 지 조금 지난 글자들이 하나둘 외계어 글리프로 변해 간다(번역이 새는 느낌).
const INTRO_ALIEN = '◆●■▲▼◇○□△▽◐◑♪☆✳※⌘∿';
const INTRO_TYPE_CPS = 8;    // 초당 타이핑 글자 수 — 천천히, 읽는 호흡으로(영어는 길이 비례로 같이 끝남)
const INTRO_NARR = {
  tomato: [
    { at: 0.6, ko: '초록의 물결 아래, 붉은 열매들은 저마다의 작은 심장을 매달고 있었습니다.',
      en: 'Beneath a green tide, red fruits hung like small hearts.' },
    { at: 6.6, ko: '바람이 지날 때마다 밭은 낮게 웅성거리고, 익어가는 것들은 조용히 무거워집니다.',
      en: 'With every wind the field murmurs; what ripens grows quietly heavy.' },
    { at: 11.6, ko: '같은 상자에 담겨도 물들지 않는 색 하나 —',
      en: 'Boxed together, yet one color refuses to blend —' },
    { at: 15.0, ko: '핑토는 저만의 빛을 안고, 아무도 모르게 반짝였습니다…',
      en: 'Pinto held its own light, glimmering where no one looked…' },
  ],
  phone: [
    { at: 0.5, ko: '바람의 높이에서 사는 새가, 가지 끝에 놓인 낯선 기계와 마주쳤습니다.',
      en: 'A bird of the high winds met a strange machine at the branch’s end.' },
    { at: 3.2, ko: '반질반질한 침묵 — 그것은 아직 아무의 목소리도 아니었습니다.',
      en: 'A polished silence — not yet anyone’s voice.' },
    { at: 6.0, ko: '빛이 겨우 스미는 깊이에서, 심해어도 같은 꿈의 조각을 주웠습니다.',
      en: 'Where light barely seeps, the deep-sea fish found the same shard of a dream.' },
    { at: 8.9, ko: '어둠은 넓고, 그리움은 그보다 조금 더 넓습니다.',
      en: 'The dark is vast; longing, a little vaster.' },
    { at: 11.4, ko: '따르릉 — 하늘과 심해가 한 가닥의 선으로 이어지는 순간.',
      en: 'Ring — sky and abyss, joined by a single thread.' },
    { at: 14.6, ko: '서로 다른 두 물이, 같은 파문으로 흔들립니다.',
      en: 'Two different waters tremble in the same ripple.' },
  ],
  mouse: [
    { at: 0.5, ko: '가로등이 하나둘 켜지는 밤, 작은 발자국이 도시의 골목을 꿰매며 달립니다.',
      en: 'As lamps blink on, small footsteps stitch through the city’s alleys.' },
    { at: 3.6, ko: '도시는 크고, 배고픔은 그보다 빠릅니다.',
      en: 'The city is big; hunger is faster.' },
    { at: 7.2, ko: '떨어진 부스러기는 길이 되고, 그 길은 어느 부엌의 온기로 이어졌습니다.',
      en: 'Fallen crumbs became a road, and the road led to a kitchen’s warmth.' },
    { at: 9.9, ko: '쓱쓱 — 빗자루의 파도가 작은 손님을 문밖으로 밀어냅니다.',
      en: 'Swish — a broom’s wave pushes the little guest out.' },
    { at: 13.2, ko: '그래도 생쥐는, 다시 빼꼼.',
      en: 'And yet, the mouse peeks again.' },
  ],
};
const INTRO_PX = 2.0;     // 도트 한 알의 크기(CSS px) — 촘촘할수록 실사에 가깝다
let introCanvas = null, introCtx = null;
let introLayerCache = {};   // 정적 배경 플레이트 캐시 — 컷신 시작마다 비운다(프레임드랍 방지)
let introColorCanvas = null, introColorCtx = null;   // 캐릭터(컬러) 레이어
const BAYER8 = [
  [0, 32, 8, 40, 2, 34, 10, 42], [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38], [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41], [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37], [63, 31, 55, 23, 61, 29, 53, 21],
];
function ditherIntroCanvas() {
  // 프레임드랍 최적화 — 문턱값을 정수(0~765)로 미리 계산하고, 픽셀 쓰기는 Uint32 한 번으로.
  const w = introCanvas.width, h = introCanvas.height;
  const img = introCtx.getImageData(0, 0, w, h);
  const d = img.data;
  const u32 = new Uint32Array(d.buffer);
  if (!ditherIntroCanvas._th) {
    ditherIntroCanvas._th = BAYER8.map((row) => row.map((v) => ((v + 0.5) / 64) * 765));
  }
  const TH = ditherIntroCanvas._th;
  let p = 0;
  for (let y = 0; y < h; y++) {
    const row = TH[y & 7];
    for (let x = 0; x < w; x++, p++) {
      const i = p << 2;
      u32[p] = (d[i] + d[i + 1] + d[i + 2]) > row[x & 7] ? 0xFFFFFFFF : 0xFF000000;
    }
  }
  introCtx.putImageData(img, 0, 0);
}

function startIntroScene(kind) {
  if (state.screen !== 'select') return;
  introScene = { kind, start: performance.now(), dur: (INTRO_DUR[kind] || 8000) * INTRO_PACE, fx: {} };
  introLayerCache = {};   // 새 컷신 — 배경 플레이트 다시 굽기
  const sm = $('#slot-machine'); if (sm) sm.style.visibility = 'hidden';
}
function endIntroScene() {
  introScene = null;
  const sm = $('#slot-machine'); if (sm) sm.style.visibility = '';
  if (slotIndex >= N) { const st = $('#slot-start'); if (st) st.classList.add('ready'); }
}
function fxOnce(key, fn) { if (!introScene.fx[key]) { introScene.fx[key] = true; fn(); } }
const easeIO = (u) => u < 0 ? 0 : u > 1 ? 1 : u * u * (3 - 2 * u);
const seg2 = (s, a, b) => easeIO((s - a) / (b - a));

function drawIntroMark(ctx, ch, x, y, px, alpha = 1, color = '#000') {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.font = `${Math.round(px)}px Datatype, Galmuri11, monospace`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(ch, x, y);
  ctx.restore();
}

// 토마토 B컷 전용 — 참조 사진처럼 "풀컬러"로 밭·상자·토마토를 그린 배경 플레이트.
// 이 컷만 흑백 하프톤을 건너뛰고 컬러 레이어(cctx)에 통째로 blit한다. 무거우니 크기별로 1회 캐시.
let tomBColorCv = null;
function buildTomBColor(W, H, S) {
  if (tomBColorCv && tomBColorCv._w === W && tomBColorCv._h === H) return tomBColorCv;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const crL = W * 0.2, crR = W * 0.74, crT = H * 0.44, crB = H * 0.86;
  const oxP = W * 0.06, oyP = H * 0.055;
  // 하늘/햇빛 하즈 — 위는 밝은 연둣빛, 아래로 짙은 초록
  let grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#e2f1cf'); grad.addColorStop(0.4, '#a4c46e'); grad.addColorStop(0.72, '#628c3a'); grad.addColorStop(1, '#3d5a25');
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  // 우거진 잎덩이 — 초록 밭(블러). 위·오른쪽일수록 밝다(역광).
  g.filter = 'blur(6px)';
  for (let i = 0; i < 110; i++) {
    const bx = hash01(i * 3.3 + 1.1) * W, by = H * (-0.03 + hash01(i * 7.1 + 2.7) * 0.72);
    const br = S * (0.26 + hash01(i * 11.7 + 0.5) * 0.62);
    const lit = (1 - by / (H * 0.72)) * 0.55 + (bx / W) * 0.22 + (hash01(i * 5.3) - 0.5) * 0.28;
    const R = Math.max(20, Math.min(215, 70 + lit * 150));
    const Gc = Math.max(45, Math.min(240, 115 + lit * 150));
    const B = Math.max(12, Math.min(150, 38 + lit * 90));
    const rg = g.createRadialGradient(bx - br * 0.3, by - br * 0.35, br * 0.08, bx, by, br);
    rg.addColorStop(0, `rgb(${Math.min(255, R + 40)},${Math.min(255, Gc + 45)},${Math.min(255, B + 30)})`);
    rg.addColorStop(1, `rgb(${Math.max(0, R - 35)},${Math.max(0, Gc - 35)},${Math.max(0, B - 30)})`);
    g.fillStyle = rg;
    g.beginPath(); g.ellipse(bx, by, br, br * 0.82, hash01(i) * 3, 0, 7); g.fill();
  }
  // 햇빛 역광 번짐(오른쪽 위)
  const sun = g.createRadialGradient(W * 0.72, H * 0.13, 0, W * 0.72, H * 0.13, H * 0.6);
  sun.addColorStop(0, 'rgba(255,252,225,0.8)'); sun.addColorStop(1, 'rgba(255,252,225,0)');
  g.fillStyle = sun; g.fillRect(0, 0, W, H * 0.8);
  // 햇빛 보케
  for (let i = 0; i < 18; i++) {
    const bx = W * (0.25 + hash01(i * 9.7 + 3) * 0.7), by = H * (0.02 + hash01(i * 4.1 + 5) * 0.46);
    const br = S * (0.07 + hash01(i * 6.3) * 0.16), a = 0.2 + hash01(i * 2.9) * 0.4;
    const bk = g.createRadialGradient(bx, by, 0, bx, by, br);
    bk.addColorStop(0, `rgba(240,255,210,${a})`); bk.addColorStop(0.7, `rgba(230,250,200,${a * 0.5})`); bk.addColorStop(1, 'rgba(230,250,200,0)');
    g.fillStyle = bk; g.beginPath(); g.arc(bx, by, br, 0, 7); g.fill();
  }
  g.filter = 'none';
  // 잔디밭(아래)
  grad = g.createLinearGradient(0, H * 0.6, 0, H);
  grad.addColorStop(0, '#5e7c35'); grad.addColorStop(0.5, '#43622b'); grad.addColorStop(1, '#29411d');
  g.fillStyle = grad; g.fillRect(0, H * 0.6, W, H * 0.4);
  g.lineCap = 'round';
  for (let i = 0; i < 150; i++) {
    const gx = hash01(i * 13.7 + 0.3) * W, gy = H * (0.62 + hash01(i * 7.9 + 1.2) * 0.36);
    const gl = S * (0.09 + hash01(i * 3.1 + 0.7) * 0.2) * (gy / H + 0.4);
    const lean = (hash01(i * 5.7 + 2.1) - 0.5) * S * 0.18;
    const gt = 45 + Math.floor(hash01(i * 9.1 + 4) * 80);
    g.strokeStyle = `rgba(${Math.floor(gt * 0.6)},${gt + 40},${Math.floor(gt * 0.4)},0.92)`;
    g.lineWidth = 1.4 + hash01(i * 2.3 + 1) * 1.9;
    g.beginPath(); g.moveTo(gx, gy); g.quadraticCurveTo(gx + lean * 0.4, gy - gl * 0.6, gx + lean, gy - gl); g.stroke();
  }
  // 상자 바닥 그림자
  g.save(); g.translate(W * 0.5 + oxP, crB + S * 0.1); g.scale(1, 0.3);
  const sh = g.createRadialGradient(0, 0, 0, 0, 0, (crR - crL) * 0.72);
  sh.addColorStop(0, 'rgba(0,0,0,0.45)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = sh; g.beginPath(); g.arc(0, 0, (crR - crL) * 0.72, 0, 7); g.fill(); g.restore();
  // 붉은 토마토(광택 + 초록 꽃받침)
  const redTom = (bx, by, r, green) => {
    const rg = g.createRadialGradient(bx - r * 0.34, by - r * 0.4, r * 0.1, bx, by, r);
    if (green) { rg.addColorStop(0, '#cbd96c'); rg.addColorStop(0.55, '#8fae3e'); rg.addColorStop(1, '#4f6a22'); }
    else { rg.addColorStop(0, '#ff6a4a'); rg.addColorStop(0.5, '#e02f22'); rg.addColorStop(1, '#8f160f'); }
    g.fillStyle = rg; g.beginPath(); g.arc(bx, by, r, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.beginPath(); g.ellipse(bx - r * 0.36, by - r * 0.42, r * 0.18, r * 0.1, -0.6, 0, 7); g.fill();
    g.strokeStyle = '#3c6a28'; g.lineCap = 'round';
    for (let p2 = 0; p2 < 5; p2++) {
      const a = p2 * (Math.PI * 2 / 5) - Math.PI / 2 + 0.3;
      g.lineWidth = Math.max(1.6, r * 0.14);
      g.beginPath(); g.moveTo(bx, by - r * 0.86);
      g.quadraticCurveTo(bx + Math.cos(a) * r * 0.5, by - r * 0.9 + Math.sin(a) * r * 0.22, bx + Math.cos(a) * r * 0.9, by - r * 0.66 + Math.sin(a) * r * 0.5);
      g.stroke();
    }
    g.lineWidth = Math.max(1.6, r * 0.12);
    g.beginPath(); g.moveTo(bx, by - r * 0.88); g.lineTo(bx - r * 0.06, by - r * 1.12); g.stroke();
  };
  // 상자 윗면 개구부(어두운 안쪽)
  g.fillStyle = '#2a1c12';
  g.beginPath(); g.moveTo(crL + oxP, crT - oyP); g.lineTo(crR + oxP, crT - oyP); g.lineTo(crR, crT); g.lineTo(crL, crT); g.closePath(); g.fill();
  // 무더기 뒷줄
  [[0.26, 1], [0.35, 0.85], [0.45, 0.95], [0.55, 0.85], [0.65, 0.9], [0.73, 0.8]].forEach(([fx, k]) => redTom(W * fx + oxP * 0.7, crT - oyP * 0.55 - S * 0.08 * k, S * 0.23 * k, false));
  // 무더기 앞줄(+접촉 그림자). 가운데 두 알은 작게 — 핑토가 그 사이에 앉는다.
  [[0.25, 1.0], [0.36, 0.88], [0.44, 0.76], [0.56, 0.76], [0.64, 0.9], [0.74, 1.0]].forEach(([fx, k]) => {
    g.fillStyle = 'rgba(40,10,8,0.4)';
    g.beginPath(); g.ellipse(W * fx, crT + S * 0.1, S * 0.22 * k, S * 0.06 * k, 0, 0, 7); g.fill();
    redTom(W * fx, crT - S * 0.1, S * 0.28 * k, false);
  });
  // 앞면 슬랫(밝은 나무 + 나뭇결)
  const slatN = 4, slatH = (crB - crT) / slatN;
  for (let i2 = 0; i2 < slatN; i2++) {
    const sy = crT + i2 * slatH;
    const wg = g.createLinearGradient(0, sy, 0, sy + slatH * 0.78);
    wg.addColorStop(0, '#e6bd7c'); wg.addColorStop(1, '#bd8c4c');
    g.fillStyle = wg; g.fillRect(crL, sy, crR - crL, slatH * 0.78);
    g.strokeStyle = 'rgba(80,50,20,0.7)'; g.lineWidth = 1.8; g.strokeRect(crL, sy, crR - crL, slatH * 0.78);
    g.strokeStyle = 'rgba(120,80,40,0.4)'; g.lineWidth = 1;
    for (let gr = 0; gr < 2; gr++) {
      g.beginPath(); g.moveTo(crL + 8, sy + slatH * (0.2 + gr * 0.3 + (i2 % 2) * 0.1));
      g.quadraticCurveTo(W * 0.47, sy + slatH * (0.32 + gr * 0.26), crR - 8, sy + slatH * (0.22 + gr * 0.3)); g.stroke();
    }
    g.fillStyle = i2 % 2 ? '#8a5f30' : '#946836';   // 오른쪽 옆면(그늘)
    g.beginPath(); g.moveTo(crR, sy); g.lineTo(crR + oxP, sy - oyP); g.lineTo(crR + oxP, sy - oyP + slatH * 0.78); g.lineTo(crR, sy + slatH * 0.78); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(60,38,16,0.6)'; g.lineWidth = 1.4; g.stroke();
  }
  // 윗테 립
  g.fillStyle = '#efc888'; g.fillRect(crL - S * 0.02, crT - S * 0.035, crR - crL + S * 0.04, S * 0.05);
  g.strokeStyle = 'rgba(80,50,20,0.7)'; g.lineWidth = 1.6; g.strokeRect(crL - S * 0.02, crT - S * 0.035, crR - crL + S * 0.04, S * 0.05);
  g.fillStyle = '#c8a060';
  g.beginPath(); g.moveTo(crR + S * 0.02, crT - S * 0.035); g.lineTo(crR + oxP + S * 0.015, crT - oyP - S * 0.03); g.lineTo(crR + oxP + S * 0.015, crT - oyP + S * 0.02); g.lineTo(crR + S * 0.02, crT + S * 0.015); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(60,38,16,0.6)'; g.lineWidth = 1.4; g.stroke();
  // 좌우 음영
  const csh = g.createLinearGradient(crL, 0, crR + oxP, 0);
  csh.addColorStop(0, 'rgba(255,240,200,0.16)'); csh.addColorStop(0.4, 'rgba(0,0,0,0)'); csh.addColorStop(1, 'rgba(20,10,0,0.3)');
  g.fillStyle = csh; g.fillRect(crL, crT - oyP, crR - crL + oxP, crB - crT + oyP);
  // 기둥
  const post = (cx, topY, botY, wP, t1, t2) => {
    const pg = g.createLinearGradient(cx - wP, 0, cx + wP, 0);
    pg.addColorStop(0, t1); pg.addColorStop(1, t2);
    g.fillStyle = pg; g.fillRect(cx - wP, topY, wP * 2, botY - topY);
    g.strokeStyle = 'rgba(60,38,16,0.7)'; g.lineWidth = 1.8; g.strokeRect(cx - wP, topY, wP * 2, botY - topY);
  };
  post(crR + oxP, crT - oyP - S * 0.04, crB - oyP + S * 0.04, S * 0.07, '#a5763c', '#7a5528');
  post(crL, crT - S * 0.05, crB + S * 0.05, S * 0.09, '#e8bd7c', '#bd8f50');
  post(crR, crT - S * 0.05, crB + S * 0.05, S * 0.09, '#dcb070', '#a87c44');
  // 바닥에 떨어진 토마토
  redTom(W * 0.1, crB - S * 0.08, S * 0.26, false);
  redTom(W * 0.92, crB - S * 0.2, S * 0.22, false);
  redTom(W * 0.17, crB + S * 0.12, S * 0.2, false);
  // 앞 풀
  g.lineCap = 'round';
  for (let i = 0; i < 30; i++) {
    const gx = hash01(i * 17.3 + 5) * W, gy = H * (0.88 + hash01(i * 7.3 + 2) * 0.12);
    const gl = S * (0.22 + hash01(i * 3.9 + 1) * 0.3), lean = (hash01(i * 5.1 + 3) - 0.5) * S * 0.24;
    const gt = 30 + Math.floor(hash01(i * 9.7) * 50);
    g.strokeStyle = `rgba(${Math.floor(gt * 0.5)},${gt + 30},${Math.floor(gt * 0.35)},0.95)`;
    g.lineWidth = 2 + hash01(i * 2.9) * 2;
    g.beginPath(); g.moveTo(gx, gy); g.quadraticCurveTo(gx + lean * 0.4, gy - gl * 0.6, gx + lean, gy - gl); g.stroke();
  }
  // 시네마틱 비네트(가장자리 살짝 어둡게)
  const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.42, W / 2, H / 2, Math.max(W, H) * 0.72);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.3)');
  g.fillStyle = vg; g.fillRect(0, 0, W, H);
  cv._w = W; cv._h = H;
  tomBColorCv = cv;
  return cv;
}

// 소개 컷신 배경 사진 — 사용자가 직접 넣은 사진(권리 보유분)을 흑백 도트로 필터링해 배경으로 쓴다.
//   assets/intro/tomato-a.(jpg|png) → 토마토 A컷, tomato-b.(jpg|png) → B컷.
//   파일이 없으면 손그림 폴백(현재 배경)을 그대로 쓴다. 저작권 있는 스톡 사진은 넣지 말 것.
const introPhotos = {};
function loadIntroPhoto(key, srcs, edge, pre) {
  if (introPhotos[key]) return;
  const ent = introPhotos[key] = { img: new Image(), ok: false, i: 0, styled: null };
  ent.img.onload = () => { ent.ok = true; ent.styled = cartoonizePhoto(pre ? pre(ent.img) : ent.img, edge); };
  ent.img.onerror = () => { ent.i++; if (ent.i < srcs.length) ent.img.src = srcs[ent.i]; };
  ent.img.src = srcs[0];
}

// 토마토 B 사진 합성 편집 — 상자를 절반 크기로, 토마토는 방울토마토 스케일로.
// ① 사진의 수풀 부분(상자 위 밴드)을 확대해 화면 전체 배경으로 깔고
// ② 상자 영역만 잘라 50%로 축소해(가장자리 페더 마스크) 하단 중앙에 얹는다. 그 뒤 카툰 필터.
function composeTomatoB(img) {
  const iw = img.naturalWidth, ih = img.naturalHeight; if (!iw || !ih) return img;
  const w = 1400, h = Math.round(ih * w / iw);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  g.imageSmoothingEnabled = true;
  // ① 배경 — 상자가 없는 위쪽 수풀 밴드를 전체로 확대 + 아래로 갈수록 그늘(땅 톤, 하이키에 안 씻기게)
  g.drawImage(img, 0, 0, iw, ih * 0.3, 0, 0, w, h);
  const gnd = g.createLinearGradient(0, h * 0.42, 0, h);
  gnd.addColorStop(0, 'rgba(30,36,24,0)'); gnd.addColorStop(1, 'rgba(30,36,24,0.6)');
  g.fillStyle = gnd; g.fillRect(0, h * 0.42, w, h * 0.58);
  // ② 상자 패치 — 상자+토마토 영역 크롭 → 50% 축소 → 살짝 어둡게(필터 하이키 보정) → 좁은 페더
  const cx0 = iw * 0.04, cy0 = ih * 0.25, cw0 = iw * 0.92, ch0 = ih * 0.72;
  const dw = w * 0.92 * 0.5, dh = dw * (ch0 / cw0);
  const patch = document.createElement('canvas'); patch.width = Math.ceil(dw); patch.height = Math.ceil(dh);
  const pg = patch.getContext('2d');
  pg.imageSmoothingEnabled = true;
  pg.drawImage(img, cx0, cy0, cw0, ch0, 0, 0, dw, dh);
  pg.globalCompositeOperation = 'source-atop';                       // 어둡게 — 미니멀 필터(하이키)에 안 날아가게
  pg.fillStyle = 'rgba(0,0,0,0.26)'; pg.fillRect(0, 0, dw, dh);
  const mask = pg.createRadialGradient(dw / 2, dh / 2, Math.max(dw, dh) * 0.36, dw / 2, dh / 2, Math.max(dw, dh) * 0.62);
  mask.addColorStop(0, 'rgba(0,0,0,1)'); mask.addColorStop(1, 'rgba(0,0,0,0)');
  pg.globalCompositeOperation = 'destination-in';
  pg.fillStyle = mask; pg.fillRect(0, 0, dw, dh);
  pg.globalCompositeOperation = 'source-over';
  // 바닥 그림자(살짝) → 패치 얹기
  const px0 = (w - dw) / 2, py0 = h * 0.9 - dh;
  const sh = g.createRadialGradient(w / 2, h * 0.88, 0, w / 2, h * 0.88, dw * 0.55);
  sh.addColorStop(0, 'rgba(0,0,0,0.4)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
  g.save(); g.translate(w / 2, h * 0.88); g.scale(1, 0.22); g.translate(-w / 2, -h * 0.88);
  g.fillStyle = sh; g.beginPath(); g.arc(w / 2, h * 0.88, dw * 0.55, 0, 7); g.fill(); g.restore();
  g.drawImage(patch, px0, py0);
  return cv;
}
function introPhotoReady(key) { const e = introPhotos[key]; return !!(e && e.ok && e.img.naturalWidth); }

// 살짝 만화 느낌 — 흑백 톤을 몇 단계로 뭉치고(포스터화) 가장자리에 은은한 잉크 선을 얹는다.
// 그 뒤 기존 dither가 도트로 바꾸면 "만화 스크린톤" 톤이 된다. 로드 시 1회만 만들어 캐시.
// 미니멀 흑백 — 대비 S커브로 중간톤을 흑/백으로 몰아 도트 노이즈를 줄이고(=깔끔),
// 톤을 몇 단계로만 뭉치고, 굵직한 윤곽선만 남긴다. 그 뒤 dither가 도트로. 로드 시 1회 캐시.
const CARTOON_LEVELS = 3;      // 톤 밴드 수 — 3단계(밝음/중간/어둠)로 미니멀
const CARTOON_EDGE = 122;      // 잉크 선 문턱 — 굵직한 윤곽선만 남겨 깔끔
const CARTOON_MIX = 0.82;      // 포스터화(평평·미니멀) 비중을 높게
const PHOTO_CONTRAST = 1.85;   // 대비 강하게 — 중간톤을 흑/백으로 몰아 도트 노이즈↓
const PHOTO_LIFT = 0.17;       // 하이키 — 밝은 곳을 흰색으로 날려 깨끗한 여백을 만든다
const PHOTO_BLUR = 6;          // 사전 블러(px) — 잔디테일을 뭉개 큰 형태만 남긴다(미니멀의 핵심)
function cartoonizePhoto(img, edge = CARTOON_EDGE) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height; if (!iw || !ih) return img;
  const w = Math.min(1400, iw), h = Math.round(ih * w / iw);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = true;
  // 사전 블러 — 고주파(잎·결) 디테일을 지워 큰 톤 덩어리만 남긴다. 그 뒤 포스터화가 깔끔한 면이 됨.
  g.filter = `blur(${PHOTO_BLUR}px)`;
  g.drawImage(img, 0, 0, w, h);
  g.filter = 'none';
  const im = g.getImageData(0, 0, w, h), d = im.data;
  const n = w * h;
  const gray = new Float32Array(n);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) gray[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  // 대비 S커브 + 밝기 리프트 — 중간톤을 흑/백으로 밀어 깔끔하게
  const shade = new Float32Array(n);
  for (let p = 0; p < n; p++) {
    let x = (gray[p] / 255 - 0.5) * PHOTO_CONTRAST + 0.5 + PHOTO_LIFT;
    shade[p] = Math.max(0, Math.min(255, x * 255));
  }
  const out = new Float32Array(n);
  const step = 255 / (CARTOON_LEVELS - 1);
  for (let p = 0; p < n; p++) out[p] = Math.round(shade[p] / step) * step;   // 포스터화(톤 뭉침)
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {          // 소벨 에지 → 잉크 윤곽선(edge 낮을수록 또렷)
    const i0 = y * w + x;
    const gx = -gray[i0 - w - 1] - 2 * gray[i0 - 1] - gray[i0 + w - 1] + gray[i0 - w + 1] + 2 * gray[i0 + 1] + gray[i0 + w + 1];
    const gy = -gray[i0 - w - 1] - 2 * gray[i0 - w] - gray[i0 - w + 1] + gray[i0 + w - 1] + 2 * gray[i0 + w] + gray[i0 + w + 1];
    const mag = Math.sqrt(gx * gx + gy * gy);
    if (mag > edge) out[i0] = Math.max(0, out[i0] - Math.min(210, (mag - edge) * 1.35));
  }
  // 포스터화(out)와 대비-사진(shade)을 섞는다 — 둘 다 이미 미니멀
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const v = CARTOON_MIX * out[p] + (1 - CARTOON_MIX) * shade[p];
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  cv._w = w; cv._h = h;
  return cv;
}

// 커버 핏 — 비율 유지하며 화면을 가득 채우고 넘치는 부분은 잘라낸다(사진 크롭).
function drawPhotoCover(g, img, W, H) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height; if (!iw || !ih) return;
  const sc = Math.max(W / iw, H / ih), dw = iw * sc, dh = ih * sc;
  g.imageSmoothingEnabled = true;
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  g.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

function drawIntroScene(t) {
  const W = window.innerWidth, H = window.innerHeight;
  const pw = Math.ceil(W / INTRO_PX), ph = Math.ceil(H / INTRO_PX);
  if (!introCanvas) { introCanvas = document.createElement('canvas'); introCtx = introCanvas.getContext('2d', { willReadFrequently: true }); }
  if (introCanvas.width !== pw || introCanvas.height !== ph) { introCanvas.width = pw; introCanvas.height = ph; }
  // 캐릭터(컬러) 레이어는 풀해상도 — 저해상 디더를 거치지 않아 픽셀아트가 또렷하다
  if (!introColorCanvas) { introColorCanvas = document.createElement('canvas'); introColorCtx = introColorCanvas.getContext('2d'); }
  if (introColorCanvas.width !== W || introColorCanvas.height !== H) { introColorCanvas.width = W; introColorCanvas.height = H; }
  let ctx = introCtx;   // let — plate()가 잠시 오프스크린으로 바꿔치기한다
  ctx.setTransform(pw / W, 0, 0, ph / H, 0, 0);
  ctx.imageSmoothingEnabled = true;
  const cctx = introColorCtx;
  cctx.setTransform(1, 0, 0, 1, 0, 0); cctx.clearRect(0, 0, W, H);
  cctx.imageSmoothingEnabled = false;

  // 정적 배경 플레이트 — 무거운 블러·그라디언트 층을 월드 좌표로 "1회만" 그려 캐시하고,
  // 매 프레임은 카메라 변환 아래 drawImage 한 번으로 끝낸다(프레임드랍 최적화의 핵심).
  // drawFn 안의 코드는 바깥과 똑같이 ctx를 쓰면 된다(그 동안 ctx가 플레이트를 가리킴).
  function plate(key, drawFn) {
    let ent = introLayerCache[key];
    if (!ent || ent.w !== pw || ent.h !== ph) {
      const cv = document.createElement('canvas'); cv.width = pw; cv.height = ph;
      const pctx = cv.getContext('2d');
      pctx.setTransform(pw / W, 0, 0, ph / H, 0, 0);
      pctx.imageSmoothingEnabled = true;
      const prev = ctx; ctx = pctx;
      try { drawFn(); } finally { ctx = prev; }
      ent = introLayerCache[key] = { cv, w: pw, h: ph };
    }
    ctx.drawImage(ent.cv, 0, 0, W, H);
  }

  // 장면 내부 시계 — INTRO_PACE 로 나눠 전체 호흡을 늦춘다(장면 안 초 값들은 그대로 유효)
  const s = (performance.now() - introScene.start) / 1000 / INTRO_PACE;
  const kind = introScene.kind;
  const durS = introScene.dur / 1000 / INTRO_PACE;
  const S = Math.min(W, H) * 0.17;
  const ink = '#000';

  // 흰 배경
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);

  // 부드러운 바닥 그림자
  const shadow = (x, y, rx, ry, k = 0.4) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, rx);
    g.addColorStop(0, `rgba(0,0,0,${k})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save(); ctx.translate(x, y); ctx.scale(1, ry / rx); ctx.translate(-x, -y);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rx, 0, 7); ctx.fill(); ctx.restore();
  };

  // ── 카메라 — 토마토는 강한 줌인(스토리보드 "서서히 줌인되기"), 나머진 잔잔한 푸시인 ──
  let zoom, ox, oy, panX = 0;
  if (kind === 'tomato') {
    // A(덩굴밭): 잔잔한 푸시인 → B(상자): 무더기 속 핑토에게 줌인
    if (s < TOMATO_CUT) { zoom = 1.0 + easeIO(s / TOMATO_CUT) * 0.42; ox = W * 0.5; oy = H * 0.52; }
    else { zoom = 0.85 + seg2(s, TOMATO_CUT + 0.4, durS - 0.8) * 0.22; ox = W * 0.5; oy = H * 0.44; }   // 상자 작게(줌 축소)
  }
  else if (kind === 'mouse' && s < MOUSE_CUT) {
    // 밤거리 — 내달리는 생쥐를 옆에서 트래킹(라따뚜이처럼 낮은 시점)
    const runX = W * (0.06 + seg2(s, 0.4, 5.8) * 0.75);
    ox = Math.max(W * 0.32, Math.min(W * 0.68, runX));
    oy = H * 0.68;
    zoom = 1.14;
  }
  else if (kind === 'mouse') {
    // 부엌(컷 이후 로컬 시계) — 도망가는 생쥐를 따라가다, 마지막엔 왼쪽에서 빼꼼하는 얼굴로 줌인
    const sK = s - MOUSE_CUT;
    const floorY0 = H * 0.68;
    const runU0 = Math.min(1, (sK < 1.4 ? seg2(sK, 0.2, 1.4) * 0.45 : sK < 1.9 ? 0.45 : 0.45 + seg2(sK, 1.9, 3.1) * 0.55));
    const dashOut0 = seg2(sK, 3.5, 4.3);
    const mx0 = W * (0.78 - runU0 * 0.36) - dashOut0 * W * 0.55;
    const track = Math.max(W * 0.2, Math.min(W * 0.72, mx0));
    const peekT = seg2(sK, 5.0, 6.3);
    ox = track * (1 - peekT) + S * 0.62 * peekT;             // 빼꼼 얼굴 위치로
    oy = (floorY0 + S * 0.1) * (1 - peekT) + (floorY0 - S * 0.18) * peekT;
    zoom = 1.05 + seg2(sK, 3.5, 4.5) * 0.3 + peekT * 0.85;  // 도망에 살짝, 빼꼼에 크게
    panX = peekT * W * 0.17;                                 // 왼쪽 끝 얼굴을 화면 안쪽으로
  }
  else { zoom = 1.04 + Math.min(1, s / durS) * 0.10; ox = W / 2; oy = H * 0.55; }
  const camX = Math.sin(t * 0.4) * 5 + panX, camY = Math.cos(t * 0.31) * 4;
  const applyCam = (c) => { c.translate(ox + camX, oy + camY); c.scale(zoom, zoom); c.translate(-ox, -oy); };
  applyCam(ctx); applyCam(cctx);

  // 음영 구체(동그란 토마토·바위)
  const sphere = (x, y, r, lo = '#e6e6e6', hi = '#141414') => {
    const sg = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    sg.addColorStop(0, lo); sg.addColorStop(0.55, '#7a7a7a'); sg.addColorStop(1, hi);
    ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  };
  // 옛날 다이얼 전화기 — 현실적인 비례: 사다리꼴 몸체·크래들·다이얼(손가락 구멍 10개)·수화기.
  // dark=true면 검정 몸체(밝은 배경용), false면 밝은 몸체(어두운 배경용).
  const rotary = (x, y, k, dark) => {
    const bw = S * 0.95 * k, bh = S * 0.58 * k;
    ctx.save();
    // 바닥 그림자 — 부드러운 타원
    ctx.save();
    ctx.translate(x, y + bh * 0.04); ctx.scale(1, 0.22); ctx.translate(-x, -(y + bh * 0.04));
    const shg = ctx.createRadialGradient(x, y + bh * 0.04, 0, x, y + bh * 0.04, bw * 0.62);
    shg.addColorStop(0, 'rgba(0,0,0,0.5)'); shg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = shg; ctx.beginPath(); ctx.arc(x, y + bh * 0.04, bw * 0.62, 0, 7); ctx.fill();
    ctx.restore();
    // 발 두 개
    ctx.fillStyle = dark ? '#000' : '#c6c6c6';
    ctx.fillRect(x - bw * 0.4, y - bh * 0.02, bw * 0.1, bh * 0.08);
    ctx.fillRect(x + bw * 0.3, y - bh * 0.02, bw * 0.1, bh * 0.08);
    // 벌어진 받침(스커트) — 광택 그라디언트
    const tone = (a, b, c, d2) => {
      const g2 = ctx.createLinearGradient(x - bw / 2, 0, x + bw / 2, 0);
      if (dark) { g2.addColorStop(0, a); g2.addColorStop(0.32, b); g2.addColorStop(0.58, c); g2.addColorStop(1, d2); }
      else { g2.addColorStop(0, d2); g2.addColorStop(0.32, c); g2.addColorStop(0.58, b); g2.addColorStop(1, a); }
      return g2;
    };
    ctx.fillStyle = tone('#2f2f2f', '#101010', '#3e3e3e', '#040404');
    ctx.beginPath();
    ctx.moveTo(x - bw * 0.5, y);
    ctx.quadraticCurveTo(x - bw * 0.53, y - bh * 0.15, x - bw * 0.42, y - bh * 0.22);
    ctx.lineTo(x + bw * 0.42, y - bh * 0.22);
    ctx.quadraticCurveTo(x + bw * 0.53, y - bh * 0.15, x + bw * 0.5, y);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = dark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(x - bw * 0.42, y - bh * 0.22); ctx.lineTo(x + bw * 0.42, y - bh * 0.22); ctx.stroke();
    // 몸통 — 둥근 어깨의 돔
    ctx.fillStyle = tone('#333', '#0e0e0e', '#464646', '#060606');
    ctx.beginPath();
    ctx.moveTo(x - bw * 0.42, y - bh * 0.2);
    ctx.quadraticCurveTo(x - bw * 0.45, y - bh * 0.74, x - bw * 0.26, y - bh * 0.97);
    ctx.quadraticCurveTo(x - bw * 0.12, y - bh * 1.08, x, y - bh * 1.08);
    ctx.quadraticCurveTo(x + bw * 0.12, y - bh * 1.08, x + bw * 0.26, y - bh * 0.97);
    ctx.quadraticCurveTo(x + bw * 0.45, y - bh * 0.74, x + bw * 0.42, y - bh * 0.2);
    ctx.closePath(); ctx.fill();
    // 광택 — 어깨의 부드러운 하이라이트 스윕
    ctx.strokeStyle = dark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.3)';
    ctx.lineWidth = Math.max(2, S * 0.032 * k); ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - bw * 0.33, y - bh * 0.36);
    ctx.quadraticCurveTo(x - bw * 0.33, y - bh * 0.8, x - bw * 0.14, y - bh * 0.99);
    ctx.stroke();
    // 다이얼 — 금속판(입체 그라디언트) + 손가락 구멍 10개(도넛) + 중앙 메달(동심원)
    const dy = y - bh * 0.5, dr = bh * 0.44;
    const dg = ctx.createRadialGradient(x - dr * 0.32, dy - dr * 0.36, dr * 0.08, x, dy, dr);
    if (dark) { dg.addColorStop(0, '#f6f6f6'); dg.addColorStop(0.65, '#bcbcbc'); dg.addColorStop(1, '#6f6f6f'); }
    else { dg.addColorStop(0, '#565656'); dg.addColorStop(0.65, '#232323'); dg.addColorStop(1, '#000'); }
    ctx.fillStyle = dg;
    ctx.beginPath(); ctx.arc(x, dy, dr, 0, 7); ctx.fill();
    ctx.strokeStyle = dark ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(x, dy, dr, 0, 7); ctx.stroke();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI * 0.42 + i * (Math.PI * 1.66 / 9);
      const hx2 = x + Math.cos(a) * dr * 0.66, hy2 = dy + Math.sin(a) * dr * 0.66;
      ctx.fillStyle = dark ? '#161616' : '#e6e6e6';                               // 구멍 속
      ctx.beginPath(); ctx.arc(hx2, hy2, dr * 0.135, 0, 7); ctx.fill();
      ctx.strokeStyle = dark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)';      // 도넛 테
      ctx.lineWidth = Math.max(1.2, dr * 0.05);
      ctx.beginPath(); ctx.arc(hx2, hy2, dr * 0.135, 0, 7); ctx.stroke();
    }
    ctx.fillStyle = dark ? '#dcdcdc' : '#2b2b2b';                                 // 중앙 메달
    ctx.beginPath(); ctx.arc(x, dy, dr * 0.3, 0, 7); ctx.fill();
    ctx.strokeStyle = dark ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.arc(x, dy, dr * 0.21, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, dy, dr * 0.1, 0, 7); ctx.stroke();
    // 손가락 멈춤쇠 — 5시 방향 금속 갈고리
    ctx.strokeStyle = dark ? '#ececec' : '#0d0d0d';
    ctx.lineWidth = Math.max(2.4, dr * 0.15); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(x, dy, dr * 1.04, Math.PI * 0.16, Math.PI * 0.34); ctx.stroke();
    // 크래들 기둥 두 개 — 수화기를 받친다
    ctx.fillStyle = dark ? '#151515' : '#e2e2e2';
    [[-1], [1]].forEach(([sgn]) => {
      const cx2 = x + sgn * bw * 0.3;
      ctx.beginPath(); ctx.roundRect(cx2 - bw * 0.05, y - bh * 1.32, bw * 0.1, bh * 0.38, bw * 0.03); ctx.fill();
    });
    // 꼬인 전화선 — 왼쪽으로 흘러내리는 코일
    ctx.strokeStyle = dark ? '#0c0c0c' : '#dedede';
    ctx.lineWidth = Math.max(1.6, S * 0.02 * k);
    for (let i = 0; i < 7; i++) {
      const u = i / 6;
      const cx3 = x - bw * (0.48 + u * 0.15) + Math.sin(u * 9) * bw * 0.02;
      const cy3 = y - bh * (0.72 - u * 0.6);
      ctx.beginPath(); ctx.ellipse(cx3, cy3, bw * 0.055, bw * 0.035, 0.5, 0, 7); ctx.stroke();
    }
    ctx.restore();
    // 수화기 — 크래들 위에 눕는다
    handset(x, y - bh * 1.38, k, dark);
  };
  // 수화기 — 두툼한 아치 바 + 아래로 처지는 나팔 컵(입체 음영)
  const handset = (x, y, k, dark) => {
    const col = dark ? '#101010' : '#ececec';
    const hw = S * 0.62 * k;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = col; ctx.lineWidth = S * 0.095 * k;                          // 손잡이 바
    ctx.beginPath();
    ctx.moveTo(x - hw * 0.36, y);
    ctx.quadraticCurveTo(x, y - S * 0.16 * k, x + hw * 0.36, y);
    ctx.stroke();
    ctx.strokeStyle = dark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.25)';       // 광택 줄
    ctx.lineWidth = S * 0.022 * k;
    ctx.beginPath();
    ctx.moveTo(x - hw * 0.3, y - S * 0.04 * k);
    ctx.quadraticCurveTo(x, y - S * 0.19 * k, x + hw * 0.3, y - S * 0.04 * k);
    ctx.stroke();
    [[-1], [1]].forEach(([sgn]) => {                                               // 양끝 나팔 컵
      const cx2 = x + sgn * hw * 0.44, cy2 = y + S * 0.05 * k;
      const cg = ctx.createRadialGradient(cx2 - S * 0.045 * k, cy2 - S * 0.06 * k, 0, cx2, cy2, S * 0.17 * k);
      if (dark) { cg.addColorStop(0, '#414141'); cg.addColorStop(1, '#000'); }
      else { cg.addColorStop(0, '#fff'); cg.addColorStop(1, '#adadad'); }
      ctx.fillStyle = cg;
      ctx.beginPath(); ctx.ellipse(cx2, cy2, S * 0.13 * k, S * 0.155 * k, sgn * 0.4, 0, 7); ctx.fill();
      ctx.strokeStyle = dark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)';       // 귀·입 대는 면 테
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.ellipse(cx2 + sgn * S * 0.02 * k, cy2 + S * 0.05 * k, S * 0.085 * k, S * 0.05 * k, sgn * 0.4, 0, 7);
      ctx.stroke();
    });
    ctx.restore();
  };
  // 무선전화기 수화기(사진 레퍼런스: 흰 무선폰) — 확대 컷용. 갸름한 세로 바디·이어슬릿·화면·키패드.
  const cordlessHandset = (x, y, k, dark, tilt = -0.2) => {
    const col = dark ? '#141414' : '#f0f0f0';
    const det = dark ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.6)';
    const w2 = S * 0.34 * k, h2 = S * 0.8 * k;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(tilt);
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.roundRect(-w2 / 2, -h2 / 2, w2, h2, w2 * 0.42); ctx.fill();
    ctx.strokeStyle = dark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.45)';
    ctx.lineWidth = Math.max(1.5, S * 0.018 * k); ctx.stroke();
    ctx.fillStyle = det;
    ctx.fillRect(-w2 * 0.22, -h2 * 0.43, w2 * 0.44, h2 * 0.035);            // 이어피스 슬릿
    ctx.fillStyle = dark ? '#3a3a3a' : '#c4c4c4';                           // 화면
    ctx.fillRect(-w2 * 0.3, -h2 * 0.33, w2 * 0.6, h2 * 0.2);
    ctx.strokeStyle = det; ctx.lineWidth = 1;
    ctx.strokeRect(-w2 * 0.3, -h2 * 0.33, w2 * 0.6, h2 * 0.2);
    ctx.fillStyle = det;                                                     // 키패드 3×4
    for (let r2 = 0; r2 < 4; r2++) for (let c2 = 0; c2 < 3; c2++) {
      ctx.beginPath();
      ctx.arc(-w2 * 0.22 + c2 * w2 * 0.22, -h2 * 0.02 + r2 * h2 * 0.09, Math.max(1.4, w2 * 0.055), 0, 7);
      ctx.fill();
    }
    ctx.beginPath(); ctx.arc(0, h2 * 0.43, Math.max(1.2, w2 * 0.04), 0, 7); ctx.fill();   // 마이크
    ctx.restore();
  };
  // 꼬불꼬불 전화선
  const cord = (x0, y0, x1, y1, col) => {
    ctx.strokeStyle = col; ctx.lineWidth = 1.6;
    const n2 = 9;
    for (let i = 0; i <= n2; i++) {
      const u = i / n2;
      const x = x0 + (x1 - x0) * u, y = y0 + (y1 - y0) * u + Math.sin(u * Math.PI * 1.2) * 10;
      ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.stroke();
    }
  };

  if (kind === 'tomato') {
    // ── ① 토마토 2장면(사진 레퍼런스) — A. 잎 무성한 덩굴밭 → B. 상자 속 토마토 무더기 ──
    // 열매 하나 — 광택 구체 + 별 모양 꽃받침(꼭지) 5장
    const calyx = (bx, by, r, tone = '#1f1f1f') => {
      ctx.strokeStyle = tone; ctx.lineCap = 'round';
      for (let p2 = 0; p2 < 5; p2++) {
        const a = p2 * (Math.PI * 2 / 5) - Math.PI / 2 + 0.3;
        ctx.lineWidth = Math.max(1.6, r * 0.13);
        ctx.beginPath();
        ctx.moveTo(bx, by - r * 0.88);
        ctx.quadraticCurveTo(
          bx + Math.cos(a) * r * 0.5, by - r * 0.92 + Math.sin(a) * r * 0.22,
          bx + Math.cos(a) * r * 0.92, by - r * 0.68 + Math.sin(a) * r * 0.5);
        ctx.stroke();
      }
      ctx.lineWidth = Math.max(1.6, r * 0.11);
      ctx.beginPath(); ctx.moveTo(bx, by - r * 0.9); ctx.lineTo(bx - r * 0.06, by - r * 1.14); ctx.stroke();   // 심지
    };
    const tomatoFruit = (bx, by, r, green = false, halo = false) => {
      if (halo) {   // 어두운 배경광 — 빽빽한 덤불에서 열매를 분리해 보이게
        ctx.fillStyle = 'rgba(0,0,0,0.85)';
        ctx.beginPath(); ctx.arc(bx, by, r * 1.16, 0, 7); ctx.fill();
      }
      sphere(bx, by, r, green ? '#dcdcdc' : '#f4f4f4', green ? '#8a8a8a' : '#1c1c1c');
      ctx.fillStyle = 'rgba(255,255,255,0.9)';   // 사진 같은 하이라이트 점
      ctx.beginPath(); ctx.ellipse(bx - r * 0.36, by - r * 0.42, r * 0.17, r * 0.09, -0.6, 0, 7); ctx.fill();
      calyx(bx, by, r);
    };
    // 결각·잎맥이 있는 토마토 잎 — L(기준 밝기 0~255)로 입체 음영(위 밝고 아래 어두움)
    const leaf = (x, y, sz, ang, L) => {
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
      const lg3 = ctx.createRadialGradient(-sz * 0.15, sz * 0.15, sz * 0.05, 0, sz * 0.55, sz * 1.15);
      lg3.addColorStop(0, `rgb(${Math.min(255, L + 58)},${Math.min(255, L + 64)},${Math.min(255, L + 54)})`);
      lg3.addColorStop(0.55, `rgb(${L},${L + 6},${L - 2 < 0 ? 0 : L - 2})`);
      lg3.addColorStop(1, `rgb(${Math.max(0, L - 34)},${Math.max(0, L - 30)},${Math.max(0, L - 36)})`);
      ctx.fillStyle = lg3;
      for (let l2 = 0; l2 < 4; l2++) {                       // 로브 4쌍 — 들쭉한 실루엣
        const u = l2 / 4;
        const ly = sz * (0.16 + u * 0.72);
        const lw = sz * 0.30 * (1 - u * 0.5);
        ctx.beginPath(); ctx.ellipse(-lw * 0.72, ly, lw, lw * 0.6, -0.5, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.ellipse(lw * 0.72, ly, lw, lw * 0.6, 0.5, 0, 7); ctx.fill();
      }
      ctx.beginPath(); ctx.ellipse(0, sz * 0.98, sz * 0.15, sz * 0.22, 0, 0, 7); ctx.fill();   // 끝잎
      ctx.strokeStyle = 'rgba(255,255,255,0.32)'; ctx.lineWidth = Math.max(1, sz * 0.028);      // 잎맥
      ctx.beginPath(); ctx.moveTo(0, sz * 0.06); ctx.lineTo(0, sz * 1.08); ctx.stroke();
      ctx.lineWidth = Math.max(0.8, sz * 0.017);
      for (let v2 = 1; v2 <= 4; v2++) {
        const vy = sz * (0.08 + v2 * 0.2);
        const vr = sz * 0.3 * (1 - v2 * 0.13);
        ctx.beginPath(); ctx.moveTo(0, vy); ctx.lineTo(-vr, vy + sz * 0.13); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, vy); ctx.lineTo(vr, vy + sz * 0.13); ctx.stroke();
      }
      ctx.restore();
    };
    if (s < TOMATO_CUT) {
      // ── A. 덩굴밭 — 사진(assets/intro/tomato-a) 있으면 흑백 도트로, 없으면 손그림 잎 폴백 ──
      const px2 = W * 0.5, py2 = H * 0.5;
      if (introPhotoReady('tomatoA')) { drawPhotoCover(ctx, introPhotos.tomatoA.styled || introPhotos.tomatoA.img, W, H); }
      else {
      plate('tomA', () => {
      let g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#474747'); g.addColorStop(0.55, '#6b6b6b'); g.addColorStop(1, '#383838');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      // 유기적 줄기 헬퍼 — 마디마다 좌우로 굽이치는 곡선(일직선 금지)
      const wavyStem = (x0, y0, x1, y1, bows, wdt, tone) => {
        ctx.strokeStyle = tone; ctx.lineWidth = wdt; ctx.lineCap = 'round';
        const dx = x1 - x0, dy = y1 - y0;
        const L2 = Math.hypot(dx, dy) || 1;
        const nx2 = -dy / L2, ny2 = dx / L2;   // 진행 방향의 수직
        ctx.beginPath(); ctx.moveTo(x0, y0);
        for (let i = 0; i < bows.length; i++) {
          const u1 = (i + 1) / bows.length, um = (i + 0.5) / bows.length;
          ctx.quadraticCurveTo(
            x0 + dx * um + nx2 * bows[i], y0 + dy * um + ny2 * bows[i],
            x0 + dx * u1, y0 + dy * u1);
        }
        ctx.stroke();
      };
      // 뒤층 잎 — 어둡게, 아주 빽빽하게, 심도 흐림(뒤 배경이 뭉개진 실사 톤)
      ctx.filter = 'blur(2.5px)';
      for (let i = 0; i < 34; i++) {
        const fx2 = ((i * 41) % 97) / 97 * W, fy2 = ((i * 67) % 89) / 89 * H;
        leaf(fx2, fy2, S * (0.5 + ((i * 13) % 5) * 0.11), ((i * 29) % 63) / 10 - 3 + Math.sin(t * 0.5 + i) * 0.03,
          44 + (i % 6) * 9);
      }
      // 덩굴 줄기 — 잎 사이를 굽이굽이 지나는 줄기들(흐림 유지)
      for (let i = 0; i < 6; i++) {
        const sx2 = W * (0.06 + i * 0.17);
        const amp = W * (0.02 + hash01(i * 3.1) * 0.05);
        wavyStem(sx2, -10, sx2 + Math.sin(i * 1.3) * W * 0.1, H + 10,
          [amp, -amp * 0.8, amp * 1.1, -amp * 0.7, amp * 0.5],
          S * (0.04 + (i % 2) * 0.018), `rgba(${70 + i * 7},${74 + i * 7},${66 + i * 7},0.9)`);
      }
      ctx.filter = 'none';
      // 앞층 잎 — 밝게, 훨씬 무성하게(열매보다 먼저 → 열매가 앞에 또렷이)
      for (let i = 0; i < 20; i++) {
        const fx2 = ((i * 71) % 93) / 93 * W, fy2 = ((i * 37 + 20) % 90) / 90 * H;
        leaf(fx2, fy2, S * (0.4 + ((i * 17) % 4) * 0.1), ((i * 43) % 63) / 10 - 3 - Math.sin(t * 0.6 + i) * 0.04,
          124 + (i % 6) * 14);
      }
      // (열매·송이는 사용자 요청으로 제거 — 이 컷엔 잎과 핑토만 남긴다)
      ctx.lineCap = 'round';
      // 전경 보케 — 카메라 코앞의 잎이 크게 흐려져 프레임을 감싼다(시네마틱)
      ctx.filter = 'blur(6px)';
      leaf(W * 0.03, H * 0.92, S * 1.25, -2.4, 26);
      leaf(W * 0.97, H * 0.05, S * 1.05, 0.9, 30);
      ctx.filter = 'none';
      // 핑토의 줄기 — 굽이치며 내려와 매달린다
      wavyStem(px2 + S * 0.2, -12, px2, py2 - S * 0.4,
        [S * 0.16, -S * 0.12, S * 0.09, -S * 0.05], S * 0.055, '#31352c');
      });   // ── tomA 플레이트 끝
      }
      // 핑토 — 배경 위에 얹는다(컬러 레이어)
      silhouetteDraw(cctx, 0, px2 - S * 0.5, py2 - S * 0.5, S, t, false, 'neutral', false, characterColor(0));
      fxOnce('wind', () => uiClick(0.28));
    } else {
      // ── B. 상자 — 사진(합성: 상자 절반·방울토마토 스케일) 흑백 도트, 없으면 손그림 폴백 ──
      const S2 = S;
      const pk = S2 * 0.62;                       // 핑토 — 작아진 상자·방울토마토에 맞춰 축소
      const px2 = W * 0.5, py2 = H * 0.56;        // 상자 위 토마토 줄에 앉는 위치(합성 좌표 기준)
      // 배경을 흑백 하프톤 ctx에 그린다(끝에서 dither → 도트아트).
      if (introPhotoReady('tomatoB')) { drawPhotoCover(ctx, introPhotos.tomatoB.styled || introPhotos.tomatoB.img, W, H); }
      else { ctx.imageSmoothingEnabled = true; ctx.drawImage(buildTomBColor(W, H, S), 0, 0, W, H); }
      // 핑토 — 배경 위에 얹는다(컬러 레이어). 눈물 또르르.
      silhouetteDraw(cctx, 0, px2 - pk * 0.55, py2 - pk * 0.55, pk * 1.1, t, false, 'sad', false, characterColor(0));
      if (s > 13.0) {
        const drop = (sd, side) => {
          const cyc = ((s - sd) % 1.6) / 1.6;
          if (s < sd || cyc > 0.85) return;
          const dx2 = px2 + side * pk * 0.2;
          const dy2 = py2 + pk * 0.02 + cyc * pk * 0.45;
          cctx.fillStyle = `rgba(80,120,210,${0.9 * (1 - cyc)})`;   // 눈물 — 맑은 물방울
          cctx.beginPath(); cctx.ellipse(dx2, dy2, 2.4, 3.6, 0, 0, 7); cctx.fill();
        };
        drop(13.0, -1); drop(13.8, 1);
        fxOnce('sniff', () => speakVoiceEvents([{ rel: 0, ch: 'u' }, { rel: 0.4, ch: 'u' }], characterVoice(0), 'sad'));
      }
      if (s > 16.8) drawIntroMark(cctx, '…', px2, py2 - pk * 1.05, S2 * 0.32, seg2(s, 16.8, 17.3), '#2a2a2a');
    }
    // 장면 전환 화이트 플래시(양 컷 모두 ctx 배경이므로 ctx만)
    {
      const f = 1 - Math.min(1, Math.abs(s - TOMATO_CUT) / 0.22);
      if (f > 0) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = `rgba(255,255,255,${f})`; ctx.fillRect(0, 0, pw, ph); ctx.restore(); }
      if (s > TOMATO_CUT) fxOnce('cut', () => uiClick(0.5));
    }
  } else if (kind === 'phone') {
    // ── ② 새+심해어 공동(3비트): 나무의 전화기 → 심해의 폰 → 연결 ──
    const beat = s < PHONE_B2 ? 1 : s < PHONE_B3 ? 2 : 3;
    if (beat === 1) {
      // b1 — 새가 커다란 느티나무로 날아와 전화기 발견(사진 레퍼런스)
      const horizon = H * 0.74;
      const trunkX = W * 0.2, branchY = H * 0.5, gy = horizon + H * 0.045;
      // 수관 — 겹겹의 잎덩이(라디얼 음영): 뒤(어둡고 흐릿) → 중간 → 앞(밝고 선명)
      const clump = (cx2, cy2, r, L, blur) => {
        if (blur) ctx.filter = `blur(${blur}px)`;
        const cg2 = ctx.createRadialGradient(cx2 - r * 0.3, cy2 - r * 0.38, r * 0.08, cx2, cy2, r);
        cg2.addColorStop(0, `rgb(${L + 64},${L + 70},${L + 60})`);
        cg2.addColorStop(0.6, `rgb(${L},${L + 6},${L - 2})`);
        cg2.addColorStop(1, `rgb(${Math.max(0, L - 40)},${Math.max(0, L - 36)},${Math.max(0, L - 42)})`);
        ctx.fillStyle = cg2;
        ctx.beginPath(); ctx.ellipse(cx2, cy2, r, r * 0.78, 0, 0, 7); ctx.fill();
        ctx.filter = 'none';
      };
      if (introPhotoReady('tree')) {
      // 배경을 tree 사진(assets/intro/tree)으로 대체 — 흑백 도트. 전화기는 그 위에.
      drawPhotoCover(ctx, introPhotos.tree.styled || introPhotos.tree.img, W, H);
      rotary(W * 0.44, branchY - S * 0.06, 1, true);
      } else {
      plate('tree', () => {
      let g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#c9c9c9'); g.addColorStop(0.55, '#f0f0f0'); g.addColorStop(1, '#e2e2e2');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      // 원경 산등성이 — 흐릿하게(피사계심도)
      ctx.filter = 'blur(3px)';
      ctx.fillStyle = '#bdbdbd';
      ctx.beginPath(); ctx.ellipse(W * 0.82, horizon + H * 0.02, W * 0.32, H * 0.1, 0, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#cccccc';
      ctx.beginPath(); ctx.ellipse(W * 0.2, horizon + H * 0.03, W * 0.36, H * 0.08, 0, Math.PI, 0); ctx.fill();
      ctx.filter = 'none';
      // 풀밭 땅
      g = ctx.createLinearGradient(0, horizon, 0, H);
      g.addColorStop(0, '#b0b0b0'); g.addColorStop(1, '#747474');
      ctx.fillStyle = g; ctx.fillRect(0, horizon, W, H - horizon);
      shadow(trunkX + S * 0.5, horizon + H * 0.06, S * 2.8, S * 0.42, 0.35);   // 나무 그늘
      const canopyCX = trunkX + S * 0.6;
      for (let i = 0; i < 9; i++) {   // 뒤층
        const u = ((i * 47) % 90) / 90;
        clump(canopyCX - S * 2.2 + u * S * 4.4, H * (0.09 + ((i * 31) % 40) / 100 * 0.24),
          S * (0.6 + ((i * 13) % 4) * 0.13), 40, 2);
      }
      for (let i = 0; i < 8; i++) {   // 중간층
        const u = ((i * 59 + 17) % 90) / 90;
        clump(canopyCX - S * 1.9 + u * S * 3.8, H * (0.08 + ((i * 43 + 9) % 40) / 100 * 0.22),
          S * (0.5 + ((i * 17) % 4) * 0.11), 88, 0.8);
      }
      // 줄기 — 뿌리가 벌어진 굵은 둥치(좌우 음영) + 나무껍질 결
      g = ctx.createLinearGradient(trunkX - S * 0.5, 0, trunkX + S * 0.5, 0);
      g.addColorStop(0, '#060606'); g.addColorStop(0.42, '#525252'); g.addColorStop(0.72, '#2b2b2b'); g.addColorStop(1, '#0a0a0a');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(trunkX - S * 0.74, gy);
      ctx.quadraticCurveTo(trunkX - S * 0.32, gy - S * 0.36, trunkX - S * 0.27, H * 0.54);
      ctx.quadraticCurveTo(trunkX - S * 0.25, H * 0.42, trunkX - S * 0.32, H * 0.3);
      ctx.lineTo(trunkX - S * 0.02, H * 0.22);
      ctx.lineTo(trunkX + S * 0.26, H * 0.28);
      ctx.quadraticCurveTo(trunkX + S * 0.22, H * 0.42, trunkX + S * 0.26, H * 0.54);
      ctx.quadraticCurveTo(trunkX + S * 0.32, gy - S * 0.32, trunkX + S * 0.72, gy);
      ctx.closePath(); ctx.fill();
      // 뿌리 발가락
      ctx.fillStyle = '#0e0e0e';
      [[-0.52, 0.3], [-0.2, 0.42], [0.18, 0.4], [0.5, 0.28]].forEach(([rx, rw]) => {
        ctx.beginPath(); ctx.ellipse(trunkX + S * rx, gy - S * 0.02, S * rw * 0.5, S * 0.09, 0, 0, 7); ctx.fill();
      });
      // 껍질 결 — 세로 물결(밝은 결·어두운 골 교차)
      for (let i = 0; i < 10; i++) {
        const bx3 = trunkX - S * 0.22 + (i / 9) * S * 0.46;
        ctx.strokeStyle = i % 2 ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.13)';
        ctx.lineWidth = 1.5 + (i % 3);
        ctx.beginPath();
        for (let yy = 0; yy <= 8; yy++) {
          const v = yy / 8;
          const px3 = bx3 + Math.sin(v * 6 + i * 2.3) * S * 0.03 * (1 + v * 0.6);
          const py3 = H * 0.27 + v * (gy - H * 0.27);
          yy === 0 ? ctx.moveTo(px3, py3) : ctx.lineTo(px3, py3);
        }
        ctx.stroke();
      }
      // 캐노피 속으로 갈라지는 굵은 가지들
      ctx.strokeStyle = '#101010'; ctx.lineCap = 'round';
      [[-0.15, -0.9, 0.30], [0.1, 0.4, 0.24], [0.02, -0.3, 0.2]].forEach(([fx0, fx1, w2]) => {
        ctx.lineWidth = S * w2;
        ctx.beginPath();
        ctx.moveTo(trunkX + S * fx0, H * 0.3);
        ctx.quadraticCurveTo(trunkX + S * (fx0 + fx1 * 0.5), H * 0.2, trunkX + S * (fx0 + fx1), H * 0.13);
        ctx.stroke();
      });
      // 전화기 가지 — 굽이치며 끝으로 갈수록 가늘어진다(일직선 X). 마디마다 살짝 위아래로.
      ctx.strokeStyle = '#151515'; ctx.lineCap = 'round';
      const bPts = [
        [trunkX + S * 0.1, H * 0.42], [W * 0.3, H * 0.475], [W * 0.42, branchY - S * 0.07],
        [W * 0.53, branchY + S * 0.03], [W * 0.63, branchY - S * 0.04], [W * 0.7, branchY - S * 0.01],
      ];
      for (let i2 = 0; i2 < bPts.length - 1; i2++) {
        ctx.lineWidth = Math.max(S * 0.035, S * (0.16 - i2 * 0.026));
        const mx3 = (bPts[i2][0] + bPts[i2 + 1][0]) / 2;
        const my3 = (bPts[i2][1] + bPts[i2 + 1][1]) / 2 + (i2 % 2 ? S * 0.045 : -S * 0.045);
        ctx.beginPath();
        ctx.moveTo(bPts[i2][0], bPts[i2][1]);
        ctx.quadraticCurveTo(mx3, my3, bPts[i2 + 1][0], bPts[i2 + 1][1]);
        ctx.stroke();
      }
      // 잔가지 — 위아래로 자연스럽게 벌어지고, 끝에 잎 뭉치
      [[0.34, -1, 0.34], [0.47, 1, 0.26], [0.58, -1, 0.3]].forEach(([fx0, dir, len], bi) => {
        ctx.lineWidth = S * (0.05 - bi * 0.008);
        ctx.beginPath();
        ctx.moveTo(W * fx0, branchY - S * 0.04 + dir * S * 0.02);
        ctx.quadraticCurveTo(W * fx0 + S * 0.22, branchY + dir * S * len * 0.55, W * fx0 + S * 0.44, branchY + dir * S * len);
        ctx.stroke();
        clump(W * fx0 + S * 0.52, branchY + dir * S * (len + 0.14), S * (0.2 + (bi % 2) * 0.05), 118, 0);
      });
      // 앞층 잎덩이 — 가장 밝고 선명(가지 위를 살짝 덮는다)
      for (let i = 0; i < 7; i++) {
        const u = ((i * 73 + 31) % 90) / 90;
        clump(canopyCX - S * 1.6 + u * S * 3.2, H * (0.07 + ((i * 29 + 3) % 36) / 100 * 0.2),
          S * (0.38 + ((i * 11) % 4) * 0.09), 142, 0);
      }
      // 가지 위 옛날 전화기
      rotary(W * 0.44, branchY - S * 0.06, 1, true);
      });   // ── tree 플레이트 끝
      }   // ── tree 사진/손그림 분기 끝
      // 새(귤색) — 오른쪽 위에서 날아와 착지
      const fly = seg2(s, 0.2, 2.2);
      const bx = W * (1.06 - 0.46 * fly), by = H * (0.16 + 0.26 * fly) - Math.sin(fly * Math.PI) * H * 0.1;
      const flap = fly < 1 ? Math.sin(t * 16) * S * 0.06 : 0;
      silhouetteDraw(cctx, 2, bx - S / 2, by - S / 2 + flap, S, t, false, 'neutral', false, characterColor(2));
      fxOnce('flap1', () => { [0, 300, 600, 900].forEach((d) => setTimeout(() => typeKey('f', 0.6, characterVoice(2)), d)); });
      if (fly >= 1) fxOnce('land', () => uiClick(0.7));
      if (s > 2.5) {
        drawIntroMark(ctx, '!', bx, by - S * 0.75, S * 0.4, seg2(s, 2.5, 2.8) * (1 - seg2(s, 3.3, 3.6)));
        fxOnce('found1', () => uiClick(0.92));
      }
    } else if (beat === 2) {
      // b2 — 심해(사진 레퍼런스) — 수면의 빛이 갈라져 내려오고, 바위 능선·해초·물고기떼·해파리
      plate('seaSky', () => {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#5c5c5c'); g.addColorStop(0.35, '#2c2c2c'); g.addColorStop(1, '#040404');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      // 수면의 밝은 웅덩이(빛이 모이는 곳)
      const sg2 = ctx.createRadialGradient(W * 0.46, -H * 0.05, 0, W * 0.46, -H * 0.05, H * 0.5);
      sg2.addColorStop(0, 'rgba(255,255,255,0.85)'); sg2.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sg2; ctx.fillRect(0, 0, W, H * 0.5);
      });   // ── seaSky 플레이트 끝
      // 갈라져 내려오는 빛줄기 여러 가닥(갓레이)
      [[0.34, 0.35, -0.16], [0.42, 0.6, -0.05], [0.48, 0.9, 0.03], [0.55, 0.5, 0.12], [0.63, 0.3, 0.24]].forEach(([fx2, k, spread]) => {
        const flick = 0.8 + 0.2 * Math.sin(t * 0.9 + fx2 * 20);
        const lg = ctx.createLinearGradient(0, 0, 0, H * 0.85);
        lg.addColorStop(0, `rgba(255,255,255,${(0.3 * k + 0.08) * flick})`); lg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = lg;
        ctx.beginPath();
        ctx.moveTo(W * fx2 - S * 0.1, 0); ctx.lineTo(W * fx2 + S * 0.12, 0);
        ctx.lineTo(W * (fx2 + spread) + S * 0.55, H * 0.9); ctx.lineTo(W * (fx2 + spread) - S * 0.55, H * 0.9);
        ctx.closePath(); ctx.fill();
      });
      // 물고기떼 — 밝은 실루엣들이 줄지어 유영(어둠 속에서 빛을 받는다) — 큼직하게
      ctx.fillStyle = 'rgba(235,235,235,0.6)';
      for (let i = 0; i < 14; i++) {
        const u = ((i * 61) % 100) / 100;
        const fx2 = W * (0.16 + u * 0.62) + Math.sin(t * 0.5 + i) * 10;
        const fy2 = H * (0.2 + ((i * 37) % 40) / 100 * 0.5) + Math.sin(t * 0.8 + i * 2) * 6;
        const fr = S * (0.085 + (i % 3) * 0.03);
        ctx.beginPath(); ctx.ellipse(fx2, fy2, fr, fr * 0.42, 0, 0, 7); ctx.fill();       // 몸통
        ctx.beginPath();                                                                    // 꼬리
        ctx.moveTo(fx2 + fr * 0.9, fy2); ctx.lineTo(fx2 + fr * 1.5, fy2 - fr * 0.5); ctx.lineTo(fx2 + fr * 1.5, fy2 + fr * 0.5);
        ctx.closePath(); ctx.fill();
      }
      // 해파리 둘 — 갓 + 하늘거리는 촉수(반투명 흰빛) — 큼직하게
      [[0.15, 0.26, 1], [0.86, 0.36, 0.75]].forEach(([fx2, fy2, k], ji) => {
        const jx = W * fx2, jy = H * fy2 + Math.sin(t * 0.7 + ji * 2) * 12;
        const jr = S * 0.34 * k;
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.beginPath(); ctx.arc(jx, jy, jr, Math.PI, 0); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.25)';   // 갓 아랫단(주름)
        ctx.beginPath(); ctx.ellipse(jx, jy, jr, jr * 0.22, 0, 0, 7); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 2.2;
        for (let tn2 = 0; tn2 < 5; tn2++) {
          ctx.beginPath();
          const tx2 = jx - jr * 0.64 + tn2 * jr * 0.32;
          ctx.moveTo(tx2, jy);
          ctx.quadraticCurveTo(tx2 + Math.sin(t * 2 + tn2) * 8, jy + jr * 1.2, tx2 + Math.sin(t * 1.6 + tn2 * 2) * 13, jy + jr * 2.3);
          ctx.stroke();
        }
      });
      // 물방울 — 올라가는 기포 몇 개
      ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1.4;
      for (let i = 0; i < 6; i++) {
        const bu = ((t * 0.06 + i * 0.17) % 1);
        const bx2 = W * (0.2 + ((i * 53) % 60) / 100) + Math.sin(t + i) * 6;
        ctx.beginPath(); ctx.arc(bx2, H * (1 - bu), 2 + (i % 3), 0, 7); ctx.stroke();
      }
      // 해저 바위 능선 — 먼 능선(회색)과 가까운 능선(검정), 울퉁불퉁한 실루엣
      const ridge = (baseY, rough, tone, seed) => {
        ctx.fillStyle = tone;
        ctx.beginPath(); ctx.moveTo(-4, H + 4);
        ctx.lineTo(-4, baseY);
        for (let x = 0; x <= W; x += W / 26) {
          const hsh = hash01(seed + x * 0.013);
          ctx.lineTo(x, baseY - hsh * rough - Math.sin(x * 0.01 + seed) * rough * 0.3);
        }
        ctx.lineTo(W + 4, baseY); ctx.lineTo(W + 4, H + 4); ctx.closePath(); ctx.fill();
      };
      plate('seaFloor', () => {
      ridge(H * 0.8, S * 0.7, '#1d1d1d', 3.7);
      ridge(H * 0.88, S * 0.5, '#070707', 9.1);
      sphere(W * 0.68, H * 0.82, S * 0.5, '#6a6a6a', '#0a0a0a');   // 폰 뒤 둥근 바위
      rotary(W * 0.6, H * 0.9, 0.95, false);                       // 폰 — 바위 앞 해저에
      });   // ── seaFloor 플레이트 끝
      // 해초 — 하늘하늘 물결치는 검은 줄기들(좌우 구석)
      ctx.lineCap = 'round';
      for (let i = 0; i < 9; i++) {
        const sx2 = i < 5 ? W * (0.02 + i * 0.045) : W * (0.82 + (i - 5) * 0.05);
        const hgt = H * (0.1 + ((i * 31) % 30) / 100 * 0.6);
        ctx.strokeStyle = `rgba(${8 + (i % 3) * 10},${10 + (i % 3) * 10},${8 + (i % 3) * 10},0.9)`;
        ctx.lineWidth = S * (0.03 + (i % 2) * 0.015);
        ctx.beginPath();
        for (let yy = 0; yy <= 6; yy++) {
          const u = yy / 6;
          const px3 = sx2 + Math.sin(u * Math.PI * 2.2 + t * 1.3 + i * 1.9) * S * 0.14 * u;
          const py3 = H * 0.92 - u * hgt;
          yy === 0 ? ctx.moveTo(px3, py3) : ctx.lineTo(px3, py3);
        }
        ctx.stroke();
      }
      // 심해어(남색) — 왼쪽에서 유영해 들어옴, 광륜
      const swim = seg2(s, 6.0, 8.2);
      const fx3 = W * (-0.12 + 0.5 * swim), fy3 = H * (0.55 + 0.1 * swim) + Math.sin(t * 1.8) * 6;
      const glowK = 0.7 + 0.3 * Math.sin(t * 3);
      const fg = ctx.createRadialGradient(fx3, fy3, 0, fx3, fy3, S * 1.4);
      fg.addColorStop(0, `rgba(255,255,255,${0.85 * glowK})`); fg.addColorStop(0.5, `rgba(255,255,255,${0.35 * glowK})`); fg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = fg; ctx.fillRect(fx3 - S * 1.6, fy3 - S * 1.6, S * 3.2, S * 3.2);
      silhouetteDraw(cctx, 1, fx3 - S / 2, fy3 - S / 2, S, t, false, 'neutral', true, characterColor(1));
      fxOnce('sonar', () => { [0, 500].forEach((d) => setTimeout(() => uiClick(0.35), d)); });
      if (s > 9.2) {
        drawIntroMark(ctx, '!', fx3, fy3 - S * 0.75, S * 0.4, seg2(s, 9.2, 9.5) * (1 - seg2(s, 10.2, 10.5)), '#fff');
        fxOnce('found2', () => uiClick(0.5));
      }
    } else {
      // b3 — 위 하늘의 새, 아래 심해의 심해어 — 수화기를 들고 "?" 연결
      const splitY = H * 0.5;
      let g = ctx.createLinearGradient(0, 0, 0, splitY);
      g.addColorStop(0, '#9d9d9d'); g.addColorStop(1, '#efefef');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, splitY);
      g = ctx.createLinearGradient(0, splitY, 0, H);
      g.addColorStop(0, '#5a5a5a'); g.addColorStop(1, '#121212');
      ctx.fillStyle = g; ctx.fillRect(0, splitY, W, H - splitY);
      // ── 배경 살짝 — 위(하늘): 흘러가는 구름·햇빛 / 아래(심해): 빛줄기·바위·해초·기포 ──
      // 햇빛 번짐(왼쪽 위) — 은은하게
      const sunG3 = ctx.createRadialGradient(W * 0.18, H * 0.06, 0, W * 0.18, H * 0.06, H * 0.4);
      sunG3.addColorStop(0, 'rgba(255,255,255,0.55)'); sunG3.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sunG3; ctx.fillRect(0, 0, W, splitY);
      // 구름 — 새털구름(권운): 머리는 도톰, 꼬리로 갈수록 가늘게 흩어지는 깃털 결 다발
      const cirrus = (cx3, cy3, len, k, seed) => {
        // 결 세 가닥 — 가운데 본줄기 + 위아래 얇은 곁줄기
        [[0, 1, 0.85], [-0.32, 0.62, 0.4], [0.3, 0.5, 0.32]].forEach(([oy, kk, a0], si) => {
          const n = 22;
          for (let i2 = 0; i2 < n; i2++) {
            const u = i2 / (n - 1);                                               // 0=머리, 1=꼬리
            const px3 = cx3 + len * (0.06 * si + u * kk);
            const py3 = cy3 + oy * S * 0.16 * k
              + Math.sin(u * Math.PI * 1.3 + seed + si * 2) * S * 0.05 * k
              - u * S * 0.12 * k;                                                 // 꼬리가 살짝 쓸려 올라간다
            const rw = S * (0.19 - 0.13 * u) * k * kk;
            ctx.fillStyle = `rgba(60,60,60,${0.9 * a0 * (1 - u * 0.7)})`;         // 결 아래 음영 — 밝은 하늘에서도 읽히게
            ctx.beginPath(); ctx.ellipse(px3, py3 + rw * 0.45, rw * 0.96, rw * 0.36, -0.07, 0, 7); ctx.fill();
            ctx.fillStyle = `rgba(255,255,255,${a0 * (1 - u * 0.7)})`;
            ctx.beginPath(); ctx.ellipse(px3, py3, rw, rw * 0.3, -0.07, 0, 7); ctx.fill();
          }
        });
      };
      [[0.03, 0.16, 1.0, 3.0], [0.3, 0.1, 0.75, 2.4], [0.5, 0.26, 0.6, 1.8], [0.72, 0.12, 0.9, 2.6]].forEach(([fx0, fy0, k, ln], ci2) => {
        const cxc = ((fx0 + t * 0.003 * (1 + ci2 * 0.3)) % 1.3) * W - W * 0.15;
        cirrus(cxc, H * fy0, S * ln, k, ci2 * 1.7);
      });
      // 심해 빛줄기 — 수면에서 비스듬히 스미는 두 가닥
      [[0.2, 0.3, 0.1], [0.62, 0.2, -0.06]].forEach(([fx0, a, spread]) => {
        const lg3 = ctx.createLinearGradient(0, splitY, 0, H);
        lg3.addColorStop(0, `rgba(255,255,255,${a})`); lg3.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = lg3;
        ctx.beginPath();
        ctx.moveTo(W * fx0 - S * 0.12, splitY); ctx.lineTo(W * fx0 + S * 0.14, splitY);
        ctx.lineTo(W * (fx0 + spread) + S * 0.5, H); ctx.lineTo(W * (fx0 + spread) - S * 0.5, H);
        ctx.closePath(); ctx.fill();
      });
      // 해저 바위 둔덕 두 개(구석) — 밝은 윤곽으로 어둠 속에서 드러난다 + 해초(밝은 실루엣)
      [[0.08, 0.98, 1.1, 0.42], [0.95, 0.99, 1.3, 0.5]].forEach(([fx0, fy0, rx0, ry0]) => {
        const rg3 = ctx.createRadialGradient(W * fx0 - S * 0.3, H * fy0 - S * ry0 * 0.9, 0, W * fx0, H * fy0, S * rx0);
        rg3.addColorStop(0, '#6f6f6f'); rg3.addColorStop(0.6, '#2e2e2e'); rg3.addColorStop(1, '#0a0a0a');
        ctx.fillStyle = rg3;
        ctx.beginPath(); ctx.ellipse(W * fx0, H * fy0, S * rx0, S * ry0, 0, Math.PI, 0); ctx.fill();
      });
      ctx.lineCap = 'round';
      for (let i = 0; i < 5; i++) {
        const sx2 = i < 3 ? W * (0.03 + i * 0.05) : W * (0.9 + (i - 3) * 0.055);
        const hgt = H * (0.12 + ((i * 37) % 30) / 100 * 0.35);
        ctx.strokeStyle = `rgba(205,205,205,${0.35 + (i % 3) * 0.1})`;   // 빛 받은 해초 — 어둠 위에 밝게
        ctx.lineWidth = S * 0.032;
        ctx.beginPath();
        for (let yy = 0; yy <= 5; yy++) {
          const u = yy / 5;
          const px3 = sx2 + Math.sin(u * Math.PI * 2 + t * 1.2 + i * 1.7) * S * 0.1 * u;
          const py3 = H * 0.99 - u * hgt;
          yy === 0 ? ctx.moveTo(px3, py3) : ctx.lineTo(px3, py3);
        }
        ctx.stroke();
      }
      // 기포 — 심해어 쪽에서 올라가는 작은 방울들
      ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1.3;
      for (let i = 0; i < 5; i++) {
        const bu = ((t * 0.07 + i * 0.21) % 1);
        const bx3 = W * (0.12 + ((i * 47) % 55) / 100 * 0.5) + Math.sin(t + i) * 5;
        ctx.beginPath(); ctx.arc(bx3, H - bu * (H - splitY) * 0.92, 1.8 + (i % 3), 0, 7); ctx.stroke();
      }
      // 수면 경계선(물결)
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 7) {
        const y = splitY + Math.sin(x * 0.035 + t * 2) * 4;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      // 클로즈업 — 스토리보드처럼 두 캐릭터를 크게(화면을 나눠 가까이서)
      const S3 = S * 2.2;
      const bx = W * 0.68, by = H * 0.24 + Math.sin(t * 2.1) * 5;
      const fx3 = W * 0.32, fy3 = H * 0.78 + Math.sin(t * 1.7) * 6;
      // 심해어 광륜
      const glowK = 0.7 + 0.3 * Math.sin(t * 3);
      const fg = ctx.createRadialGradient(fx3, fy3, 0, fx3, fy3, S3 * 1.2);
      fg.addColorStop(0, `rgba(255,255,255,${0.8 * glowK})`); fg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = fg; ctx.fillRect(fx3 - S3 * 1.4, fy3 - S3 * 1.4, S3 * 2.8, S3 * 2.8);
      // 캐릭터 + 수화기(귀에 든 모양) + 꼬불선(화면 밖으로)
      silhouetteDraw(cctx, 2, bx - S3 / 2, by - S3 / 2, S3, t + 1, Math.sin(t * 6) > 0 && s > 12.4, 'neutral', false, characterColor(2));
      silhouetteDraw(cctx, 1, fx3 - S3 / 2, fy3 - S3 / 2, S3, t, Math.sin(t * 6 + 2) > 0 && s > 13.2, 'neutral', true, characterColor(1));
      ctx.save();
      cordlessHandset(bx - S3 * 0.52, by - S3 * 0.05, 1.6, true, -0.22);
      cord(bx - S3 * 0.52, by + S3 * 0.18, W * 1.05, by + S3 * 0.55, '#141414');
      cordlessHandset(fx3 + S3 * 0.52, fy3 - S3 * 0.05, 1.6, false, 0.22);
      cord(fx3 + S3 * 0.52, fy3 + S3 * 0.18, -W * 0.05, fy3 + S3 * 0.55, '#e9e9e9');
      ctx.restore();
      // 벨 울림 "( ( (" — 흰 호가 퍼진다
      if (s > 11.6 && s < 13.0) {
        const rp = ((s - 11.6) % 0.65) / 0.65;
        ctx.strokeStyle = `rgba(255,255,255,${0.8 * (1 - rp)})`; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(fx3 + S3 * 0.52, fy3 - S3 * 0.03, S3 * (0.28 + rp * 0.45), -1.2, 1.2); ctx.stroke();
        fxOnce('ring', () => { [0, 650].forEach((d) => setTimeout(() => { uiClick(0.95); uiClick(0.7); }, d)); });
      }
      if (s > 12.6) {
        drawIntroMark(ctx, '?', bx + S3 * 0.42, by - S3 * 0.6, S * 0.62, seg2(s, 12.6, 13.0));
        fxOnce('q1', () => speakVoiceEvents([{ rel: 0, ch: 'a' }, { rel: 0.25, ch: 'e' }], characterVoice(2), 'confused'));
      }
      if (s > 13.4) {
        drawIntroMark(ctx, '?', fx3 - S3 * 0.42, fy3 - S3 * 0.6, S * 0.62, seg2(s, 13.4, 13.8), '#fff');
        fxOnce('q2', () => speakVoiceEvents([{ rel: 0, ch: 'o' }, { rel: 0.25, ch: 'i' }], characterVoice(1), 'confused'));
      }
      if (s > 14.8) {
        drawIntroMark(ctx, '♪', W * 0.5, splitY, S * 0.62, seg2(s, 14.8, 15.3));
        fxOnce('duet', () => { speakVoiceEvents([{ rel: 0, ch: 'a' }], characterVoice(1), 'happy'); speakVoiceEvents([{ rel: 0.3, ch: 'a' }], characterVoice(2), 'happy'); });
      }
    }
    // 비트 전환 화이트 플래시
    [PHONE_B2, PHONE_B3].forEach((cut) => {
      const f = 1 - Math.min(1, Math.abs(s - cut) / 0.22);
      if (f > 0) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = `rgba(255,255,255,${f})`; ctx.fillRect(0, 0, pw, ph); ctx.restore(); }
    });
  } else if (kind === 'mouse') {
    // ── ③-A 밤의 도시(라따뚜이 무드) — 가로등 불빛의 자갈길을 생쥐가 내달린다 ──
    if (s < MOUSE_CUT) {
      const stFloor = H * 0.72;
      plate('street', () => {
      // 밤하늘
      let g = ctx.createLinearGradient(0, 0, 0, stFloor);
      g.addColorStop(0, '#060606'); g.addColorStop(0.7, '#1c1c1c'); g.addColorStop(1, '#2f2f2f');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, stFloor);
      // 달
      const moonX = W * 0.8, moonY = H * 0.13;
      const mg2 = ctx.createRadialGradient(moonX, moonY, 0, moonX, moonY, S * 0.55);
      mg2.addColorStop(0, 'rgba(255,255,255,0.95)'); mg2.addColorStop(0.22, 'rgba(255,255,255,0.88)'); mg2.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = mg2; ctx.fillRect(moonX - S, moonY - S, S * 2, S * 2);
      // 멀리 철탑 실루엣 — 흐릿하게(파리의 밤)
      ctx.filter = 'blur(2px)';
      ctx.strokeStyle = 'rgba(70,70,70,0.9)'; ctx.lineWidth = 3;
      const eifX = W * 0.62, eifB = stFloor, eifH2 = H * 0.34;
      ctx.beginPath();
      ctx.moveTo(eifX - S * 0.36, eifB);
      ctx.quadraticCurveTo(eifX - S * 0.1, eifB - eifH2 * 0.55, eifX - S * 0.03, eifB - eifH2);
      ctx.lineTo(eifX + S * 0.03, eifB - eifH2);
      ctx.quadraticCurveTo(eifX + S * 0.1, eifB - eifH2 * 0.55, eifX + S * 0.36, eifB);
      ctx.stroke();
      ctx.beginPath(); ctx.moveTo(eifX - S * 0.22, eifB - eifH2 * 0.32); ctx.lineTo(eifX + S * 0.22, eifB - eifH2 * 0.32); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(eifX - S * 0.12, eifB - eifH2 * 0.6); ctx.lineTo(eifX + S * 0.12, eifB - eifH2 * 0.6); ctx.stroke();
      ctx.filter = 'none';
      // 오스만풍 건물 파사드 — 창문 몇 개는 따뜻하게 불이 켜져 있다
      const facade = (x0, wF, hTop) => {
        const fg2 = ctx.createLinearGradient(x0, 0, x0 + wF, 0);
        fg2.addColorStop(0, '#101010'); fg2.addColorStop(0.5, '#232323'); fg2.addColorStop(1, '#0b0b0b');
        ctx.fillStyle = fg2; ctx.fillRect(x0, hTop, wF, stFloor - hTop);
        ctx.fillStyle = '#050505'; ctx.fillRect(x0, hTop - H * 0.012, wF, H * 0.012);   // 지붕선
        const cols = Math.max(2, Math.round(wF / (S * 0.55)));
        for (let r2 = 0; r2 < 4; r2++) for (let c2 = 0; c2 < cols; c2++) {
          const wx2 = x0 + wF * (0.12 + c2 * 0.76 / Math.max(1, cols - 1)) - S * 0.09;
          const wy2 = hTop + H * 0.05 + r2 * H * 0.115;
          if (wy2 + S * 0.24 > stFloor - H * 0.02) continue;
          const lit = hash01(x0 * 0.13 + r2 * 7.7 + c2 * 3.1) > 0.55;
          ctx.fillStyle = lit ? `rgba(255,244,214,${0.72 + 0.16 * Math.sin(t * 2 + c2)})` : '#181818';
          ctx.fillRect(wx2, wy2, S * 0.18, S * 0.24);
          ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 1.4;
          ctx.strokeRect(wx2, wy2, S * 0.18, S * 0.24);
          ctx.beginPath(); ctx.moveTo(wx2 + S * 0.09, wy2); ctx.lineTo(wx2 + S * 0.09, wy2 + S * 0.24); ctx.stroke();
          if (lit) {                                                    // 창 불빛 번짐
            const wg2 = ctx.createRadialGradient(wx2 + S * 0.09, wy2 + S * 0.12, 0, wx2 + S * 0.09, wy2 + S * 0.12, S * 0.3);
            wg2.addColorStop(0, 'rgba(255,240,200,0.25)'); wg2.addColorStop(1, 'rgba(255,240,200,0)');
            ctx.fillStyle = wg2; ctx.fillRect(wx2 - S * 0.2, wy2 - S * 0.18, S * 0.6, S * 0.6);
          }
        }
      };
      facade(-W * 0.02, W * 0.34, H * 0.1);
      facade(W * 0.36, W * 0.22, H * 0.22);
      facade(W * 0.84, W * 0.2, H * 0.14);
      // 카페 차양 — 왼쪽 건물 1층(줄무늬)
      ctx.fillStyle = '#3a3a3a';
      ctx.beginPath();
      ctx.moveTo(W * 0.02, stFloor - H * 0.125); ctx.lineTo(W * 0.3, stFloor - H * 0.125);
      ctx.lineTo(W * 0.27, stFloor - H * 0.06); ctx.lineTo(W * 0.05, stFloor - H * 0.06);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 2.4;
      for (let i2 = 0; i2 < 6; i2++) {
        const ax2 = W * (0.05 + i2 * 0.042);
        ctx.beginPath(); ctx.moveTo(ax2, stFloor - H * 0.122); ctx.lineTo(ax2 - W * 0.005, stFloor - H * 0.063); ctx.stroke();
      }
      // 창 불빛이 새어나오는 카페 창
      ctx.fillStyle = `rgba(255,240,200,${0.55 + 0.1 * Math.sin(t * 1.6)})`;
      ctx.fillRect(W * 0.07, stFloor - H * 0.05, W * 0.08, H * 0.045);
      ctx.fillRect(W * 0.18, stFloor - H * 0.05, W * 0.08, H * 0.045);
      // 자갈길 — 원근 아치 줄
      g = ctx.createLinearGradient(0, stFloor, 0, H);
      g.addColorStop(0, '#404040'); g.addColorStop(1, '#0f0f0f');
      ctx.fillStyle = g; ctx.fillRect(0, stFloor, W, H - stFloor);
      ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 1.4;
      for (let r2 = 0; r2 < 5; r2++) {
        const py = stFloor + (H - stFloor) * Math.pow((r2 + 1) / 5, 1.3);
        const cw = S * (0.16 + r2 * 0.09);
        for (let x2 = -cw; x2 < W + cw; x2 += cw) {
          ctx.beginPath(); ctx.arc(x2 + (r2 % 2) * cw * 0.5, py, cw * 0.55, Math.PI, 0); ctx.stroke();
        }
      }
      // 가로등 — 따뜻한 불빛과 바닥 웅덩이
      [[0.33], [0.72]].forEach(([fx2]) => {
        const lx = W * fx2, lampY = stFloor - H * 0.3;
        ctx.strokeStyle = '#050505'; ctx.lineWidth = S * 0.05; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(lx, stFloor + H * 0.02); ctx.lineTo(lx, lampY); ctx.stroke();
        ctx.fillStyle = '#050505';
        ctx.beginPath(); ctx.arc(lx, lampY - S * 0.09, S * 0.09, 0, 7); ctx.fill();
        const lg2 = ctx.createRadialGradient(lx, lampY - S * 0.06, 0, lx, lampY - S * 0.06, S * 1.5);
        lg2.addColorStop(0, 'rgba(255,238,190,0.85)'); lg2.addColorStop(0.12, 'rgba(255,238,190,0.4)'); lg2.addColorStop(1, 'rgba(255,238,190,0)');
        ctx.fillStyle = lg2; ctx.fillRect(lx - S * 1.6, lampY - S * 1.6, S * 3.2, S * 3.2);
        ctx.save();
        ctx.translate(lx, stFloor + (H - stFloor) * 0.42); ctx.scale(1, 0.3);
        const pg2 = ctx.createRadialGradient(0, 0, 0, 0, 0, S * 1.1);
        pg2.addColorStop(0, 'rgba(255,238,190,0.32)'); pg2.addColorStop(1, 'rgba(255,238,190,0)');
        ctx.fillStyle = pg2; ctx.beginPath(); ctx.arc(0, 0, S * 1.1, 0, 7); ctx.fill();
        ctx.restore();
      });
      });   // ── street 플레이트 끝
      // 생쥐 — 자갈길을 총총 내달린다. 중간에 한 번 멈춰 두리번('…')
      const pauseA = s > 2.6 && s < 3.4;
      const runU = seg2(s, 0.4, 5.8) - (seg2(s, 2.4, 2.6) - seg2(s, 3.4, 3.6)) * 0.1;
      const mx2 = W * (0.06 + runU * 0.75);
      const hop = pauseA ? 0 : Math.abs(Math.sin(s * 11)) * S * 0.05;
      const my2 = stFloor + (H - stFloor) * 0.35 - hop;
      shadow(mx2, stFloor + (H - stFloor) * 0.42, S * 0.42, S * 0.09, 0.5);
      silhouetteDraw(cctx, 3, mx2 - S * 0.45, my2 - S * 0.8, S * 0.9, t, false, 'neutral', true, characterColor(3));
      if (s > 2.7 && s < 3.6) drawIntroMark(ctx, '…', mx2, my2 - S * 1.15, S * 0.34, seg2(s, 2.7, 2.95) * (1 - seg2(s, 3.3, 3.6)), '#fff');
      fxOnce('night', () => uiClick(0.2));
      fxOnce('scurry', () => { [0, 220, 440, 660, 880].forEach((d) => setTimeout(() => typeKey('m', 0.25, characterVoice(3)), d)); });
    } else {
    // ── ③-B 부엌 — 컷 이후 로컬 시계(장면 안 초 값은 그대로) ──
    const sKitchen = s - MOUSE_CUT;
    { const s = sKitchen;
    const floorY = H * 0.68;
    // 김(스팀)용 냄비 좌표 — 플레이트 밖(동적 그리기)에서도 쓴다
    const potX = W * 0.905, potW2 = S * 0.34, potH2 = S * 0.26, potY = H * 0.47 - H * 0.004;
    plate('kitchen', () => {
    let g = ctx.createLinearGradient(0, 0, 0, floorY);
    g.addColorStop(0, '#b2b2b2'); g.addColorStop(1, '#e6e6e6');   // 벽지가 읽히게 밝은 바탕
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, floorY);
    // ── 벽지 — 윌리엄 모리스풍(Willow Boughs): 굽이치는 줄기 + 잎 부채살 + 열매 점, 잉크 톤 ──
    {
      const tw = S * 1.15, th = S * 1.9;
      const tile = document.createElement('canvas');
      tile.width = Math.ceil(tw); tile.height = Math.ceil(th);
      const tg = tile.getContext('2d');
      const stemX = (u, yy) => (u + Math.sin((yy / th) * Math.PI * 2) * 0.16) * tw;   // 주기=타일 높이 → 이음매 없음
      const leaf = (lx, ly, ang, len) => {
        tg.save(); tg.translate(lx, ly); tg.rotate(ang);
        tg.beginPath();
        tg.moveTo(0, 0);
        tg.quadraticCurveTo(len * 0.5, -len * 0.23, len, 0);
        tg.quadraticCurveTo(len * 0.5, len * 0.23, 0, 0);
        tg.closePath();
        tg.fillStyle = 'rgba(70,70,70,0.5)'; tg.fill();
        tg.strokeStyle = 'rgba(30,30,30,0.6)'; tg.lineWidth = 1.5; tg.stroke();
        tg.beginPath(); tg.moveTo(len * 0.12, 0); tg.lineTo(len * 0.85, 0);           // 잎맥
        tg.strokeStyle = 'rgba(255,255,255,0.5)'; tg.lineWidth = 1; tg.stroke();
        tg.restore();
      };
      [[0.26, 0], [0.76, th * 0.5]].forEach(([u, ph0]) => {
        for (const dx of [-tw, 0, tw]) {                                              // 가로 랩
          tg.strokeStyle = 'rgba(40,40,40,0.65)'; tg.lineWidth = 2.6; tg.beginPath();
          for (let yy = -th * 0.1; yy <= th * 1.1; yy += th * 0.04) {
            const xx = stemX(u, yy + ph0) + dx;
            yy <= -th * 0.1 + 1e-6 ? tg.moveTo(xx, yy) : tg.lineTo(xx, yy);
          }
          tg.stroke();
          for (let k = -1; k <= 8; k++) {                                             // 세로 랩 포함 잎 노드
            const ly = (k / 7) * th;
            const lx = stemX(u, ly + ph0) + dx;
            const side = k % 2 ? 1 : -1;
            const slope = Math.cos(((ly + ph0) / th) * Math.PI * 2) * 0.5;
            const base = side * (Math.PI / 2.6) + slope;
            leaf(lx, ly, base, tw * 0.3);                                             // 부채살 3장
            leaf(lx, ly, base - side * 0.42, tw * 0.24);
            leaf(lx, ly, base + side * 0.38, tw * 0.2);
            tg.fillStyle = 'rgba(35,35,35,0.6)';                                      // 열매 점
            tg.beginPath(); tg.arc(lx - side * tw * 0.055, ly - th * 0.02, 1.9, 0, 7); tg.fill();
          }
        }
      });
      const pat = ctx.createPattern(tile, 'repeat');
      ctx.fillStyle = pat; ctx.fillRect(0, 0, W, floorY);
    }
    g = ctx.createLinearGradient(0, floorY, 0, H);
    g.addColorStop(0, '#bdbdbd'); g.addColorStop(1, '#606060');
    ctx.fillStyle = g; ctx.fillRect(0, floorY, W, H - floorY);
    // ── 부엌(사진 레퍼런스) ── 흰 액자식 찬장·서브웨이 타일·레인지후드·걸린 조리도구·서랍장·원목 마루
    const KX = W * 0.42;                                       // 부엌 가구 시작
    const counterY = H * 0.47, counterTh = S * 0.10;           // 상판 높이·두께
    const cabTop = H * 0.045, cabBot = H * 0.265;              // 위 찬장 상·하단
    // 액자식(섀이커) 문 한 짝 — 몰딩 패널 + 안쪽 그늘 + 둥근 노브
    const cabDoor = (x, y, w2, h2, knobSide = 1) => {
      ctx.fillStyle = '#ececec'; ctx.fillRect(x, y, w2, h2);
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 2; ctx.strokeRect(x, y, w2, h2);
      ctx.strokeStyle = 'rgba(0,0,0,0.32)'; ctx.lineWidth = 1.6;
      ctx.strokeRect(x + w2 * 0.14, y + h2 * 0.10, w2 * 0.72, h2 * 0.80);
      ctx.fillStyle = '#d3d3d3';
      ctx.fillRect(x + w2 * 0.14, y + h2 * 0.10, w2 * 0.72, h2 * 0.055);   // 패널 위쪽 그늘
      ctx.fillStyle = '#6e6e6e';
      ctx.beginPath();
      ctx.arc(x + (knobSide > 0 ? w2 * 0.90 : w2 * 0.10), y + h2 * 0.52, Math.max(2.5, w2 * 0.035), 0, 7);
      ctx.fill();
    };
    // 위 찬장 몸체 + 문 4짝
    ctx.fillStyle = '#f2f2f2'; ctx.fillRect(KX, cabTop, W * 0.435, cabBot - cabTop);
    for (let d = 0; d < 4; d++) {
      cabDoor(KX + W * (0.010 + d * 0.107), cabTop + H * 0.012, W * 0.098, cabBot - cabTop - H * 0.024, d % 2 ? -1 : 1);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(KX, cabBot, W * 0.435, H * 0.009);   // 찬장 밑면 그늘
    // 레인지후드(스테인리스) + 덕트 — 오른쪽 끝
    const hoodL = W * 0.868, hoodR = W * 0.998, hoodY = H * 0.30;
    ctx.fillStyle = '#9a9a9a';
    ctx.fillRect((hoodL + hoodR) / 2 - W * 0.021, 0, W * 0.042, hoodY - H * 0.075);
    let hg = ctx.createLinearGradient(hoodL, 0, hoodR, 0);
    hg.addColorStop(0, '#c9c9c9'); hg.addColorStop(0.45, '#f1f1f1'); hg.addColorStop(1, '#8f8f8f');
    ctx.fillStyle = hg;
    ctx.beginPath();
    ctx.moveTo(hoodL + W * 0.026, hoodY - H * 0.075);
    ctx.lineTo(hoodR - W * 0.026, hoodY - H * 0.075);
    ctx.lineTo(hoodR, hoodY); ctx.lineTo(hoodL, hoodY);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#5f5f5f'; ctx.fillRect(hoodL, hoodY, hoodR - hoodL, H * 0.012);      // 하단 립
    // 서브웨이 타일 백스플래시(엇갈린 벽돌식, 은은한 광)
    g = ctx.createLinearGradient(0, cabBot, 0, counterY);
    g.addColorStop(0, '#d8d8d8'); g.addColorStop(1, '#f4f4f4');
    ctx.fillStyle = g; ctx.fillRect(KX, cabBot + H * 0.009, W - KX, counterY - cabBot - H * 0.009);
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1.1;
    const tH2 = H * 0.030, tW2 = W * 0.052;
    let rowI = 0;
    for (let ty = cabBot + H * 0.009; ty < counterY; ty += tH2, rowI++) {
      ctx.beginPath(); ctx.moveTo(KX, ty); ctx.lineTo(W, ty); ctx.stroke();
      for (let tx = KX + (rowI % 2) * tW2 * 0.5; tx <= W; tx += tW2) {
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx, Math.min(ty + tH2, counterY)); ctx.stroke();
      }
    }
    // 조리도구 걸이봉 — 나무국자·뒤집개·팬이 대롱대롱(사진 레퍼런스)
    const railY = cabBot + H * 0.045;
    ctx.strokeStyle = '#4a4a4a'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(KX + W * 0.015, railY); ctx.lineTo(KX + W * 0.225, railY); ctx.stroke();
    const hang = (hx2, len, head) => {
      ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.arc(hx2, railY + 4, 3.6, 0, 7); ctx.stroke();                  // 고리
      ctx.beginPath(); ctx.moveTo(hx2, railY + 7); ctx.lineTo(hx2, railY + len); ctx.stroke();
      head(hx2, railY + len);
    };
    hang(KX + W * 0.035, S * 0.30, (x2, y2) => {   // 나무 국자 — 둥근 볼
      ctx.fillStyle = '#8a8272';
      ctx.beginPath(); ctx.ellipse(x2, y2 + S * 0.05, S * 0.062, S * 0.075, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.4; ctx.stroke();
    });
    hang(KX + W * 0.085, S * 0.36, (x2, y2) => {   // 뒤집개 — 구멍 뚫린 판
      ctx.fillStyle = '#b9b9b9';
      ctx.fillRect(x2 - S * 0.05, y2, S * 0.10, S * 0.14);
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.4;
      ctx.strokeRect(x2 - S * 0.05, y2, S * 0.10, S * 0.14);
      ctx.fillStyle = '#5a5a5a';
      for (let sl = 0; sl < 3; sl++) ctx.fillRect(x2 - S * 0.03, y2 + S * (0.03 + sl * 0.036), S * 0.06, S * 0.012);
    });
    hang(KX + W * 0.14, S * 0.26, (x2, y2) => {    // 작은 팬 — 옆모습
      ctx.fillStyle = '#2c2c2c';
      ctx.beginPath(); ctx.ellipse(x2, y2 + S * 0.05, S * 0.085, S * 0.06, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.ellipse(x2, y2 + S * 0.035, S * 0.07, S * 0.03, 0, Math.PI, 0); ctx.stroke();
    });
    hang(KX + W * 0.19, S * 0.33, (x2, y2) => {    // 거품기 — 타원 살
      ctx.strokeStyle = '#7d7d7d'; ctx.lineWidth = 1.5;
      for (let wk = -1; wk <= 1; wk++) {
        ctx.beginPath(); ctx.ellipse(x2, y2 + S * 0.07, S * 0.028 * (1 + Math.abs(wk)), S * 0.085, wk * 0.35, 0, 7); ctx.stroke();
      }
    });
    // 조리대 상판 — 밝은 석재 슬랩(앞면 두께·그늘)
    g = ctx.createLinearGradient(0, counterY, 0, counterY + counterTh);
    g.addColorStop(0, '#f5f5f5'); g.addColorStop(1, '#b5b5b5');
    ctx.fillStyle = g; ctx.fillRect(KX - W * 0.012, counterY, W - KX + W * 0.012, counterTh);
    ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 2;
    ctx.strokeRect(KX - W * 0.012, counterY, W - KX + W * 0.012, counterTh);
    // 싱크볼 + 구스넥 수도꼭지
    ctx.fillStyle = '#8e8e8e';
    ctx.fillRect(W * 0.56, counterY + counterTh * 0.14, W * 0.125, counterTh * 0.6);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.5;
    ctx.strokeRect(W * 0.56, counterY + counterTh * 0.14, W * 0.125, counterTh * 0.6);
    ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = S * 0.045; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(W * 0.665, counterY - H * 0.002);
    ctx.lineTo(W * 0.665, H * 0.385);
    ctx.quadraticCurveTo(W * 0.665, H * 0.358, W * 0.64, H * 0.358);
    ctx.lineTo(W * 0.625, H * 0.358);
    ctx.stroke();
    ctx.beginPath(); ctx.moveTo(W * 0.625, H * 0.358); ctx.lineTo(W * 0.625, H * 0.374); ctx.stroke();
    // 도마(벽에 기대 세움) + 유리병
    ctx.fillStyle = '#a99f8a';
    ctx.beginPath();
    ctx.moveTo(W * 0.445, counterY); ctx.lineTo(W * 0.452, H * 0.365);
    ctx.quadraticCurveTo(W * 0.472, H * 0.352, W * 0.492, H * 0.365);
    ctx.lineTo(W * 0.50, counterY); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.fillStyle = 'rgba(230,230,230,0.9)';
    ctx.fillRect(W * 0.515, H * 0.415, W * 0.022, counterY - H * 0.415);   // 병
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1.4;
    ctx.strokeRect(W * 0.515, H * 0.415, W * 0.022, counterY - H * 0.415);
    ctx.fillStyle = '#777'; ctx.fillRect(W * 0.515, H * 0.408, W * 0.022, H * 0.009);      // 뚜껑
    // 가스레인지(후드 아래) — 화구 두 개 + 김 나는 냄비
    ctx.fillStyle = '#1e1e1e';
    ctx.fillRect(W * 0.875, counterY - H * 0.006, W * 0.115, H * 0.008);   // 쿡탑 슬림 슬랩
    ctx.fillStyle = '#3c3c3c';
    ctx.beginPath(); ctx.ellipse(W * 0.955, counterY - H * 0.004, W * 0.017, H * 0.006, 0, 0, 7); ctx.fill();   // 빈 화구
    g = ctx.createLinearGradient(potX - potW2 / 2, 0, potX + potW2 / 2, 0);
    g.addColorStop(0, '#4a4a4a'); g.addColorStop(0.35, '#0f0f0f'); g.addColorStop(1, '#000');
    ctx.fillStyle = g;
    ctx.fillRect(potX - potW2 / 2, potY - potH2, potW2, potH2);            // 냄비 몸통
    ctx.fillStyle = '#5d5d5d';
    ctx.fillRect(potX - potW2 * 0.56, potY - potH2, potW2 * 1.12, potH2 * 0.12);   // 뚜껑
    ctx.beginPath(); ctx.arc(potX, potY - potH2 * 1.12, potW2 * 0.07, 0, 7); ctx.fill();   // 꼭지
    ctx.strokeStyle = '#5d5d5d'; ctx.lineWidth = S * 0.035;
    [[-1], [1]].forEach(([sgn]) => {                                        // 양쪽 손잡이
      ctx.beginPath();
      ctx.arc(potX + sgn * potW2 * 0.52, potY - potH2 * 0.62, potW2 * 0.1, sgn > 0 ? -Math.PI / 2 : Math.PI / 2, sgn > 0 ? Math.PI / 2 : -Math.PI / 2 + Math.PI * 2 * 0);
      ctx.stroke();
    });
    // (김은 동적이라 플레이트 밖에서 매 프레임 그린다)
    // 아래 수납장 — 문 4짝 + 오른쪽 서랍 3단(사진 레퍼런스) + 토킥 그늘
    const lowY = counterY + counterTh;
    ctx.fillStyle = '#e6e6e6'; ctx.fillRect(KX, lowY, W - KX, floorY - lowY);
    for (let d = 0; d < 4; d++) {
      cabDoor(KX + W * (0.012 + d * 0.118), lowY + H * 0.012, W * 0.11, floorY - lowY - H * 0.05, d % 2 ? -1 : 1);
    }
    const drwX = KX + W * 0.492, drwW = W * 0.095;
    const drwH = (floorY - lowY - H * 0.05) / 3;
    for (let d = 0; d < 3; d++) {
      const dy2 = lowY + H * 0.012 + d * drwH;
      ctx.fillStyle = '#ececec'; ctx.fillRect(drwX, dy2, drwW, drwH - H * 0.006);
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 2;
      ctx.strokeRect(drwX, dy2, drwW, drwH - H * 0.006);
      ctx.fillStyle = '#6e6e6e';                                            // 바 손잡이
      ctx.fillRect(drwX + drwW * 0.3, dy2 + drwH * 0.24, drwW * 0.4, Math.max(3, drwH * 0.07));
    }
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(KX, floorY - H * 0.016, W - KX, H * 0.016);   // 토킥
    // 창문(왼쪽) — 2×2 창살 + 창턱 + 화분, 그리고 빛
    const wx = W * 0.09, wy = H * 0.09, ww = W * 0.15, wh = H * 0.30;
    ctx.fillStyle = 'rgba(255,255,255,0.94)'; ctx.fillRect(wx, wy, ww, wh);
    g = ctx.createLinearGradient(wx, wy, wx + ww, wy + wh);                 // 유리의 은은한 결
    g.addColorStop(0, 'rgba(200,200,200,0)'); g.addColorStop(0.5, 'rgba(190,190,190,0.35)'); g.addColorStop(1, 'rgba(200,200,200,0)');
    ctx.fillStyle = g; ctx.fillRect(wx, wy, ww, wh);
    ctx.strokeStyle = 'rgba(0,0,0,0.65)'; ctx.lineWidth = 4;
    ctx.strokeRect(wx, wy, ww, wh);
    ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(wx + ww / 2, wy); ctx.lineTo(wx + ww / 2, wy + wh); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(wx, wy + wh / 2); ctx.lineTo(wx + ww, wy + wh / 2); ctx.stroke();
    ctx.fillStyle = '#cfcfcf'; ctx.fillRect(wx - ww * 0.06, wy + wh, ww * 1.12, H * 0.014);       // 창턱
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.6;
    ctx.strokeRect(wx - ww * 0.06, wy + wh, ww * 1.12, H * 0.014);
    ctx.fillStyle = '#5a5a5a';                                              // 화분 + 풀 몇 가닥
    ctx.beginPath();
    ctx.moveTo(wx + ww * 0.72, wy + wh); ctx.lineTo(wx + ww * 0.78, wy + wh - H * 0.028);
    ctx.lineTo(wx + ww * 0.92, wy + wh - H * 0.028); ctx.lineTo(wx + ww * 0.98, wy + wh);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#3f3f3f'; ctx.lineWidth = 1.8;
    for (let lf = 0; lf < 4; lf++) {
      ctx.beginPath();
      ctx.moveTo(wx + ww * 0.85, wy + wh - H * 0.028);
      ctx.quadraticCurveTo(wx + ww * (0.72 + lf * 0.09), wy + wh - H * 0.055, wx + ww * (0.66 + lf * 0.13), wy + wh - H * (0.065 + (lf % 2) * 0.02));
      ctx.stroke();
    }
    const lg2 = ctx.createLinearGradient(wx, wy + wh, wx + ww * 1.6, H);
    lg2.addColorStop(0, 'rgba(255,255,255,0.5)'); lg2.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = lg2;
    ctx.beginPath();
    ctx.moveTo(wx, wy + wh); ctx.lineTo(wx + ww, wy + wh);
    ctx.lineTo(wx + ww * 2.3, H * 0.96); ctx.lineTo(wx - ww * 0.3, H * 0.96);
    ctx.closePath(); ctx.fill();
    // 원목 마루 — 널판 결(가로선 + 엇갈린 이음매)
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, floorY); ctx.lineTo(W, floorY); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.32)'; ctx.lineWidth = 1.5;
    let prevY = floorY;
    for (let r2 = 1; r2 <= 4; r2++) {
      const py = floorY + Math.pow(r2 / 4, 1.35) * (H - floorY);
      ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(W, py); ctx.stroke();
      const off = ((r2 * 137) % 29) / 29;
      for (let px2 = off * W * 0.34; px2 < W; px2 += W * 0.34) {            // 널판 세로 이음
        ctx.beginPath(); ctx.moveTo(px2, prevY + 1); ctx.lineTo(px2 - W * 0.008, py - 1); ctx.stroke();
      }
      prevY = py;
    }
    // ── 디테일 더 + 살짝 튼 시점(오른쪽 면·윗면이 보이는 유사 3D) ──
    // 위 찬장 오른쪽 옆면 + 아랫면 띠
    ctx.fillStyle = '#b5b5b5';
    ctx.beginPath();
    ctx.moveTo(KX + W * 0.435, cabTop);
    ctx.lineTo(KX + W * 0.453, cabTop + H * 0.014);
    ctx.lineTo(KX + W * 0.453, cabBot + H * 0.014);
    ctx.lineTo(KX + W * 0.435, cabBot);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.fillStyle = '#a3a3a3';
    ctx.beginPath();
    ctx.moveTo(KX, cabBot); ctx.lineTo(KX + W * 0.435, cabBot);
    ctx.lineTo(KX + W * 0.453, cabBot + H * 0.014); ctx.lineTo(KX + W * 0.018, cabBot + H * 0.014);
    ctx.closePath(); ctx.fill();
    // 조리대 윗면 — 위에서 살짝 내려다본 밝은 면(가장자리 하이라이트)
    ctx.fillStyle = '#fafafa';
    ctx.beginPath();
    ctx.moveTo(KX - W * 0.012, counterY);
    ctx.lineTo(W, counterY);
    ctx.lineTo(W, counterY - H * 0.011);
    ctx.lineTo(KX + W * 0.004, counterY - H * 0.011);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1.1; ctx.stroke();
    // 아래 수납장 오른쪽 옆면(그늘)
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.moveTo(W * 0.998, counterY + S * 0.1); ctx.lineTo(W, counterY + S * 0.1);
    ctx.lineTo(W, floorY); ctx.lineTo(W * 0.998, floorY);
    ctx.closePath(); ctx.fill();
    // 벽 선반 + 유리병 셋
    const shX = W * 0.26, shY = H * 0.3, shW = W * 0.13;
    ctx.fillStyle = '#d9d9d9'; ctx.fillRect(shX, shY, shW, H * 0.012);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.4; ctx.strokeRect(shX, shY, shW, H * 0.012);
    for (let j2 = 0; j2 < 3; j2++) {
      const jx2 = shX + shW * (0.12 + j2 * 0.3), jw2 = shW * 0.18, jh2 = H * (0.045 + (j2 % 2) * 0.016);
      ctx.fillStyle = 'rgba(238,238,238,0.92)';
      ctx.fillRect(jx2, shY - jh2, jw2, jh2);
      ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1.2; ctx.strokeRect(jx2, shY - jh2, jw2, jh2);
      ctx.fillStyle = '#8a8a8a'; ctx.fillRect(jx2, shY - jh2 - H * 0.008, jw2, H * 0.008);           // 뚜껑
      ctx.fillStyle = 'rgba(130,130,130,0.55)'; ctx.fillRect(jx2 + 2, shY - jh2 * 0.55, jw2 - 4, jh2 * 0.55 - 2);   // 내용물
    }
    // 벽시계 — 선반 위
    const ckX = W * 0.325, ckY = H * 0.17, ckR = S * 0.15;
    ctx.fillStyle = '#f4f4f4'; ctx.beginPath(); ctx.arc(ckX, ckY, ckR, 0, 7); ctx.fill();
    ctx.strokeStyle = '#111'; ctx.lineWidth = 3; ctx.stroke();
    ctx.lineWidth = 1.2;
    for (let h2 = 0; h2 < 12; h2++) {
      const a = h2 * Math.PI / 6;
      ctx.beginPath();
      ctx.moveTo(ckX + Math.cos(a) * ckR * 0.8, ckY + Math.sin(a) * ckR * 0.8);
      ctx.lineTo(ckX + Math.cos(a) * ckR * 0.92, ckY + Math.sin(a) * ckR * 0.92);
      ctx.stroke();
    }
    ctx.lineWidth = 2.4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(ckX, ckY); ctx.lineTo(ckX + ckR * 0.46, ckY - ckR * 0.24); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ckX, ckY); ctx.lineTo(ckX - ckR * 0.1, ckY - ckR * 0.66); ctx.stroke();
    // 토스터 — 도마 옆 조리대 위
    const toX = W * 0.47, toY2 = counterY - H * 0.011;
    ctx.fillStyle = '#c9c9c9';
    ctx.beginPath(); ctx.roundRect(toX - S * 0.16, toY2 - S * 0.16, S * 0.32, S * 0.16, S * 0.045); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.fillStyle = '#3a3a3a';
    ctx.fillRect(toX - S * 0.1, toY2 - S * 0.155, S * 0.085, S * 0.02);
    ctx.fillRect(toX + S * 0.02, toY2 - S * 0.155, S * 0.085, S * 0.02);
    ctx.fillRect(toX + S * 0.15, toY2 - S * 0.1, S * 0.02, S * 0.05);       // 레버
    // 과일 그릇 — 싱크 오른쪽
    const fbX = W * 0.8, fbY = counterY - H * 0.011;
    ['#9c9c9c', '#c6c6c6', '#8a8a8a'].forEach((tone2, fi) => {
      ctx.fillStyle = tone2;
      ctx.beginPath(); ctx.arc(fbX - S * 0.085 + fi * S * 0.085, fbY - S * 0.1, S * 0.055, 0, 7); ctx.fill();
    });
    ctx.fillStyle = '#2e2e2e';
    ctx.beginPath(); ctx.ellipse(fbX, fbY - S * 0.05, S * 0.19, S * 0.08, 0, 0, Math.PI); ctx.fill();
    // 걸린 컵 셋 — 오른쪽 찬장 밑 고리
    for (let c2 = 0; c2 < 3; c2++) {
      const cx3 = W * (0.75 + c2 * 0.036), cy3 = cabBot + H * 0.045;
      ctx.strokeStyle = '#2f2f2f'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx3, cabBot + H * 0.014); ctx.lineTo(cx3, cy3); ctx.stroke();
      ctx.fillStyle = c2 % 2 ? '#dcdcdc' : '#b5b5b5';
      ctx.beginPath(); ctx.roundRect(cx3 - S * 0.05, cy3, S * 0.1, S * 0.085, S * 0.02); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.4; ctx.stroke();
      ctx.beginPath(); ctx.arc(cx3 + S * 0.06, cy3 + S * 0.042, S * 0.026, -Math.PI / 2, Math.PI / 2); ctx.stroke();
    }
    // 러그 — 바닥에 원근 사다리꼴(살짝 튼 시점)
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.beginPath();
    ctx.moveTo(W * 0.16, floorY + (H - floorY) * 0.24);
    ctx.lineTo(W * 0.44, floorY + (H - floorY) * 0.24);
    ctx.lineTo(W * 0.5, floorY + (H - floorY) * 0.74);
    ctx.lineTo(W * 0.1, floorY + (H - floorY) * 0.74);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(W * 0.18, floorY + (H - floorY) * 0.33); ctx.lineTo(W * 0.452, floorY + (H - floorY) * 0.33); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(W * 0.135, floorY + (H - floorY) * 0.62); ctx.lineTo(W * 0.478, floorY + (H - floorY) * 0.62); ctx.stroke();
    // 커튼 — 창 양옆의 천(주름)
    [[wx - ww * 0.18, -0.06], [wx + ww + ww * 0.02, 0.2]].forEach(([cxL, bow]) => {
      ctx.fillStyle = '#c6c6c6';
      ctx.beginPath();
      ctx.moveTo(cxL, wy - H * 0.02);
      ctx.lineTo(cxL + ww * 0.15, wy - H * 0.02);
      ctx.quadraticCurveTo(cxL + ww * (0.15 + bow), wy + wh * 0.5, cxL + ww * 0.13, wy + wh + H * 0.05);
      ctx.lineTo(cxL - ww * 0.02, wy + wh + H * 0.05);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1.4; ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      for (let f2 = 0; f2 < 3; f2++) {
        ctx.beginPath();
        ctx.moveTo(cxL + ww * (0.03 + f2 * 0.038), wy - H * 0.01);
        ctx.quadraticCurveTo(cxL + ww * (0.05 + f2 * 0.038 + bow * 0.3), wy + wh * 0.5, cxL + ww * (0.02 + f2 * 0.04), wy + wh + H * 0.04);
        ctx.stroke();
      }
    });
    // 바닥 원근 — 사선 이음 두 줄(정면이 아니라 살짝 튼 공간감)
    ctx.strokeStyle = 'rgba(0,0,0,0.26)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(W * 0.06, floorY); ctx.lineTo(W * -0.1, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(W * 0.95, floorY); ctx.lineTo(W * 1.12, H); ctx.stroke();
    });   // ── kitchen 플레이트 끝
    // 김 — 하늘하늘 올라가는 세 줄기(동적, 매 프레임)
    ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
    for (let st2 = 0; st2 < 3; st2++) {
      const sx2 = potX - potW2 * 0.25 + st2 * potW2 * 0.25;
      ctx.beginPath();
      for (let yy = 0; yy <= 6; yy++) {
        const u = yy / 6;
        const px2 = sx2 + Math.sin(u * Math.PI * 2 + t * 2.4 + st2 * 1.7) * S * 0.05 * u;
        const py2 = potY - potH2 * 1.2 - u * S * 0.55;
        yy === 0 ? ctx.moveTo(px2, py2) : ctx.lineTo(px2, py2);
      }
      ctx.stroke();
    }
    // 부스러기 길 — 오른쪽(싱크대 밑)에서 왼쪽으로 점점이
    const crumbs = [];
    for (let i = 0; i < 9; i++) crumbs.push([W * (0.76 - i * 0.055), floorY + S * 0.32 + Math.sin(i * 2.1) * S * 0.07]);
    // 생쥐(연보라) — 부스러기를 따라 쫄쫄쫄(멈칫멈칫)
    const runU = Math.min(1, (s < 1.4 ? seg2(s, 0.2, 1.4) * 0.45 : s < 1.9 ? 0.45 : 0.45 + seg2(s, 1.9, 3.1) * 0.55));
    const dashOut = seg2(s, 3.5, 4.3);
    const mx = W * (0.78 - runU * 0.36) - dashOut * W * 0.55;
    const my = floorY + S * 0.18;
    const nib = (s > 1.35 && s < 1.95) || (s > 2.9 && s < 3.4) ? Math.abs(Math.sin(t * 9)) * 3 : 0;
    crumbs.forEach(([cx2, cy2], i) => {
      if (cx2 < mx - S * 0.2 || s > 5.4) return;   // 먹었거나 빗자루가 쓸어감
      ctx.fillStyle = ink;
      ctx.beginPath(); ctx.arc(cx2, cy2, 3, 0, 7); ctx.fill();
    });
    if (mx > -S) {
      shadow(mx, floorY + S * 0.42, S * 0.5, S * 0.12, 0.4);
      silhouetteDraw(cctx, 3, mx - S / 2, my - S / 2 + nib * 0.3, S, t, nib > 0 && Math.sin(t * 10) > 0, dashOut > 0 ? 'sad' : 'neutral', false, characterColor(3));
    }
    if (s < 3.2) fxOnce('nib' + Math.floor(s / 0.45), () => typeKey('m', 0.3, characterVoice(3)));
    // (발 쿵 장면은 삭제) 빗자루 — 오른쪽에서 들어와 바닥을 쓸어낸다(스윽스윽). 생쥐는 이걸 보고 줄행랑.
    const broomIn = seg2(s, 3.0, 3.7);
    if (broomIn > 0) {
      // 스윙 — 자루 위쪽(손 근처)을 축으로 좌우로 쓸어낸다
      const swing = s > 3.7 ? Math.sin((s - 3.7) * 3.2) * 0.16 * (1 - seg2(s, 6.6, 7.4)) : 0;
      const hx = W * (1.04 - broomIn * 0.3), hy = floorY - H * 0.78;    // 축(손 위치)
      const ang = Math.PI * 0.62 + swing;                               // 기울기
      // ── 짚 빗자루(참조 사진 기반) — 비트(픽셀) 스타일. 어두운 가는 자루 + 넓게 퍼지는 볏짚 ──
      const cs = Math.max(4, S * 0.072);   // 픽셀 셀 한 변(비트이미지 해상도)
      const cell = (x, y, col) => { ctx.fillStyle = col; ctx.fillRect(x - cs * 0.5, y, cs + 0.6, cs + 0.6); };
      ctx.save();
      ctx.translate(hx, hy - S * 0.3);
      ctx.rotate(ang - Math.PI / 2);        // 로컬 +y = 빗자루 아래 방향
      const bLen2 = H * 0.55;               // 자루 길이(가늘고 길게)
      const brushLen = S * 1.9;             // 볏짚 길이 — 넓게 퍼짐
      // ── 자루 — 어둡고 가는 막대(살짝 굽음) + 대나무 하이라이트 한 줄 ──
      for (let y = 0; y <= bLen2; y += cs) {
        const bend = Math.sin(y / bLen2 * 1.15) * S * 0.05;
        cell(bend - cs * 0.5, y, '#1b1611'); cell(bend + cs * 0.5, y, '#241d15');   // 2셀 두께
        if ((y / cs | 0) % 2 === 0) cell(bend + cs * 1.1, y, 'rgba(210,210,210,0.5)');   // 결 하이라이트
      }
      // ── 노끈 감기(목의 밴드) — 밝고 어두운 띠 교차 ──
      const neckY = bLen2;
      for (let b = 0; b < 5; b++) {
        const y = neckY - cs + b * cs, hw = S * 0.1 + b * S * 0.018;
        for (let cx3 = -hw; cx3 <= hw; cx3 += cs) cell(cx3, y, b % 2 ? '#d7ca9e' : '#8a7a54');
      }
      // ── 볏짚 — 부챗살로 아래로 넓어지고, 컬럼마다 끝이 갈라진다(프레이). 셀 단위로 채운다 ──
      const strawTop = neckY + cs, colN = Math.ceil(S * 1.02 / cs);
      for (let y = strawTop; y < strawTop + brushLen; y += cs) {
        const prog = (y - strawTop) / brushLen;
        const hw = S * 0.11 + (S * 1.02 - S * 0.11) * Math.pow(prog, 0.72);   // 아래로 넓게
        for (let ci = -colN; ci <= colN; ci++) {
          const cxl = ci * cs;
          if (Math.abs(cxl) > hw) continue;
          const colTip = brushLen * (1 - (Math.abs(ci) / colN) ** 2 * 0.3) - hash01(ci * 7.3) * S * 0.3;   // 프레이
          if ((y - strawTop) > colTip) continue;
          const strand = (ci % 2 === 0) ? '#d8c9a0' : '#9c8a62';                // 짚 가닥 명암
          cell(cxl, y, Math.abs(cxl) > hw * 0.82 ? '#6f6144' : strand);         // 가장자리 어둡게
        }
      }
      ctx.restore();
      // 쓸릴 때 먼지·부스러기 튐
      if (Math.abs(swing) > 0.08) {
        const sweepX = hx + Math.cos(ang) * (bLen2 + brushLen * 0.6);
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        for (let i = 0; i < 4; i++) {
          const dx2 = sweepX - S * 0.5 - i * 14 - swing * S * 2;
          ctx.beginPath(); ctx.arc(dx2, floorY + S * 0.4 - (i % 2) * 6, 2.2, 0, 7); ctx.fill();
        }
      }
      fxOnce('sweep', () => { [0, 550, 1100].forEach((d) => setTimeout(() => uiClick(0.18), d)); });
    }
    if (s > 3.2 && s < 4.0) drawIntroMark(ctx, '!', mx, my - S * 0.8, S * 0.42, seg2(s, 3.2, 3.45) * (1 - seg2(s, 3.7, 4.0)));
    // 왼쪽 구석에서 빼꼼 — '…'
    if (s > 6.2) {
      const peek = seg2(s, 6.2, 6.8);
      silhouetteDraw(cctx, 3, -S * 0.75 + peek * S * 0.9, floorY - S * 0.42, S * 1.15, t, false, 'neutral', true, characterColor(3));
      if (s > 6.8) drawIntroMark(ctx, '…', S * 1.25, floorY - S * 0.85, S * 0.42, seg2(s, 6.8, 7.3));
      fxOnce('phew', () => speakVoiceEvents([{ rel: 0, ch: 'u' }], characterVoice(3), 'sad'));
    }
    } // ③-B 로컬 시계 블록 끝
    } // if(밤거리)/else(부엌) 끝
    // 장면 전환 화이트 플래시
    {
      const f = 1 - Math.min(1, Math.abs(s - MOUSE_CUT) / 0.22);
      if (f > 0) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = `rgba(255,255,255,${f})`; ctx.fillRect(0, 0, pw, ph); ctx.restore(); }
      if (s > MOUSE_CUT) fxOnce('mcut', () => uiClick(0.5));
    }
  }

  // 필름 비네트 — 가장자리를 살짝 어둡게(실사 톤, 카메라와 무관하게 화면 고정)
  ctx.setTransform(pw / W, 0, 0, ph / H, 0, 0);
  const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.44, W / 2, H / 2, Math.max(W, H) * 0.72);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.28)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

  // 등장/퇴장 페이드(도트 밀도가 차오르고 흩어진다)
  const fade = Math.min(1, s / 0.5, (durS - s) / 0.5);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (fade < 1) { ctx.fillStyle = `rgba(255,255,255,${1 - Math.max(0, fade)})`; ctx.fillRect(0, 0, pw, ph); }

  ditherIntroCanvas();
  sctx.save();
  sctx.imageSmoothingEnabled = false;
  sctx.drawImage(introCanvas, 0, 0, W, H);
  sctx.globalAlpha = Math.max(0, fade);
  sctx.drawImage(introColorCanvas, 0, 0, W, H);
  sctx.restore();

  // ── 내레이션 자막 — 맨 밑 대화창(네모칸). 한국어+영어 두 줄이 타이핑되며
  //    찍힌 지 조금 지난 글자들이 외계어로 스르륵 변한다. 상자 폭에 맞춰 글자를 줄여 삐져나가지 않게.
  const narr = INTRO_NARR[kind] || [];
  let ln = null, li = -1;
  for (let i = 0; i < narr.length; i++) if (s >= narr[i].at) { ln = narr[i]; li = i; }
  if (ln && fade > 0.2) {
    const seedK = kind === 'phone' ? 5.7 : kind === 'mouse' ? 11.3 : 0;
    // 타이핑 + 외계어 변환 — cps에 비례해 두 줄이 함께 끝난다. 변환 확률 ~80%(외계어가 더 많이).
    const typed = (text, cps, seed) => {
      const chs = [...text];
      const n = Math.min(chs.length, Math.floor((s - ln.at) * cps));
      let out = '';
      for (let i = 0; i < n; i++) {
        const age = (s - ln.at) - i / cps;
        if (chs[i] !== ' ' && age > 0.4 && hash01(i * 3.71 + li * 13.3 + seed) > 0.2) {
          out += INTRO_ALIEN[Math.floor(hash01(i * 7.7 + li * 3.1 + seed) * INTRO_ALIEN.length)];
        } else out += chs[i];
      }
      return { out, done: n >= chs.length, n };
    };
    const koLen = [...ln.ko].length, enLen = [...(ln.en || '')].length;
    const K = typed(ln.ko, INTRO_TYPE_CPS, seedK);
    const E = ln.en ? typed(ln.en, INTRO_TYPE_CPS * Math.max(0.5, enLen / Math.max(1, koLen)), seedK + 77.7) : { out: '', done: true };
    // 낭독 — 동물의숲처럼: 글자가 찍힐 때마다 그 글자를 웅얼웅얼(들릴 듯 말 듯, 변형된 목소리)
    if (audioReady) {
      const sp = (introScene.spoken = introScene.spoken || {});
      const prev = sp[li] || 0;
      if (K.n > prev) {
        const ch = [...ln.ko][K.n - 1];
        if (ch && ch !== ' ' && !'—…,.!?'.includes(ch)) typeKey(ch, 0.16, 4 + (li % 2));
        sp[li] = K.n;
      }
    }
    sctx.save();
    // 폰트 크기 — 상자 최대 폭에 맞춰 자동 축소(삐져나감 방지).
    // 외계어 글리프(◆ 등)는 영문보다 훨씬 넓으므로 "전부 외계어가 된 경우"의 폭까지 재서 최악값으로 맞춘다.
    const alien1 = (txt) => [...txt].map((c) => (c === ' ' ? ' ' : '◆')).join('');
    let fk = Math.max(14, Math.round(Math.min(W, H) * 0.025));
    sctx.font = `${fk}px Galmuri11, Datatype, monospace`;
    const wK0 = Math.max(sctx.measureText(ln.ko).width, sctx.measureText(alien1(ln.ko)).width);
    let fe = Math.round(fk * 0.68);
    sctx.font = `${fe}px Galmuri11, Datatype, monospace`;
    const wE0 = ln.en ? Math.max(sctx.measureText(ln.en).width, sctx.measureText(alien1(ln.en)).width) : 0;
    const maxTextW = W * 0.86 - fk * 3.0;   // 캐럿(▌) 여유 포함
    const fit = Math.min(1, maxTextW / Math.max(wK0, wE0, 1));
    fk = Math.max(11, Math.floor(fk * fit)); fe = Math.max(9, Math.floor(fe * fit));
    const textW = Math.max(wK0, wE0) * fit;
    const bw2 = Math.max(W * 0.42, textW + fk * 2.2);
    const bh2 = fk * 1.55 + (ln.en ? fe * 1.7 : fk * 0.7);
    const bx2 = (W - bw2) / 2, by2 = H * 0.968 - bh2;
    sctx.fillStyle = 'rgba(255,255,255,0.96)';
    sctx.strokeStyle = '#000'; sctx.lineWidth = 2;
    sctx.beginPath(); sctx.roundRect(bx2, by2, bw2, bh2, 6); sctx.fill(); sctx.stroke();
    sctx.textAlign = 'left'; sctx.textBaseline = 'middle';
    const caretK = !K.done && Math.sin(t * 9) > -0.2 ? '▌' : '';
    sctx.fillStyle = '#000';
    sctx.font = `${fk}px Galmuri11, Datatype, monospace`;
    sctx.fillText(K.out + caretK, bx2 + fk * 1.1, by2 + fk * 0.95);
    if (ln.en) {
      const caretE = K.done && !E.done && Math.sin(t * 9) > -0.2 ? '▌' : '';
      sctx.fillStyle = '#555';
      sctx.font = `${fe}px Galmuri11, Datatype, monospace`;
      sctx.fillText(E.out + caretE, bx2 + fk * 1.1, by2 + fk * 1.55 + fe * 0.75);
    }
    sctx.restore();
  }

  if (s >= durS) endIntroScene();
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
    document.body.classList.remove('ascii-time', 'gift-time', 'ending-hud-off');
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
    if (name === 'title') { /* 시작 사운드 제거 — 타이틀은 조용히 */ }
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

// 합주·잼 동안엔 메인 화면 터치/클릭도 소리+음표 트리거 — 무대 위에서도 같이 연주한다
window.addEventListener('pointerdown', (e) => {
  if (state.screen !== 'ending' || endingPhase !== 2) return;
  if (e.target && e.target.closest && e.target.closest('button')) return;   // 버튼 클릭은 제외
  addAudienceNote();
});

// (타이틀 리버스 스웰 인트로는 사용자 요청으로 제거 — ▶ 한 번에 바로 소개로 넘어간다)

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
      // 소개 컷신 재생 중이면 풀스크린 컷신, 아니면 슬롯머신 창(릴 회전/착지)
      if (introScene) drawIntroScene(t);
      else drawSlotWindow(t);
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
    else if (d[o + 3] > A && d[o] + d[o + 1] + d[o + 2] > 620) {
      // 흰 디테일(눈·별 꼭지·이빨)은 흰색 그대로 비워 둔다
      d[o] = d[o + 1] = d[o + 2] = 255; d[o + 3] = 255;
    } else { d[o] = rgb[0]; d[o + 1] = rgb[1]; d[o + 2] = rgb[2]; d[o + 3] = 255; }
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
const ASCII_HOLD = 7000;   // 완성 후 머무는 시간(ms) — 숨쉬는 그림을 좀 더 보여준다
let asciiArt = null;       // { targets, start, cell, mark, done }
let asciiAtlas = {};       // 글리프 스프라이트 캐시 — fillText 대신 drawImage(프레임드랍 방지)

function glyphSprite(ch, px, alpha) {
  const key = ch + '|' + px + '|' + alpha;
  let cv = asciiAtlas[key];
  if (!cv) {
    cv = document.createElement('canvas');
    cv.width = cv.height = Math.ceil(px * 1.5 + 6);
    const g = cv.getContext('2d');
    g.font = `${px}px Datatype, Galmuri11, monospace`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = `rgba(0,0,0,${alpha})`;
    g.fillText(ch, cv.width / 2, cv.height / 2);
    asciiAtlas[key] = cv;
  }
  return cv;
}

// 완성 후 부호별 "숨쉬기" — 물결은 넘실, 방사선은 맥동, 파문은 번지고, 소용돌이는 감돈다.
// (tap.html artMotion과 같은 수식 — 고치면 둘 다)
function asciiMotion(mark, x, y, W, H, tm) {
  const m = Math.min(W, H);
  if (mark === 'tilde') {   // 물결 — 크게 넘실 + 잔물결
    return { dx: Math.sin(y * 0.02 + tm * 0.7) * m * 0.006, dy: Math.sin(x * 0.011 + tm * 1.9) * m * 0.028 + Math.sin(x * 0.031 + tm * 3.1) * m * 0.008 };
  }
  if (mark === 'bang') {
    const cx = W / 2, cy = H * 0.46, rx = x - cx, ry = y - cy;
    const r = Math.hypot(rx, ry) || 1, k = Math.sin(tm * 2.8 - r * 0.02) * m * 0.016;
    return { dx: rx / r * k, dy: ry / r * k };
  }
  if (mark === 'period') {
    const cx = W / 2, cy = H / 2, rx = x - cx, ry = y - cy;
    const r = Math.hypot(rx, ry) || 1, k = Math.sin(r * 0.045 - tm * 2.3) * m * 0.015;
    return { dx: rx / r * k, dy: ry / r * k };
  }
  if (mark === 'ellipsis') return { dx: Math.sin(tm * 0.9 + y * 0.02) * m * 0.014, dy: Math.sin(tm * 1.3 + x * 0.017) * m * 0.02 };
  if (mark === 'semicolon') return { dx: Math.sin(tm * 1.5 + y * 0.01) * m * 0.026 * (y / H), dy: Math.sin(tm * 1.1 + y * 0.02) * m * 0.006 };
  const cx = W / 2, cy = H * 0.48, rx = x - cx, ry = y - cy;   // question — 접선 방향으로 감돈다
  const r = Math.hypot(rx, ry) || 1, k = Math.sin(tm * 1.5 + r * 0.02) * m * 0.016;
  return { dx: -ry / r * k, dy: rx / r * k };
}

// 부호별 그림(마스크) — 검정으로 칠한 곳에 글자가 앉는다.
// 부호를 그대로 그리지 않고, 각 뉘앙스의 "느낌"만 남긴 추상 구도로 화면을 채운다.
// (tap.html의 artMaskDraw와 같은 그림 — 고치면 둘 다 고칠 것)
function asciiMaskDraw(g, mark, w, h) {
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#000'; g.strokeStyle = '#000'; g.lineCap = 'round'; g.lineJoin = 'round';
  const m = Math.min(w, h);
  const rnd = (i) => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };   // 고정 시드 — 메인·폰이 같은 그림
  if (mark === 'tilde') {
    // 물결치듯 — 서로 간섭하며 흐르는 물결 다발
    for (let k = 0; k < 7; k++) {
      g.lineWidth = m * (0.016 + rnd(k) * 0.05);
      g.beginPath();
      for (let x = 0; x <= w; x += 6) {
        const u = x / w;
        const y = h * (0.13 + k * 0.118)
          + Math.sin(u * Math.PI * (1.6 + k * 0.5) + k * 1.7) * h * (0.05 + 0.06 * rnd(k + 9))
          + Math.sin(u * Math.PI * 5.3 + k * 2.1) * h * 0.022;
        x === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.stroke();
    }
  } else if (mark === 'bang') {
    // 힘주어 — 한 점에서 사방으로 터지는 방사선
    const cx = w * 0.5, cy = h * 0.46;
    g.beginPath(); g.arc(cx, cy, m * 0.085, 0, 7); g.fill();
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2 + rnd(i) * 0.2;
      const r0 = m * (0.13 + rnd(i + 40) * 0.05);
      const r1 = m * (0.24 + rnd(i + 80) * 0.36);
      g.lineWidth = m * (0.012 + rnd(i + 120) * 0.034);
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0 * 0.96);
      g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1 * 0.96);
      g.stroke();
      // 몇 갈래는 끝에 파편 하나
      if (rnd(i + 200) > 0.6) {
        const rr = r1 + m * 0.06;
        g.beginPath(); g.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.96, m * 0.014, 0, 7); g.fill();
      }
    }
  } else if (mark === 'period') {
    // 담담하게 — 고요한 물에 번지는 파문(무거운 점과 동심원)
    const cx = w * 0.5, cy = h * 0.5;
    g.beginPath(); g.arc(cx, cy, m * 0.12, 0, 7); g.fill();
    for (let k = 1; k <= 4; k++) {
      g.lineWidth = m * (0.052 - k * 0.01);
      g.beginPath(); g.arc(cx, cy, m * (0.12 + k * 0.117), 0, 7); g.stroke();
    }
  } else if (mark === 'ellipsis') {
    // 머뭇거리며 — 흩어지며 잦아드는 점들의 행렬
    for (let i = 0; i < 36; i++) {
      const u = i / 35;
      const x = w * (0.10 + u * 0.80) + (rnd(i) - 0.5) * w * 0.09;
      const y = h * (0.70 - u * 0.44) + Math.sin(u * Math.PI * 2.4) * h * 0.13 + (rnd(i + 50) - 0.5) * h * 0.09;
      const r = m * (0.078 * (1 - u * 0.82) + 0.009);
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
  } else if (mark === 'semicolon') {
    // 망설이듯 — 흘러내리다 허공에서 끊기는 획들, 그 아래 잠깐의 점
    for (let i = 0; i < 9; i++) {
      const x = w * (0.12 + (i / 8) * 0.76) + (rnd(i) - 0.5) * w * 0.03;
      const y0 = h * (0.05 + rnd(i + 20) * 0.08);
      const len = h * (0.18 + rnd(i + 40) * 0.56);
      const xe = x + (rnd(i + 99) - 0.5) * w * 0.16;
      g.lineWidth = m * (0.02 + rnd(i + 60) * 0.038);
      g.beginPath(); g.moveTo(x, y0);
      g.quadraticCurveTo(x + (rnd(i + 80) - 0.5) * w * 0.10, y0 + len * 0.6, xe, y0 + len);
      g.stroke();
      g.beginPath(); g.arc(xe + (rnd(i + 5) - 0.5) * w * 0.02, y0 + len + h * (0.07 + rnd(i + 7) * 0.05), m * (0.013 + rnd(i + 3) * 0.02), 0, 7); g.fill();
    }
  } else {
    // 되묻듯 — 안으로 말려드는 소용돌이와 그 중심에 맺히는 점
    const cx = w * 0.5, cy = h * 0.48;
    const TURNS = Math.PI * 6.2;
    g.lineWidth = m * 0.052;
    g.beginPath();
    for (let a = 0; a <= TURNS; a += 0.05) {
      const r = m * 0.47 * Math.pow(1 - a / (TURNS + 0.6), 1.12);
      const x = cx + Math.cos(a - Math.PI / 2) * r;
      const y = cy + Math.sin(a - Math.PI / 2) * r * 0.94;
      a === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.stroke();
    g.beginPath(); g.arc(cx, cy, m * 0.04, 0, 7); g.fill();
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
  // 더 작고 촘촘한 셀 — 화면 전체가 밀도 필드가 된다:
  // 진한 곳 = 타이핑 글자가 촘촘히, 옅은 곳 = 작은 글자·점이 드문드문, 빈 곳도 옅은 점의 들판.
  const cell = Math.max(11, Math.floor(Math.min(W, H) / 58));
  const mc = document.createElement('canvas'); mc.width = W; mc.height = H;
  const g = mc.getContext('2d', { willReadFrequently: true });
  asciiMaskDraw(g, mark, W, H);
  const img = g.getImageData(0, 0, W, H).data;
  const targets = [];
  asciiAtlas = {};   // 셀 크기가 바뀌므로 아틀라스 초기화
  let k = 0;
  const T = (ch, px, alpha, sc, x, y) =>
    ({ ch, px: Math.max(6, Math.round(px)), alpha, sx: sc.x, sy: sc.y, tx: x, ty: y, delay: Math.random() * 700 });
  for (let y = Math.floor(cell / 2); y < H; y += cell) {
    for (let x = Math.floor(cell / 2); x < W; x += cell) {
      const v = img[(y * W + x) * 4 + 3];                       // 마스크 진하기(0~255)
      const hsel = hash01(x * 12.9898 + y * 78.233);
      const rndSc = srcs[Math.floor(hash01(x * 3.7 + y * 1.3) * srcs.length)];
      if (v > 150) {                                            // 진한 곳 — 타이핑 글자 촘촘히
        const sc = srcs[k % srcs.length]; k++;
        targets.push(T(sc.ch, cell * 1.02, 0.95, sc, x, y));
      } else if (v > 60) {                                      // 중간 — 글자와 점이 섞인다
        if (hsel > 0.35) { const sc = srcs[k % srcs.length]; k++; targets.push(T(sc.ch, cell * 0.8, 0.8, sc, x, y)); }
        else targets.push(T('·', cell * 0.7, 0.6, rndSc, x, y));
      } else if (hsel > 0.76) {                                 // 빈 곳 — 옅은 점의 들판(밀도 낮게)
        targets.push(T('·', cell * 0.6, 0.4, rndSc, x, y));
      }
    }
  }
  asciiArt = { targets, start: performance.now(), cell, mark, done: false };
  state.phase = 'ascii';
  document.body.classList.add('ascii-time');   // 스코어판·캐릭터 열·입력칸 숨김
  // 폰에도 같은 그림을 띄운다(부호 + 사용 글자들 — 점 말고 실제 타이핑 글자만)
  try {
    fetch('/ascii', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mark, chars: targets.filter((o) => o.ch !== '·').slice(0, 500).map((o) => o.ch).join('') }),
    }).catch(() => {});
  } catch (e) { /* 정적 서버 — 무시 */ }
}

function drawAsciiArt(t) {
  if (!asciiArt) return;
  const W = window.innerWidth, H = window.innerHeight;
  sctx.fillStyle = '#fff'; sctx.fillRect(0, 0, W, H);
  const el = performance.now() - asciiArt.start;
  const settle = Math.max(0, Math.min(1, (el - ASCII_FLY - 400) / 900));   // 완성 후 숨쉬기 페이드인
  for (const tg of asciiArt.targets) {
    const p = Math.max(0, Math.min(1, (el - tg.delay) / ASCII_FLY));
    const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;   // easeInOutCubic — 슈우우
    let x = tg.sx + (tg.tx - tg.sx) * e;
    let y = tg.sy + (tg.ty - tg.sy) * e;
    if (settle > 0) {
      const mv = asciiMotion(asciiArt.mark, tg.tx, tg.ty, W, H, t);
      x += mv.dx * settle; y += mv.dy * settle;
    }
    const sp = glyphSprite(tg.ch, tg.px, tg.alpha);
    sctx.drawImage(sp, x - sp.width / 2, y - sp.height / 2);
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
    renderBigQR();                 // 시작 전 QR 대기화면도 갱신
  }).catch(() => {});
  if (audienceTapUrl) renderBigQR();   // ?pub= 로 이미 주소가 있으면 즉시
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
      // 합주 중 폰 터치 — 총보에 음표 하나 추가
      else if (d.type === 'addnote') addAudienceNote();
    };
    audienceES.onerror = () => {};   // 브라우저가 자동 재연결 — 조용히
  } catch (e) { /* SSE 미지원 서버 — 퍼포머 전용 */ }
}

// 타이틀 앞 QR 대기화면 — 관객이 미리 폰으로 접속해 두는 큰 QR.
function renderBigQR() {
  const el = $('#big-qr');
  if (!el || !audienceTapUrl || typeof QRCode === 'undefined') return;
  el.innerHTML = '';
  new QRCode(el, {
    text: audienceTapUrl, width: 420, height: 420,
    colorDark: '#000', colorLight: '#fff', correctLevel: QRCode.CorrectLevel.M,
  });
  const u = $('#qr-url'); if (u) u.textContent = audienceTapUrl;
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
let orchestraT0 = 0;                            // 합주 시작 시각 — 색 반전(흰→검) 스윕 기준
let endingHudTimer = null;                      // 소통 게이지·문구 8초 후 페이드아웃 타이머
let jamOn = false;                              // 합주가 끝난 뒤 = 관객 합주(터치 잼) — 카메라도 우주유영
let jamTimer = null;                            // rAF가 멈춰도(탭 백그라운드) 잼은 정시에 열리게 하는 타이머

function startJam() {
  if (jamOn || endingPhase !== 2) return;
  jamOn = true;
  try { fetch('/jam', { method: 'POST' }).catch(() => {}); } catch (e) { /* 정적 서버 — 무시 */ }
}
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
      p.notes.forEach((n) => out.push({ beat: p.startBeat + n.beat, midi: n.midi, lane: p.voiceId, part: pi, player: p.player, glyph: n.glyph, accent: n.accent, aud: n.aud, born: n.born }));
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
  if (sphere && jamOn) {
    // 관객 합주(잼) — SF 우주이동처럼 점구름을 스치고 관통하며 유영하는 카메라(아주 느긋하게)
    const tt = t * 0.3;
    const camR = 15 + Math.sin(tt * 0.7) * 8 + Math.sin(tt * 0.23) * 4;   // 7~27 — 가까이 스쳤다 멀어진다
    cam = { x: Math.sin(tt) * camR, y: Math.sin(tt * 0.53) * 7 + 1.5, z: Math.cos(tt * 0.81) * camR };
    target = { x: Math.sin(tt * 0.37) * 3, y: Math.sin(tt * 0.29) * 2, z: Math.cos(tt * 0.41) * 3 };
  } else if (sphere) {
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
  const nowMs = performance.now();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  placed.forEach(({ d, pr }) => {
    const fresh = (playBeat - d.beat) < 0.45;
    // 관객 음표 탄생 강조 — 1.4초 동안 크게 팝 + 퍼지는 링 두 겹
    const audAge = d.born ? (nowMs - d.born) / 1000 : 99;
    const audK = d.aud && audAge < 1.4 ? 1 - audAge / 1.4 : 0;
    const a = Math.min(1, depthAlpha(pr.vz) * (d.accent ? 1 : 0.92) + (fresh ? 0.25 : 0) + audK * 0.6);
    let fpx = Math.max(8, Math.min(sizeMax, focal * (sizeBase + (d.accent ? 0.16 : 0) + (fresh ? 0.22 : 0)) / pr.vz));
    if (audK > 0) fpx *= 1 + audK * 1.2;
    ctx.fillStyle = `rgba(0,0,0,${a.toFixed(3)})`;
    ctx.font = `${fpx.toFixed(1)}px Datatype, Galmuri11, monospace`;
    ctx.fillText(d.glyph || '◇', pr.sx, pr.sy);
    if (audK > 0) {
      const spread = 1 - audK;   // 0→1 로 퍼진다
      ctx.strokeStyle = `rgba(0,0,0,${(audK * 0.85).toFixed(3)})`; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.arc(pr.sx, pr.sy, fpx * (0.7 + spread * 1.8), 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = `rgba(0,0,0,${(audK * 0.45).toFixed(3)})`; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(pr.sx, pr.sy, fpx * (0.7 + spread * 3.0), 0, Math.PI * 2); ctx.stroke();
    } else if (d.aud) {
      // 태어난 뒤에도 관객 음표는 가는 링을 계속 둘러 표가 난다
      ctx.strokeStyle = `rgba(0,0,0,${(a * 0.5).toFixed(3)})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(pr.sx, pr.sy, fpx * 0.72, 0, Math.PI * 2); ctx.stroke();
    }
    if (d.accent && !d.aud) {
      ctx.strokeStyle = `rgba(0,0,0,${(a * 0.7).toFixed(3)})`; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(pr.sx, pr.sy, fpx * 0.62, 0, Math.PI * 2); ctx.stroke();
    }
  });

  // 합주가 다 연주되면 → 관객 합주(잼) 개시. 폰에 알리고, 카메라는 우주유영으로.
  if (sphere && progress >= 1 && orchestraT0) startJam();
  // 관객 참여 안내 — 합주 동안 화면 아래 작게(색 반전에 함께 뒤집혀 검정 바탕에선 흰 글씨가 된다)
  if (sphere) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `${Math.max(13, Math.round(Math.min(W, H) * 0.017))}px Galmuri11, Datatype, monospace`;
    ctx.fillText(jamOn ? '지금이에요 — 핸드폰 화면을 터치해 함께 연주하세요'
      : '핸드폰 화면을 터치하면 합주에 음표가 태어납니다', W / 2, H * 0.965);
    ctx.restore();
  }
  // 합주(2단계) 진입 — 스스슥 색 반전: 검정 바탕에 흰 그래픽.
  // difference 합성으로 화면 전체를 원본↔반전 사이에서 부드럽게 크로스페이드한다.
  const inv = orchestraT0 ? easeIO((performance.now() - orchestraT0) / 2600) : 0;
  if (inv > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'difference';
    ctx.fillStyle = `rgba(255,255,255,${inv.toFixed(3)})`;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
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
  const SOLO_SPEED = 2;                                // 독주(순차 듀엣) 배속 — 2배 빠르게
  const GAP = 0.3;                                     // 문장 사이 숨(배속에 맞춰 촘촘히)
  msgs.forEach((m) => {
    const fast = m.rhythm.map((e) => ({ ...e, rel: e.rel / SOLO_SPEED }));   // 리듬 압축
    const last = fast[fast.length - 1];
    const dur = (last ? last.rel : 0) + 0.35;          // 이 발화의 실제 길이(배속 반영)
    timers.push(setTimeout(() => speakVoiceEvents(fast, m.voiceId, m.mood), tSec * 1000));
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
  captureScoreStill();   // 1단계 완성 스코어를 폰 규격 정지화면으로 서버에 올린다(합주 동안 폰이 띄움)
  endingPhase = 2;
  orchestraScore = buildOrchestra();
  if (!orchestraScore) { endingPhase = 0; return; }
  // 다같이 트는 순간 — 스스슥 색 반전(검정 바탕에 흰 그래픽). DOM 글자도 CSS로 함께 반전.
  orchestraT0 = performance.now();
  document.body.classList.add('score-invert');
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
  // 잼 개시 타이머 — 캔버스 프레임이 멈춰 있어도 합주 종료 시각에 정확히 열린다
  clearTimeout(jamTimer);
  jamTimer = setTimeout(startJam, scoreTotalMs + 600);
}

function stopEndingScore() {
  if (stopScore) { stopScore(); stopScore = null; }
  if (stopEnsemble) { stopEnsemble(); stopEnsemble = null; }
  if (scoreAnim) { cancelAnimationFrame(scoreAnim); scoreAnim = null; }
  endingPhase = 0;
  orchestraScore = null;
  orchestraT0 = 0;
  jamOn = false;
  clearTimeout(jamTimer); jamTimer = null;
  clearTimeout(endingHudTimer); endingHudTimer = null;
  document.body.classList.remove('score-invert', 'ending-hud-off');
}

// 1단계(순차 듀엣) 완성 스코어를 폰 규격으로 렌더해 서버에 정지화면으로 올린다.
// endingPhase가 아직 1일 때(=합주 직전) 불러야 1단계 그림이 잡힌다.
function captureScoreStill() {
  try {
    const cv = document.createElement('canvas'); cv.width = 720; cv.height = 900;
    const c2 = cv.getContext('2d');
    drawScore3D(c2, 720, 900, 1.234, 1);
    fetch('/still', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ img: cv.toDataURL('image/jpeg', 0.82) }),
    }).catch(() => {});
  } catch (e) { /* 정적 서버 — 무시 */ }
}

// 합주 중 관객 폰 터치 — 총보에 음표(글리프) 하나를 그 자리에서 태어나게 한다.
function addAudienceNote() {
  if (endingPhase !== 2 || !orchestraScore || !orchestraScore.parts.length) return;
  const spb = 60 / SCORE_TEMPO;
  const playBeat = Math.max(0, Math.min(orchestraScore.totalBeats - 0.1,
    (performance.now() - scoreStartWall) / 1000 / spb));
  const p = orchestraScore.parts[Math.floor(Math.random() * orchestraScore.parts.length)];
  const glyphs = '◇○●△▽□♪✳*';
  // 잼(합주가 끝난 뒤)에는 구름 전체에 흩뿌려지도록 랜덤 박에 심는다
  const maxB = Math.max(0.1, orchestraScore.totalBeats - p.startBeat - 0.1);
  p.notes.push({
    beat: jamOn ? Math.random() * maxB : Math.max(0, playBeat - p.startBeat),
    midi: 55 + Math.floor(Math.random() * 18),
    glyph: glyphs[Math.floor(Math.random() * glyphs.length)],
    accent: Math.random() > 0.7,
    aud: true, born: performance.now(),   // 관객 음표 — 태어날 때 강조 연출용
  });
  // 태어나는 소리 — 합주가 크게 울리는 동안에도 처음부터 또렷하게 들리도록
  // ① uiClick: 마스터 직결 종소리(뉘앙스 이펙트·합주 리버브에 안 묻힘)
  // ② typeVoice: 캐릭터 목소리 색 한 톨(억양 포함)
  resumeAudio();
  uiClick(0.25 + Math.random() * 0.6, 0.5);
  typeVoice('aeioumko'[Math.floor(Math.random() * 8)], 0.8, Math.floor(Math.random() * 8));
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
  // 소통 게이지·문구는 8초만 보여주고 스스르 사라진다 — 스코어만 꽉 차게.
  // (반드시 startEndingScore 뒤에 — 그 안의 stopEndingScore가 타이머를 지우기 때문)
  document.body.classList.remove('ending-hud-off');
  clearTimeout(endingHudTimer);
  endingHudTimer = setTimeout(() => document.body.classList.add('ending-hud-off'), 8000);
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
  if (act === 'qr-done') {
    // QR 화면(소개 뒤) ▶ — 대화(플레이)로. to-setup이 하던 매칭을 여기서 한다.
    uiClick(0.75);
    if (SCORE) randomMatch();
    show('play');
  }
  else if (act === 'start') {
    // 타이틀 ▶ — 시작 사운드(우웅 인트로) 없이 한 번에 캐릭터 소개로.
    ensureAudio();
    updateSelectUI(); show('select');
  }
  else if (act === 'random') { uiClick(Math.random()); randomMatch(); }
  // 대화 시작 — 이해도 설정 건너뜀(모두 미지의 언어). 스코어 도감은 고르기를 안 하므로
  // 플레이할 두 캐릭터를 이때 무작위로 배정한다(인게임 좌/우 열에서 교체 가능).
  else if (act === 'to-setup') { uiClick(0.6); show(SCORE ? 'qr' : 'play'); }   // 소개 끝 ▶ → 관객 QR 화면
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

// 상태 프로브(읽기 전용) — 헤드리스 검증에서 잼/진행도 확인용
window.__probe = () => ({ jam: jamOn, phase: endingPhase, prog: scoreProgress(), total: scoreTotalMs, screen: state.screen });

// ===== 시작 =====
resize();
// 소개 컷신 배경 사진(있으면) 미리 로드 — 없으면 손그림 폴백. 저작권 있는 스톡 사진 금지.
loadIntroPhoto('tomatoA', ['assets/intro/tomato-a.jpg', 'assets/intro/tomato-a.png', 'assets/intro/tomato-a.jpeg']);
loadIntroPhoto('tree', ['assets/intro/tree.jpg', 'assets/intro/tree.png', 'assets/intro/tree.jpeg']);
loadIntroPhoto('tomatoB', ['assets/intro/tomato-b.jpg', 'assets/intro/tomato-b.png', 'assets/intro/tomato-b.jpeg'], 62, composeTomatoB);   // 상자 절반 크기 합성 + 토마토 윤곽 또렷하게
buildPickColumns();   // 플레이 중 좌/우 캐릭터 선택 열 생성
if (SCORE) setupGift();   // 선물 아이콘 + 드래그&드롭(리버브) 준비
if (SCORE) setupAudience();   // 관객 폰 실시간 부호 탭(SSE) 연결 준비
buildDex();           // 스코어 테마: 도감 그리드 생성
updateSelectUI();
requestAnimationFrame(loop);
