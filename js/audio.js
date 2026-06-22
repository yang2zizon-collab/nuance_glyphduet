// 오디오 엔진.
// - 타이핑: 동물의숲(animalese) 스타일 짧은 피치 블립을 Web Audio로 합성
// - 이해 모드: 브라우저 TTS로 실제 한/영 읽기
// - 미지 모드: 글자마다 블립을 이어 붙여 "못 알아듣는" 지껄임
//
// 나중에 Max/MSP 연동: setMaxHook(fn) 으로 외부 콜백을 등록하면
// 모든 사운드 이벤트가 그 콜백으로도 전달된다(OSC/WebSocket 브리지에서 사용).

import { pitchForChar } from './glyphs.js';

let ctx = null;
let master = null;
let scoreBus = null;   // 엔딩 악보 전용 서브믹스 — 대화 볼륨과 균형 맞춤
let maxHook = null; // (event) => void  — 외부(예: Max) 라우팅용 stub

export function initAudio() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 0.85;
  // 엔딩 악보(드론+다성부+그래뉼러)는 밀도가 높아 자연히 커진다 → 서브믹스에서 줄여
  // 대화(단성 보이스) 볼륨과 균형을 맞춘다.
  scoreBus = ctx.createGain();
  scoreBus.gain.value = 0.95;   // 엔딩 악보를 확실히 들리게 — 컴프레서가 과밀도는 잡아준다
  scoreBus.connect(master);
  // 공연용으로 음량을 키워도 깨지지 않게 마스터 컴프레서/리미터를 건다
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 24;
  comp.ratio.value = 4;
  comp.attack.value = 0.006;
  comp.release.value = 0.25;
  // 마스터 출력 전체에 "뉘앙스 이펙트" 인서트를 끼운다(master → nuanceFx → comp → 출력).
  // 8초 라운드에서 가장 많이 눌린 부호가 이 인서트의 파라미터를 실시간으로 바꾼다.
  buildNuanceFx(master, comp);
  comp.connect(ctx.destination);
}

// ===== 뉘앙스 이펙트 인서트 (마스터 전역) =====
// lowpass(먹먹함) · tremolo(흔들림) · drive(거칢) · reverb send(공간) 4축으로
// 6개 부호의 "말투"를 사운드 전체에 입힌다.
let nfxLp = null, nfxTrem = null, nfxLfo = null, nfxLfoGain = null, nfxDrive = null, nfxOut = null, nfxRevSend = null;
let nfxState = 'neutral';
const NUANCE_FX = {
  neutral:   { lp: 20000, trem: 0,    lfo: 5,   drive: 0,    out: 1.0,  rev: 0.0  },
  period:    { lp: 9000,  trem: 0,    lfo: 5,   drive: 0,    out: 1.0,  rev: 0.05 },  // 담담·마른
  question:  { lp: 11000, trem: 0.10, lfo: 5,   drive: 0,    out: 1.0,  rev: 0.20 },  // 되묻듯·들뜬
  bang:      { lp: 13000, trem: 0,    lfo: 5,   drive: 0.4,  out: 1.2,  rev: 0.08 },  // 강조·날카로움
  ellipsis:  { lp: 3600,  trem: 0.05, lfo: 2,   drive: 0,    out: 0.85, rev: 0.6  },  // 머뭇·아득함
  tilde:     { lp: 7000,  trem: 0.38, lfo: 6.5, drive: 0.05, out: 1.0,  rev: 0.3  },  // 물결·흔들림
  semicolon: { lp: 4800,  trem: 0.04, lfo: 3,   drive: 0,    out: 0.9,  rev: 0.34 },  // 망설임·머무름
};

function buildNuanceFx(inputNode, outputNode) {
  nfxLp = ctx.createBiquadFilter(); nfxLp.type = 'lowpass'; nfxLp.frequency.value = 20000; nfxLp.Q.value = 0.5;
  nfxTrem = ctx.createGain(); nfxTrem.gain.value = 1;              // 트레몰로 베이스
  nfxLfo = ctx.createOscillator(); nfxLfo.type = 'sine'; nfxLfo.frequency.value = 5;
  nfxLfoGain = ctx.createGain(); nfxLfoGain.gain.value = 0;        // 트레몰로 깊이(0=꺼짐)
  nfxLfo.connect(nfxLfoGain); nfxLfoGain.connect(nfxTrem.gain); nfxLfo.start();
  nfxDrive = ctx.createWaveShaper(); nfxDrive.curve = null; nfxDrive.oversample = '2x';  // null=바이패스
  nfxOut = ctx.createGain(); nfxOut.gain.value = 1;
  inputNode.connect(nfxLp); nfxLp.connect(nfxTrem); nfxTrem.connect(nfxDrive); nfxDrive.connect(nfxOut); nfxOut.connect(outputNode);
  // 병렬 리버브 센드
  const rate = ctx.sampleRate, len = Math.floor(rate * 2.6);
  const ir = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
  }
  const conv = ctx.createConvolver(); conv.buffer = ir;
  nfxRevSend = ctx.createGain(); nfxRevSend.gain.value = 0;
  const revLp = ctx.createBiquadFilter(); revLp.type = 'lowpass'; revLp.frequency.value = 6000;
  inputNode.connect(nfxRevSend); nfxRevSend.connect(conv); conv.connect(revLp); revLp.connect(nfxOut);
}

// 가장 많이 눌린 부호(또는 실시간 리더)의 말투를 사운드 전체에 입힌다.
export function applyNuanceEffect(kind, smooth = 0.25) {
  if (!ctx || !nfxLp) return;
  const p = NUANCE_FX[kind] || NUANCE_FX.neutral;
  const t = ctx.currentTime, tau = Math.max(0.01, smooth);
  nfxLp.frequency.setTargetAtTime(p.lp, t, tau);
  nfxLfo.frequency.setTargetAtTime(p.lfo, t, tau);
  nfxTrem.gain.setTargetAtTime(1 - p.trem, t, tau);   // 트레몰로: [1-깊이 .. 1] 사이로 흔들림
  nfxLfoGain.gain.setTargetAtTime(p.trem, t, tau);
  nfxOut.gain.setTargetAtTime(p.out, t, tau);
  nfxRevSend.gain.setTargetAtTime(p.rev, t, tau);
  nfxDrive.curve = p.drive > 0 ? makeDistortionCurve(p.drive * 120) : null;
  nfxState = kind;
  emit({ type: 'nuance-fx', kind });
}
export function resetNuanceEffect() { applyNuanceEffect('neutral', 0.05); }
export function currentNuance() { return nfxState; }

// 긴 세션/포커스 전환으로 컨텍스트가 멈춰 있으면 다시 깨운다.
export function resumeAudio() {
  if (ctx && ctx.state === 'suspended') { try { ctx.resume(); } catch (e) { /* noop */ } }
}

export function setMaxHook(fn) { maxHook = fn; }
export function clearMaxHook() { maxHook = null; }

// ===== 선물(이펙트) 라우팅 =====
// 선물 받은 캐릭터(voiceId)의 소리를 전용 리버브 버스로 보낸다. (일단 리버브만)
const giftedVoices = new Set();
let giftInput = null;
function giftBus() {
  if (giftInput) return giftInput;
  // 합성 임펄스(긴 꼬리) — 선물 받은 목소리에 공간감을 입힌다.
  const rate = ctx.sampleRate, secs = 3.2, len = Math.floor(rate * secs);
  const ir = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.4);
  }
  const conv = ctx.createConvolver(); conv.buffer = ir;
  const inp = ctx.createGain();
  const dry = ctx.createGain(); dry.gain.value = 0.8;   // 원음
  const wet = ctx.createGain(); wet.gain.value = 1.0;   // 리버브
  const wetLp = ctx.createBiquadFilter(); wetLp.type = 'lowpass'; wetLp.frequency.value = 6000;
  inp.connect(dry); dry.connect(master);
  inp.connect(conv); conv.connect(wetLp); wetLp.connect(wet); wet.connect(master);
  giftInput = inp;
  return inp;
}
// 이 목소리가 향할 목적지 — 선물 받았으면 리버브 버스, 아니면 마스터.
function destFor(voiceId) {
  return (voiceId != null && ctx && giftedVoices.has(voiceId)) ? giftBus() : master;
}
export function setGift(voiceId, on) {
  if (voiceId == null) return;
  if (on) giftedVoices.add(voiceId); else giftedVoices.delete(voiceId);
}
export function isGifted(voiceId) { return giftedVoices.has(voiceId); }
export function clearGifts() { giftedVoices.clear(); }

function emit(event) {
  if (maxHook) { try { maxHook(event); } catch (e) { /* 브리지 오류 무시 */ } }
}

// ============================================================
//  캐릭터별 목소리 프로필
//  캐릭터 인덱스(sprites.js의 CHARACTERS 순서)로 음색을 다르게 한다.
//   wave   : 기본 파형(음색)
//   oct    : 반음 오프셋(±) — 음역대
//   bpMul  : 밴드패스 중심 배율(포먼트 느낌)
//   lpMul  : 로우패스 배율(밝기/먹먹함)
//   q      : 밴드패스 Q(공명/콧소리)
//   vib    : 비브라토 양 0..1(떨림)
//   vibHz  : 비브라토 속도
//   ttsPitch/ttsRate : 이해 모드 TTS 음높이·속도
//   voiceIdx : 같은 언어 시스템 보이스 중 몇 번째를 쓸지(목소리 자체를 다르게)
// ============================================================
const VOICES = [
  // 0 핑크토마토 — 밝고 또랑또랑
  { wave: 'square',   oct:  0,  bpMul: 1.5, lpMul: 1.0, q: 4,   vib: 0.15, vibHz: 6,   ttsPitch: 1.15, ttsRate: 1.05, voiceIdx: 0 },
  // 1 심해어 — 깊고 먹먹한 저음
  { wave: 'triangle', oct: -12, bpMul: 0.9, lpMul: 0.5, q: 2,   vib: 0.08, vibHz: 4,   ttsPitch: 0.55, ttsRate: 0.9,  voiceIdx: 1 },
  // 2 새 — 높고 지저귀는
  { wave: 'square',   oct: +12, bpMul: 1.8, lpMul: 1.3, q: 6,   vib: 0.45, vibHz: 11,  ttsPitch: 1.7,  ttsRate: 1.2,  voiceIdx: 2 },
  // 3 우파루파 — 동글동글 보드라운
  { wave: 'sine',     oct: +5,  bpMul: 1.2, lpMul: 0.8, q: 2.5, vib: 0.2,  vibHz: 5.5, ttsPitch: 1.35, ttsRate: 0.95, voiceIdx: 3 },
  // 4 소금빵 — 따뜻하고 둥근
  { wave: 'triangle', oct: -2,  bpMul: 1.1, lpMul: 0.85,q: 2,   vib: 0.12, vibHz: 5,   ttsPitch: 0.9,  ttsRate: 1.0,  voiceIdx: 4 },
  // 5 쿠키 — 바삭하고 또렷
  { wave: 'sawtooth', oct: +2,  bpMul: 1.4, lpMul: 1.1, q: 3.5, vib: 0.18, vibHz: 7,   ttsPitch: 1.1,  ttsRate: 1.1,  voiceIdx: 5 },
  // 6 지우개 — 가늘고 삑삑
  { wave: 'square',   oct: +7,  bpMul: 1.9, lpMul: 1.15,q: 7,   vib: 0.3,  vibHz: 9,   ttsPitch: 1.5,  ttsRate: 1.15, voiceIdx: 6 },
  // 7 생쥐 — 아주 작고 빠른 고음
  { wave: 'square',   oct: +14, bpMul: 2.0, lpMul: 1.25,q: 6,   vib: 0.5,  vibHz: 13,  ttsPitch: 1.9,  ttsRate: 1.3,  voiceIdx: 7 },
];
function voiceFor(id) {
  if (id == null) return null;
  return VOICES[((id % VOICES.length) + VOICES.length) % VOICES.length];
}

// 한 글자에 대한 짧은 보이스 블립.
// pitch01: 0..1, base: 캐릭터 기본 음역 0..1
// garble: 0..1 — 0이면 또렷, 1이면 먹먹하고 피치가 흔들려 더 웅얼거린다.
// voiceId: 캐릭터 인덱스(있으면 캐릭터별 음색 적용)
function blip(pitch01, base = 0.5, dur = 0.09, gain = 0.5, garble = 0, voiceId = null, dest = null) {
  if (!ctx) return;
  const v = voiceFor(voiceId);
  const now = ctx.currentTime;
  // 음높이: 대략 200~700Hz. garble↑일수록 음역이 살짝 내려가고 무작위로 흔들림
  const jitter = (Math.random() - 0.5) * 0.3 * garble;
  const octMul = v ? Math.pow(2, v.oct / 12) : 1;
  const freq = (180 + (base * 220) + pitch01 * 420) * octMul * (1 - 0.15 * garble) * (1 + jitter);

  const osc = ctx.createOscillator();
  osc.type = v ? v.wave : 'square';
  osc.frequency.setValueAtTime(freq, now);
  // garble↑ → 피치가 위로 한 번 출렁였다 더 깊게 떨어짐(웅얼거리는 억양)
  const wob = 1 + (Math.random() - 0.5) * 0.25 * garble;
  osc.frequency.linearRampToValueAtTime(freq * (1.04 + 0.12 * garble) * wob, now + dur * 0.4);
  osc.frequency.exponentialRampToValueAtTime(freq * (0.82 - 0.2 * garble), now + dur);

  // 캐릭터 비브라토(떨림) — 음색의 개성
  let vibOsc = null;
  if (v && v.vib > 0) {
    vibOsc = ctx.createOscillator();
    const vg = ctx.createGain();
    vibOsc.type = 'sine';
    vibOsc.frequency.value = v.vibHz;
    vg.gain.value = freq * 0.04 * v.vib;
    vibOsc.connect(vg); vg.connect(osc.frequency);
    vibOsc.start(now); vibOsc.stop(now + dur + 0.02);
  }

  // 보이스 같은 색을 위한 밴드패스 — garble↑이면 덜 또렷
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq * ((v ? v.bpMul : 1.5) - 0.6 * garble);
  bp.Q.value = (v ? v.q : 4) - 2.5 * garble;

  // garble↑ → 로우패스가 닫히며 먹먹해짐(웅얼웅얼)
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = (5200 * (v ? v.lpMul : 1)) - 4300 * garble; // 캐릭터별 밝기
  lp.Q.value = 0.7;

  const g = ctx.createGain();
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(gain, now + 0.008);
  g.gain.exponentialRampToValueAtTime(0.001, now + dur);

  osc.connect(bp); bp.connect(lp); lp.connect(g); g.connect(dest || master);
  osc.start(now);
  osc.stop(now + dur + 0.02);
}

// (이펙트 랙 제거됨 — 타이핑 소리·목소리는 마스터로 바로 나간다.)

// 타건 트랜지언트용 아주 짧은 노이즈 클릭(리듬이 도드라지게)
let clkBuf = null;
function clickBuf() {
  if (clkBuf) return clkBuf;
  const len = Math.floor(ctx.sampleRate * 0.02);
  clkBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = clkBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  return clkBuf;
}

// 타이핑 한 글자 — 또렷한 어택(친 리듬이 정확히 들림) + 짧은 피치 + 클릭.
function typeHit(pitch01, base, voiceId, dest) {
  const v = voiceFor(voiceId);
  const now = ctx.currentTime;
  const octMul = v ? Math.pow(2, v.oct / 12) : 1;
  const freq = (220 + base * 240 + pitch01 * 520) * octMul;

  // 피치 블립 — 짧고 단단하게(날카로운 어택 → 리듬의 점이 또렷)
  const osc = ctx.createOscillator();
  osc.type = v ? v.wave : 'square';
  osc.frequency.setValueAtTime(freq * 1.02, now);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.72, now + 0.05);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.0001, now);
  og.gain.exponentialRampToValueAtTime(0.34, now + 0.003);
  og.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
  osc.connect(og); og.connect(dest);
  osc.start(now); osc.stop(now + 0.08);

  // 클릭 트랜지언트 — 타건감, 리듬이 도드라지게
  const click = ctx.createBufferSource(); click.buffer = clickBuf();
  const cf = ctx.createBiquadFilter(); cf.type = 'bandpass';
  cf.frequency.value = 2200 + pitch01 * 1800; cf.Q.value = 0.8;
  const cg = ctx.createGain();
  cg.gain.setValueAtTime(0.22, now);
  cg.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);
  click.connect(cf); cf.connect(cg); cg.connect(dest);
  click.start(now);
}

// 타이핑 1회 피드백(어느 모드든 항상 난다). 이펙트 버스를 통과한다.
export function typeBlip(ch, base = 0.5, voiceId = null) {
  if (ch === ' ' || ch === '\n' || ch === undefined) {
    emit({ type: 'space' });
    return;
  }
  const p = pitchForChar(ch);
  if (!ctx) return;
  typeHit(p, base, voiceId, destFor(voiceId));
  emit({ type: 'type', char: ch, pitch: p, base });
}

// 어떤 키든 무조건 소리를 낸다(스페이스·한글 자모 조합 중 포함).
// 글자 정보가 없으면(IME 조합 중 e.key='Process' 등) 랜덤 피치로 친다.
export function typeKey(ch = null, base = 0.5, voiceId = null) {
  if (!ctx) return;
  const c = (typeof ch === 'string' && ch.length === 1) ? ch : null;
  const p = c ? pitchForChar(c) : Math.random();
  typeHit(p, base, voiceId, destFor(voiceId));
  emit({ type: 'type', char: c || '?', pitch: p, base });
}

// UI 클릭음 — 캐릭터 고르기 화살표·랜덤매칭·대화시작 버튼 등.
// 타이핑 이펙트 랙을 거치지 않는 깔끔한 단음(마스터로 직결).
export function uiClick(pitch = 0.5) {
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume();
  const t = ctx.currentTime;
  const freq = 440 * Math.pow(2, (Math.round(pitch * 12) - 6) / 12);
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(freq * 1.5, t + 0.04);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.16, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + 0.16);
  emit({ type: 'ui-click', pitch });
}

// 뉘앙스 부호음 — 퍼포머·관객이 찍는 . … ? ! 의 아티큘레이션.
// 부호가 곧 "말투"다: 담담(.)·머뭇거림(…)·되물음(?)·강조(!).
export function playMark(kind, when = 0, gain = 1) {
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume();
  const t0 = ctx.currentTime + Math.max(0, when);
  // 짧은 음 한 점
  const tick = (at, freq, dur, g, type = 'triangle') => {
    const o = ctx.createOscillator(); const e = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, at);
    e.gain.setValueAtTime(0.0001, at);
    e.gain.exponentialRampToValueAtTime(Math.max(0.0002, g), at + 0.004);
    e.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(e).connect(master);
    o.start(at); o.stop(at + dur + 0.03);
  };
  // 마른 타격 노이즈(우드블록 느낌)
  const hit = (at, dur, g, hp = 1800) => {
    const src = ctx.createBufferSource(); src.buffer = clickBuf();
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp;
    const e = ctx.createGain();
    e.gain.setValueAtTime(Math.max(0.0002, g), at);
    e.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f).connect(e).connect(master);
    src.start(at); src.stop(at + dur + 0.03);
  };
  switch (kind) {
    case 'period':   // 담담한 종지 — 짧고 마른 한 점
      tick(t0, 320, 0.10, 0.20 * gain);
      hit(t0, 0.03, 0.10 * gain, 1500);
      break;
    case 'ellipsis': // 머뭇거림 — 내려가는 세 점, 마지막이 길게 흐려진다
      tick(t0,        300, 0.16, 0.15 * gain);
      tick(t0 + 0.14, 264, 0.18, 0.13 * gain);
      tick(t0 + 0.30, 232, 0.40, 0.12 * gain);
      break;
    case 'question': { // 되물음 — 끝에서 음정이 위로 휘어 오른다
      const o = ctx.createOscillator(); const e = ctx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(300, t0);
      o.frequency.exponentialRampToValueAtTime(680, t0 + 0.24);
      e.gain.setValueAtTime(0.0001, t0);
      e.gain.exponentialRampToValueAtTime(0.20 * gain, t0 + 0.02);
      e.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32);
      o.connect(e).connect(master);
      o.start(t0); o.stop(t0 + 0.36);
      break;
    }
    case 'bang':     // 강조 — 밝고 날카로운 악센트
      tick(t0, 520, 0.12, 0.24 * gain, 'square');
      tick(t0, 784, 0.10, 0.11 * gain, 'triangle');
      hit(t0, 0.05, 0.18 * gain, 2600);
      break;
    case 'tilde': {  // 물결 — 흔들리는 비브라토
      const o = ctx.createOscillator(); const e = ctx.createGain();
      const vib = ctx.createOscillator(); const vg = ctx.createGain();
      o.type = 'triangle'; o.frequency.setValueAtTime(360, t0);
      vib.type = 'sine'; vib.frequency.setValueAtTime(11, t0); vg.gain.setValueAtTime(36, t0);
      vib.connect(vg); vg.connect(o.frequency); vib.start(t0); vib.stop(t0 + 0.42);
      e.gain.setValueAtTime(0.0001, t0);
      e.gain.exponentialRampToValueAtTime(0.18 * gain, t0 + 0.02);
      e.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.38);
      o.connect(e).connect(master); o.start(t0); o.stop(t0 + 0.42);
      break;
    }
    case 'semicolon':  // 망설임 — 짧은 한 점 뒤 머무는 한 점
      tick(t0, 300, 0.08, 0.16 * gain);
      tick(t0 + 0.12, 360, 0.30, 0.13 * gain);
      break;
    default:
      tick(t0, 360, 0.10, 0.16 * gain);
  }
  emit({ type: 'mark', kind });
}

// 미지의 언어: 글자마다 블립을 이어 붙인 지껄임.
// garble(0..1): 클수록 더 먹먹하고 느릿하게, 즉 점점 더 웅얼거린다.
export function speakAlien(text, base = 0.5, garble = 1, voiceId = null) {
  emit({ type: 'speak-alien', text, base, garble });
  if (!ctx) return;
  const chars = [...text].filter((c) => c !== ' ' && c !== '\n');
  const v = voiceFor(voiceId);
  const rateMul = v ? (v.ttsRate || 1) : 1;          // 캐릭터 말 빠르기
  const step = (0.085 + 0.02 * garble) / rateMul;    // garble↑ → 살짝 늘어지는 말투
  const dur = (0.08 + 0.05 * garble) / Math.sqrt(rateMul); // garble↑ → 음절이 길어져 뭉개짐
  chars.forEach((ch, i) => {
    const p = pitchForChar(ch);
    setTimeout(() => blip(p, base, dur, 0.5, garble, voiceId), i * step * 1000);
  });
}

// 이해 모드: 실제 한/영 TTS — 말은 또렷하게 들리되, 게임 질감의 옅은 필터 베드를 깐다.
// (브라우저 TTS는 Web Audio 필터에 직접 못 물리므로, 아래에 작고 먹먹한 블립을 깔아
//  "필터 씌운" 분위기만 입힌다. 말소리가 묻히지 않게 게인은 아주 낮게.)
export function speakReal(text, lang = 'ko-KR', base = 0.5, voiceId = null) {
  emit({ type: 'speak-real', text, lang, base });
  if (!('speechSynthesis' in window)) { speakAlien(text, base, 0.3, voiceId); return; }
  const prof = voiceFor(voiceId);
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  // 캐릭터별 음높이·속도로 개성 부여(프로필 우선, 없으면 base)
  u.pitch = prof ? prof.ttsPitch : (0.7 + base * 0.9);
  u.rate = prof ? prof.ttsRate : 1.05;
  // 같은 언어의 시스템 보이스가 여러 개면 캐릭터마다 다른 보이스를 고른다
  const all = speechSynthesis.getVoices();
  const matches = all.filter((vo) => vo.lang === lang);
  const near = matches.length ? matches : all.filter((vo) => vo.lang.startsWith(lang.slice(0, 2)));
  const pool = near.length ? near : all;
  if (pool.length) {
    const idx = prof ? (prof.voiceIdx % pool.length) : 0;
    u.voice = pool[idx];
  }
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
  realTextureBed(text, base, voiceId);
}

// 또렷한 말소리 아래 깔리는 옅고 먹먹한 질감(필터 느낌). 게인 매우 낮음.
function realTextureBed(text, base = 0.5, voiceId = null) {
  if (!ctx) return;
  const chars = [...text].filter((c) => c !== ' ' && c !== '\n');
  const step = 0.12;
  chars.forEach((ch, i) => {
    const p = pitchForChar(ch);
    setTimeout(() => blip(p, base, 0.06, 0.09, 0.85, voiceId), i * step * 1000);
  });
}

// ============================================================
//  캐릭터별 "포먼트 보이스(말하기)" — 8캐릭터 각자 다른 목소리
//  모든 발화는 포먼트 합성(모음 a/e/i/o/u 공명)으로 만든다.
//   f0      : 기음(말의 기본 음높이)
//   wave    : 성대 소스 파형
//   formant : 포먼트 이동 배율(↑여성/작은 입, ↓남성/큰 입)
//   lp      : 밝기(로우패스 컷오프) — 우파루파는 아주 낮게(먹먹)
//   vib     : 비브라토 양 / vibHz : 속도
//   q       : 포먼트 공명(콧소리/또렷함)
//   step    : 음절 간격(s) / dur : 음절 길이(s)
//   glide   : 음높이 글라이드(새의 짹 — 위로 휘었다 떨어짐)
//   gran    : 그래뉼러 알갱이 양(소금빵의 바스락 떨림)
//   tremolo : 진폭 떨림(소금빵) / tremHz : 떨림 속도
//   mono    : 기계적 한 톤(지우개 — 고정 피치, 비브라토 없음)
//   cave    : 동굴 리버브 보냄(심해어)
// ============================================================
const SP_VOWELS = ['a', 'e', 'i', 'o', 'u'];
const SP_DEG = [0, 2, 4, 5, 7, 9, 12];   // 음높이 변주용 음정(반음)
const VOICE_LEVEL = 1.45;   // 대화 보이스 전체 게인(엔딩과 볼륨 균형)
const SPEAK = [
  // 0 핑크토마토 — 아름다운 여성: 높은 기음 + 포먼트 위로, 부드러운 비브라토
  { f0: 300, wave: 'sawtooth', formant: 1.18, lp: 5200, vib: 0.03, vibHz: 5.5, q: 9,  step: 0.105, dur: 0.16, glide: 0,    gran: 0,   tremolo: 0,   tremHz: 0,  gain: 0.42 },
  // 1 심해어 — 저음의 동굴 목소리: 낮은 기음 + 포먼트 아래 + 동굴 리버브
  { f0: 90,  wave: 'sawtooth', formant: 0.80, lp: 1300, vib: 0.02, vibHz: 3.5, q: 7,  step: 0.135, dur: 0.24, glide: 0,    gran: 0,   tremolo: 0,   tremHz: 0,  gain: 0.5,  cave: 0.75 },
  // 2 새 — 짹짹: 아주 높은 기음 + 위로 글라이드 + 짧고 빠르게
  { f0: 660, wave: 'square',   formant: 1.30, lp: 6000, vib: 0.05, vibHz: 9,   q: 6,  step: 0.075, dur: 0.085,glide: 0.5,  gran: 0,   tremolo: 0,   tremHz: 0,  gain: 0.34 },
  // 3 우파루파 — LPF가 심하게 걸린 목소리(그래도 들림): 컷오프 아주 낮게
  { f0: 210, wave: 'sawtooth', formant: 0.95, lp: 640,  vib: 0.03, vibHz: 5,   q: 5,  step: 0.115, dur: 0.18, glide: 0,    gran: 0,   tremolo: 0,   tremHz: 0,  gain: 0.6 },
  // 4 소금빵 — 그레뉼러가 느껴지는 떨리는 목소리
  { f0: 175, wave: 'sawtooth', formant: 1.0,  lp: 2900, vib: 0.05, vibHz: 7,   q: 6,  step: 0.115, dur: 0.17, glide: 0,    gran: 0.55,tremolo: 0.45,tremHz: 17, gain: 0.42 },
  // 5 쿠키 — 남성 목소리: 낮은 기음 + 포먼트 살짝 아래
  { f0: 120, wave: 'sawtooth', formant: 0.88, lp: 3200, vib: 0.02, vibHz: 4.5, q: 8,  step: 0.115, dur: 0.18, glide: 0,    gran: 0,   tremolo: 0,   tremHz: 0,  gain: 0.46 },
  // 6 지우개 — 기계적인 한 톤(고정 피치, 비브라토 없음)
  { f0: 200, wave: 'square',   formant: 1.0,  lp: 2600, vib: 0,    vibHz: 0,   q: 4,  step: 0.095, dur: 0.12, glide: 0,    gran: 0,   tremolo: 0,   tremHz: 0,  gain: 0.4,  mono: true },
  // 7 생쥐 — 찍찍거리는 고음
  { f0: 860, wave: 'square',   formant: 1.25, lp: 6500, vib: 0.05, vibHz: 12,  q: 6,  step: 0.07,  dur: 0.08, glide: 0.2,  gran: 0,   tremolo: 0,   tremHz: 0,  gain: 0.32 },
];
function speakProfile(id) {
  if (id == null) return SPEAK[0];
  return SPEAK[((id % SPEAK.length) + SPEAK.length) % SPEAK.length];
}

// 디스토션 곡선(화날 때)
function makeDistortionCurve(amount) {
  const n = 44100, curve = new Float32Array(n), k = amount;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((3 + k) * x * 20 * Math.PI / 180) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

// 무드별 이펙트 버스 — 발화 전체가 통과하는 입력 노드를 돌려준다.
//  happy   : 피드백 딜레이(0.3→0.01s) → 또롱또롱
//  sad     : 리버브로만(드라이 없음) → wet값만
//  angry   : 강한 디스토션
//  confused: 플랜저(짧은 변조 딜레이 + 피드백)
function moodBus(mood, when, totalDur, bin) {
  ensureReverb();
  const input = ctx.createGain(); input.gain.value = 1;

  if (mood === 'happy') {
    // 또롱또롱 — 피드백 딜레이가 300ms→10ms로 점점 빨라지며 반짝인다
    const delay = ctx.createDelay(1.0);
    delay.delayTime.setValueAtTime(0.3, when);
    delay.delayTime.linearRampToValueAtTime(0.01, when + Math.max(0.6, totalDur));
    const fb = ctx.createGain(); fb.gain.value = 0.6;        // 길게 반복
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 800; // 영롱하게
    const wet = ctx.createGain(); wet.gain.value = 0.8;
    input.connect(master);                 // 드라이
    input.connect(delay);
    delay.connect(fb); fb.connect(delay);  // 피드백
    delay.connect(hp); hp.connect(wet); wet.connect(master);
    return input;
  }
  if (mood === 'sad') {
    // 드라이 없이 리버브로만 — 아주 멀고 젖은 소리(wet값만)
    const send = ctx.createGain(); send.gain.value = 3.0;
    input.connect(send); send.connect(reverb);   // 드라이 0 — 오직 리버브
    return input;
  }
  if (mood === 'angry') {
    // 강한 디스토션
    const pre = ctx.createGain(); pre.gain.value = 4.0;
    const ws = ctx.createWaveShaper();
    ws.curve = makeDistortionCurve(900); ws.oversample = '4x';
    const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 3200;
    const post = ctx.createGain(); post.gain.value = 0.5;
    input.connect(pre); pre.connect(ws); ws.connect(tone); tone.connect(post); post.connect(master);
    return input;
  }
  if (mood === 'confused') {
    // 플랜저 — 깊게 휘젓는 변조 딜레이 + 강한 피드백
    const delay = ctx.createDelay(0.05);
    delay.delayTime.value = 0.006;
    const lfo = ctx.createOscillator(); const lg = ctx.createGain();
    lfo.type = 'sine'; lfo.frequency.value = 0.6; lg.gain.value = 0.005;
    lfo.connect(lg); lg.connect(delay.delayTime);
    lfo.start(when); lfo.stop(when + totalDur + 1.5);
    const fb = ctx.createGain(); fb.gain.value = 0.75;
    const wet = ctx.createGain(); wet.gain.value = 0.85;
    input.connect(master);                 // 드라이
    input.connect(delay);
    delay.connect(fb); fb.connect(delay);  // 피드백
    delay.connect(wet); wet.connect(master);
    bin.push(lfo);
    return input;
  }
  // neutral
  input.connect(master);
  return input;
}

// 포먼트 한 음절(말 한 토막) — 성대 소스를 모음 포먼트 뱅크로 거른다.
function speakNote(prof, freq, vowel, when, dur, gain, dest, bin, noGrain = false) {
  const F = FORMANTS[vowel] || FORMANTS.a;
  const src = ctx.createOscillator();
  src.type = prof.wave;
  src.frequency.setValueAtTime(freq, when);
  if (prof.glide) {  // 새의 짹 — 위로 휘었다 떨어짐
    src.frequency.linearRampToValueAtTime(freq * (1 + prof.glide), when + dur * 0.55);
    src.frequency.exponentialRampToValueAtTime(freq * 0.88, when + dur);
  }

  // 비브라토
  let vibo = null;
  if (prof.vib > 0) {
    vibo = ctx.createOscillator(); const vg = ctx.createGain();
    vibo.type = 'sine'; vibo.frequency.value = prof.vibHz;
    vg.gain.value = freq * prof.vib;
    vibo.connect(vg); vg.connect(src.frequency);
    vibo.start(when); vibo.stop(when + dur + 0.05);
  }

  // 포먼트 뱅크(이동 배율 적용)
  const sum = ctx.createGain(); sum.gain.value = 1;
  F.forEach((ff, i) => {
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.value = ff * prof.formant;
    bp.Q.value = prof.q + i * 2;
    const g = ctx.createGain(); g.gain.value = FORMANT_GAIN[i];
    src.connect(bp); bp.connect(g); g.connect(sum);
  });

  // 캐릭터 밝기(로우패스) — 우파루파는 아주 먹먹
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
  lp.frequency.value = prof.lp; lp.Q.value = 0.7;
  sum.connect(lp);

  // 진폭 엔벨로프
  const amp = ctx.createGain();
  const a = Math.min(0.04, dur * 0.3);
  amp.gain.setValueAtTime(0.0001, when);
  amp.gain.exponentialRampToValueAtTime(gain, when + a);
  amp.gain.setValueAtTime(gain, when + Math.max(a, dur * 0.6));
  amp.gain.exponentialRampToValueAtTime(0.0006, when + dur);
  lp.connect(amp);

  // 진폭 떨림(소금빵)
  if (prof.tremolo > 0) {
    const tr = ctx.createOscillator(); const trg = ctx.createGain();
    tr.type = 'sine'; tr.frequency.value = prof.tremHz || 14;
    trg.gain.value = prof.tremolo * gain;
    tr.connect(trg); trg.connect(amp.gain);
    tr.start(when); tr.stop(when + dur + 0.05);
    bin.push(tr);
  }
  amp.connect(dest);

  src.start(when); src.stop(when + dur + 0.06);
  bin.push(src); if (vibo) bin.push(vibo);

  // 그래뉼러 알갱이(소금빵의 바스락) — 같은 버스로 보낸다
  if (!noGrain && prof.gran > 0 && grainBuf) {
    const n = Math.floor(4 + dur * 30);
    for (let i = 0; i < n; i++) {
      const gt = when + Math.random() * dur;
      const gs = ctx.createBufferSource(); gs.buffer = grainBuf;
      gs.playbackRate.value = (freq / 220) * (0.8 + Math.random() * 0.6);
      const gd = 0.02 + Math.random() * 0.04;
      const ge = ctx.createGain();
      ge.gain.setValueAtTime(0.0001, gt);
      ge.gain.exponentialRampToValueAtTime(prof.gran * gain * 0.5, gt + gd * 0.4);
      ge.gain.exponentialRampToValueAtTime(0.0005, gt + gd);
      const off = Math.random() * (grainBuf.duration - gd - 0.01);
      gs.connect(ge); ge.connect(dest);
      gs.start(gt, off, gd + 0.02);
      bin.push(gs);
    }
  }
}

// 미지의 언어 발화 — 캐릭터별 포먼트 보이스 + 무드 이펙트.
//  voiceId : 캐릭터 인덱스(목소리 결정)
//  mood    : 'happy' | 'sad' | 'angry' | 'confused' | 'neutral'
// times: 타이핑 리듬(각 글자의 상대 onset 초). 주어지면 그 리듬대로 발음한다.
export function speakVoice(text, voiceId = null, mood = 'neutral', times = null) {
  emit({ type: 'speak-voice', text, voiceId, mood });
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume();
  ensureReverb(); ensureGrainBuf();
  const prof = speakProfile(voiceId);
  const chars = [...text].filter((c) => c !== ' ' && c !== '\n');
  if (!chars.length) return;

  // 글자 i의 onset(초): 타이핑 리듬이 있으면 그걸, 없으면 균등 간격.
  const onset = (i) => (times && times.length)
    ? times[Math.min(i, times.length - 1)]
    : i * prof.step;

  const now = ctx.currentTime + 0.03;
  const totalDur = onset(chars.length - 1) + prof.dur;
  const bin = [];
  const bus = destFor(voiceId);   // 선물 받았으면 리버브 버스로

  chars.forEach((ch, i) => {
    const when = now + onset(i);
    const p = pitchForChar(ch);
    const vowel = SP_VOWELS[Math.min(4, Math.floor(p * 5))];
    let freq;
    if (prof.mono) {
      freq = prof.f0;   // 지우개 — 한 톤 고정
    } else {
      const deg = SP_DEG[ch.codePointAt(0) % SP_DEG.length];
      freq = prof.f0 * Math.pow(2, deg / 12);
    }
    speakNote(prof, freq, vowel, when, prof.dur, prof.gain * VOICE_LEVEL, bus, bin);
  });
}

// 타이핑한 리듬 그대로 보이스를 재생한다.
// events: [{ rel: 초(첫 키 기준 상대시각), ch: 글자|null }]
// 녹음된 키 하나당 음 하나를 정확히 그 상대시각에 — 간격 보정/클램프 없음.
export function speakVoiceEvents(events, voiceId = null, mood = 'neutral') {
  if (!ctx || !events || !events.length) return;
  if (ctx.state === 'suspended') ctx.resume();
  ensureReverb(); ensureGrainBuf();
  const prof = speakProfile(voiceId);
  const now = ctx.currentTime + 0.03;
  const bin = [];
  const bus = destFor(voiceId);   // 선물 받았으면 리버브 버스로

  events.forEach((ev) => {
    const ch = ev.ch;
    const hasChar = (typeof ch === 'string' && ch.length === 1);
    const p = hasChar ? pitchForChar(ch) : Math.random();
    const vowel = SP_VOWELS[Math.min(4, Math.floor(p * 5))];
    let freq;
    if (prof.mono) {
      freq = prof.f0;   // 지우개 — 한 톤 고정
    } else {
      const code = hasChar ? ch.codePointAt(0) : Math.floor(p * 256);
      freq = prof.f0 * Math.pow(2, SP_DEG[code % SP_DEG.length] / 12);
    }
    speakNote(prof, freq, vowel, now + ev.rel, prof.dur, prof.gain * VOICE_LEVEL, bus, bin);
  });
  emit({ type: 'speak-voice', voiceId, mood, count: events.length });
}

// 합주(엔딩) — 여태까지 1·2가 친 모든 리듬을 동시에 겹쳐 끊김 없이 반복한다.
// 마음이 닿은 순간: 각 목소리가 자기 리듬을 계속 루프하며 한 공간에서 같이 울리고,
// 강한 리버브가 가득 차며, 리듬은 2배 빨라져 진짜 합주처럼 몰아친다.
//  rhythms: [{ voiceId, events:[{rel,ch}] }]  (플레이어별 메시지마다 한 덩어리)
//  opts: { speed=2(배속), duration(초, 합주 길이) }
export function playEnsemble(rhythms, { speed = 2, duration = 13, loop = true } = {}) {
  if (!ctx || !rhythms || !rhythms.length) { console.warn('[ensemble] 중단: ctx/rhythms 없음', !!ctx, rhythms && rhythms.length); return () => {}; }
  if (ctx.state === 'suspended') ctx.resume();
  ensureGrainBuf();

  // 강한 리버브 전용 버스 — 긴 꼬리의 합성 임펄스(엔딩만의 넓은 공간감)
  const rate = ctx.sampleRate, secs = 4.5, len = Math.floor(rate * secs);
  const ir = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.0);
  }
  const conv = ctx.createConvolver(); conv.buffer = ir;
  const out = ctx.createGain(); out.gain.value = 1.0;    // 합주 전체 게인(엔딩의 주인공)
  const dry = ctx.createGain(); dry.gain.value = 0.65;
  const wet = ctx.createGain(); wet.gain.value = 1.8;    // 강한 리버브
  const wetLp = ctx.createBiquadFilter(); wetLp.type = 'lowpass'; wetLp.frequency.value = 6500;
  out.connect(dry); dry.connect(master);
  out.connect(conv); conv.connect(wetLp); wetLp.connect(wet); wet.connect(master);

  const bin = [];
  const start = ctx.currentTime + 0.12;
  const MAX_NOTES = 700;     // 과부하 방지 하드 상한(이걸 넘으면 합주가 무음이 될 수 있음)
  let scheduled = 0;

  // 각 목소리(리듬 덩어리)를 독립적으로 계속 루프시킨다 → 끊김 없는 층층 합주.
  rhythms.forEach((r, ri) => {
    if (!r.events || !r.events.length) return;
    const prof = speakProfile(r.voiceId);
    // 이 리듬의 한 바퀴 길이(배속 적용). 너무 짧으면 최소 길이를 줘 또랑또랑 반복.
    let span = 0;
    r.events.forEach((e) => { if (e.rel > span) span = e.rel; });
    const loopLen = Math.max(0.6, span / speed + 0.28);
    // 시작 엇갈림 — 트랙이 직접 offset(초)을 주면 그걸 쓰고(오케스트라 랜덤 입장),
    // 없으면 기본 살짝 엇갈림(겹침의 맛).
    const offset = (r.offset != null) ? r.offset : (ri % rhythms.length) * 0.12;
    // loop=false면 한 번만 연주(오케스트라 통과 1회). loop=true면 duration까지 반복.
    const step = loop ? loopLen : (duration + loopLen);

    for (let cycleStart = offset; cycleStart < duration; cycleStart += step) {
      const base = start + cycleStart;
      for (const ev of r.events) {
        if (scheduled >= MAX_NOTES) break;
        const ch = ev.ch;
        const hasChar = (typeof ch === 'string' && ch.length === 1);
        const p = hasChar ? pitchForChar(ch) : Math.random();
        const vowel = SP_VOWELS[Math.min(4, Math.floor(p * 5))];
        let freq;
        if (prof.mono) freq = prof.f0;
        else {
          const code = hasChar ? ch.codePointAt(0) : Math.floor(p * 256);
          freq = prof.f0 * Math.pow(2, SP_DEG[code % SP_DEG.length] / 12);
        }
        speakNote(prof, freq, vowel, base + ev.rel / speed, prof.dur, prof.gain * VOICE_LEVEL * 0.85, out, bin, true);
        scheduled++;
      }
      if (scheduled >= MAX_NOTES) break;
    }
  });
  console.info('[ensemble] ctx.state:', ctx.state, '· 트랙:', rhythms.length,
               '· 예약 음표:', scheduled, '/ 상한', MAX_NOTES, '· duration:', duration.toFixed(1));
  emit({ type: 'ensemble', voices: rhythms.length, speed, duration });

  // 중단 함수 — 엔딩을 떠나거나 다시 시작할 때 깔끔히 멈춘다.
  return () => {
    const t = ctx.currentTime;
    out.gain.cancelScheduledValues(t);
    out.gain.setValueAtTime(out.gain.value, t);
    out.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    bin.forEach((n) => { try { n.stop(t + 0.45); } catch (e) {} });
    setTimeout(() => { try { out.disconnect(); conv.disconnect(); wet.disconnect(); } catch (e) {} }, 600);
  };
}

// ============================================================
//  엔딩 악보 연주 엔진
//  대화를 하나의 곡으로 연주한다. 단순한 비프음이 아니라:
//   · 포먼트 합성(모음 a·e·i·o·u) — 합창/보코더 같은 사람 목소리 음색
//   · 스피킹 피아노 — 타격감 있는 음을 포먼트로 걸러 "말하는 듯한" 음
//   · 그래뉼러 신스 — 짧은 알갱이 소리 구름(악센트/반짝임)
//   · 앰비언트 드론 — 곡 전체에 깔리는 저음 패드 (느린 필터·게인 흔들림)
//   · 컨볼루션 리버브 — 합성 임펄스로 공간감을 입혀 "합성 티"를 지운다
//  notes: [{ midi, dur(박), player, garble, vowel, technique, accent }] | { rest, dur }
// ============================================================

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// 모음별 포먼트 주파수(F1,F2,F3) — 사람 목소리의 정체를 만드는 공명점
const FORMANTS = {
  a: [730, 1090, 2440],
  e: [530, 1840, 2480],
  i: [270, 2290, 3010],
  o: [570, 840, 2410],
  u: [300, 870, 2240],
};
const FORMANT_GAIN = [1.0, 0.5, 0.28];

// --- 리버브(공간감) : 합성 임펄스 응답을 컨볼루션 ---
let reverb = null, reverbWet = null;
function ensureReverb() {
  if (reverb) return;
  const seconds = 2.8, rate = ctx.sampleRate, len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
  }
  reverb = ctx.createConvolver(); reverb.buffer = buf;
  reverbWet = ctx.createGain(); reverbWet.gain.value = 0.5;
  reverb.connect(reverbWet); reverbWet.connect(master);
}

// --- 그래뉼러용 텍스처 버퍼(부드러운 갈색 잡음) ---
let grainBuf = null;
function ensureGrainBuf() {
  if (grainBuf) return;
  const len = Math.floor(ctx.sampleRate * 1.0);
  grainBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = grainBuf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    last = last * 0.96 + w * 0.04;   // 저역 통과 → 갈색 잡음(공기감)
    d[i] = last * 3.2;
  }
}

// 소스를 모음 포먼트 필터 뱅크로 통과시켜 합산 노드를 돌려준다
function formantBank(src, vowel, garble) {
  const F = FORMANTS[vowel] || FORMANTS.a;
  const sum = ctx.createGain(); sum.gain.value = 1;
  F.forEach((freq, i) => {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq * (1 - 0.05 * garble) * (1 + (Math.random() - 0.5) * 0.05 * garble);
    bp.Q.value = (11 - 4 * garble) + i * 2;
    const g = ctx.createGain(); g.gain.value = FORMANT_GAIN[i];
    src.connect(bp); bp.connect(g); g.connect(sum);
  });
  return sum;
}

// 포먼트 보이스(합창/보코더 느낌) — 부드러운 어택, 비브라토
function voiceFormant(freq, when, dur, gain, vowel, garble, send, bin) {
  const src = ctx.createOscillator(); src.type = 'sawtooth';
  src.frequency.setValueAtTime(freq, when);
  const lfo = ctx.createOscillator(); const lg = ctx.createGain();
  lfo.type = 'sine'; lfo.frequency.value = 4.2 + Math.random();
  lg.gain.value = freq * (0.005 + 0.02 * garble);
  lfo.connect(lg); lg.connect(src.frequency);

  const bank = formantBank(src, vowel, garble);
  const amp = ctx.createGain();
  const a = Math.min(0.16, dur * 0.4);
  amp.gain.setValueAtTime(0.0001, when);
  amp.gain.exponentialRampToValueAtTime(gain, when + a);
  amp.gain.setValueAtTime(gain, when + Math.max(a, dur * 0.55));
  amp.gain.exponentialRampToValueAtTime(0.0006, when + dur);
  bank.connect(amp); amp.connect(scoreBus); if (send) amp.connect(send);

  src.start(when); lfo.start(when);
  const end = when + dur + 0.06; src.stop(end); lfo.stop(end);
  bin.push(src, lfo);
  emit({ type: 'note', freq, dur, voice: 'formant', vowel });
}

// 스피킹 피아노 — 타격감 있는 배음 + 포먼트로 "말하는" 음색, 짧은 어택·긴 여운
function voicePiano(freq, when, dur, gain, vowel, garble, send, bin) {
  const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.setValueAtTime(freq, when);
  const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.setValueAtTime(freq * 2.001, when);
  const m1 = ctx.createGain(); m1.gain.value = 0.6; o1.connect(m1);
  const m2 = ctx.createGain(); m2.gain.value = 0.22; o2.connect(m2);
  const pre = ctx.createGain(); m1.connect(pre); m2.connect(pre);

  const bank = formantBank(pre, vowel, garble);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, when);
  amp.gain.exponentialRampToValueAtTime(gain, when + 0.006);   // 날카로운 어택
  amp.gain.exponentialRampToValueAtTime(0.0006, when + dur * 1.25); // 길게 울려 사라짐
  bank.connect(amp); amp.connect(scoreBus); if (send) amp.connect(send);

  o1.start(when); o2.start(when);
  const end = when + dur * 1.3 + 0.06; o1.stop(end); o2.stop(end);
  bin.push(o1, o2);
  emit({ type: 'note', freq, dur, voice: 'piano', vowel });
}

// 그래뉼러 버스트 — 짧은 알갱이 소리 구름
function granularBurst(when, dur, baseFreq, gain, send, bin) {
  const n = Math.floor(10 + dur * 40);
  for (let i = 0; i < n; i++) {
    const gt = when + Math.random() * dur;
    const src = ctx.createBufferSource(); src.buffer = grainBuf;
    src.playbackRate.value = (baseFreq / 330) * (0.8 + Math.random() * 0.7);
    const gd = 0.035 + Math.random() * 0.06;
    const ge = ctx.createGain();
    ge.gain.setValueAtTime(0.0001, gt);
    ge.gain.exponentialRampToValueAtTime(gain * (0.3 + Math.random() * 0.6), gt + gd * 0.4);
    ge.gain.exponentialRampToValueAtTime(0.0005, gt + gd);
    const off = Math.random() * (grainBuf.duration - gd - 0.01);
    src.connect(ge); ge.connect(scoreBus); if (send) ge.connect(send);
    src.start(gt, off, gd + 0.02);
    bin.push(src);
  }
}

// 앰비언트 드론 — 곡 전체에 깔리는 저음 패드
function startDrone(rootMidi, when, totalDur, send, bin) {
  const voices = [rootMidi - 12, rootMidi - 5, rootMidi - 24]; // 근음·5도·서브
  voices.forEach((m, i) => {
    const f = mtof(m);
    const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = f;
    const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = f * 1.004;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.6;
    lp.frequency.setValueAtTime(200, when);
    lp.frequency.linearRampToValueAtTime(560, when + totalDur * 0.5);
    lp.frequency.linearRampToValueAtTime(240, when + totalDur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.12, when + 2.2);
    g.gain.setValueAtTime(0.12, Math.max(when + 2.2, when + totalDur - 3));
    g.gain.exponentialRampToValueAtTime(0.0006, when + totalDur);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.06 + i * 0.03;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.035;
    lfo.connect(lfoG); lfoG.connect(g.gain);
    o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(scoreBus); if (send) g.connect(send);
    o1.start(when); o2.start(when); lfo.start(when);
    const end = when + totalDur + 0.3; o1.stop(end); o2.stop(end); lfo.stop(end);
    bin.push(o1, o2, lfo);
  });
}

// ============================================================
//  대화 중 앰비언스(살아있는 배경음)
//  · LFO로 피치가 천천히 흔들리는 저음 신스 패드 + 듬뿍 깔린 리버브
//  · 실시간 매칭(rapport)·언어 차이(mismatch)에 따라 음색/협화도가 변하고
//  · 대화가 진행될수록(progress) 필터가 열리고 상성층이 더해지며 고조된다
// ============================================================
let amb = null;

// ============================================================
//  공용: 잔잔한 저음 엠비언스 베드.
//  강하지 않게 깔리지만, 느린 LFO들(필터·디튠·음량)이 끊임없이
//  움직여서 지루하지 않게 변화가 지속된다. 모든 화면 아래에 깐다.
// ============================================================
function makeAmbienceBed(dest) {
  const now = ctx.currentTime;
  const out = ctx.createGain(); out.gain.value = 0.0001;
  out.connect(dest);
  out.gain.setTargetAtTime(0.55, now, 2.5);            // 아주 천천히 페이드 인

  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
  lp.frequency.value = 380; lp.Q.value = 0.5;          // 저음만
  const breath = ctx.createGain(); breath.gain.value = 0.5; // 음량 호흡(LFO 대상)
  lp.connect(breath); breath.connect(out);

  const mk = (freq, g, type = 'sine') => {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    const og = ctx.createGain(); og.gain.value = g;
    o.connect(og); og.connect(lp); o.start(now);
    return { o, og };
  };
  const v1 = mk(55, 0.5);            // A1
  const v2 = mk(55 * 1.006, 0.4);    // 살짝 디튠된 코러스
  const v3 = mk(82.41, 0.22);        // E2 (5도)
  const v4 = mk(110, 0.14, 'triangle'); // A2 옅은 배음색

  // 느린 필터 스윕 — 음색이 계속 천천히 열리고 닫힌다
  const lfoF = ctx.createOscillator(); lfoF.type = 'sine'; lfoF.frequency.value = 0.025;
  const lfoFg = ctx.createGain(); lfoFg.gain.value = 220;
  lfoF.connect(lfoFg); lfoFg.connect(lp.frequency); lfoF.start(now);
  // 느린 디튠 드리프트 — 코러스가 미묘하게 일렁
  const lfoP = ctx.createOscillator(); lfoP.type = 'sine'; lfoP.frequency.value = 0.04;
  const lfoPg = ctx.createGain(); lfoPg.gain.value = 7;
  lfoP.connect(lfoPg);
  [v1, v2, v3, v4].forEach((v) => lfoPg.connect(v.o.detune)); lfoP.start(now);
  // 느린 음량 호흡 — 밀물·썰물처럼
  const lfoA = ctx.createOscillator(); lfoA.type = 'sine'; lfoA.frequency.value = 0.06;
  const lfoAg = ctx.createGain(); lfoAg.gain.value = 0.18;
  lfoA.connect(lfoAg); lfoAg.connect(breath.gain); lfoA.start(now);

  return { out, voices: [v1, v2, v3, v4], lfos: [lfoF, lfoP, lfoA] };
}
function stopBed(bed) {
  if (!bed) return;
  const end = ctx.currentTime + 2.0;
  bed.out.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.5);
  bed.voices.forEach((v) => { try { v.o.stop(end); } catch (e) {} });
  bed.lfos.forEach((l) => { try { l.stop(end); } catch (e) {} });
}

// 부드러운 저음 한 방울 — 튀지 않게 천천히 부풀었다 사라지는 엠비언트 드롭.
function softDrop(when, dest, verbSend) {
  const o = ctx.createOscillator(); o.type = 'sine';
  const f0 = 90 + Math.random() * 130;                 // 아주 낮게 90~220Hz
  o.frequency.setValueAtTime(f0 * 1.35, when);
  o.frequency.exponentialRampToValueAtTime(f0, when + 0.3); // 느릿한 하강
  const g = ctx.createGain();
  const peak = 0.06 + Math.random() * 0.05;            // 작게
  const atk = 0.03 + Math.random() * 0.05;             // 부드러운 어택(안 튐)
  const rel = 0.6 + Math.random() * 0.7;               // 긴 꼬리
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(peak, when + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, when + atk + rel);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
  lp.frequency.value = 500 + Math.random() * 350;
  o.connect(lp); lp.connect(g); g.connect(dest);
  if (verbSend) g.connect(verbSend);
  o.start(when); o.stop(when + atk + rel + 0.1);
}

// 대화 배경 = 잔잔한 저음 베드 + 불규칙하게 떨어지는 부드러운 드롭(엠비언트).
// 진행될수록 드롭 빈도가 늘어 변화가 지속된다(여전히 잔잔하게).
export function startAmbience(root = 38) {
  if (!ctx || amb) return;
  if (ctx.state === 'suspended') ctx.resume();
  ensureReverb();
  const now = ctx.currentTime;
  const bus = ctx.createGain(); bus.gain.value = 0.0001;
  bus.connect(master);
  bus.gain.setTargetAtTime(0.7, now, 1.0);
  const verbSend = ctx.createGain(); verbSend.gain.value = 0.4; // 듬뿍 — 엠비언트하게
  verbSend.connect(reverb);

  const bed = makeAmbienceBed(bus);
  amb = { bus, verbSend, bed, density: 0.1, alive: true, timer: null };

  // 자기 자신을 다시 예약하는 불규칙 스케줄러(setTimeout 체인).
  function scheduleHit() {
    if (!amb || !amb.alive) return;
    const d = amb.density;                       // 0..1 — 진행도에 따라 커진다
    const minGap = 0.25 + (1 - d) * 0.45;        // 가장 촘촘해도 ~0.25s — 잔잔하게
    const maxGap = 0.9 + (1 - d) * 1.8;          // 초반엔 듬성듬성
    const gap = minGap + Math.random() * (maxGap - minGap);
    amb.timer = setTimeout(() => {
      softDrop(ctx.currentTime, amb.bus, amb.verbSend);
      if (Math.random() < d * 0.3) {             // 진행될수록 가끔 겹침
        softDrop(ctx.currentTime + 0.1 + Math.random() * 0.2, amb.bus, amb.verbSend);
      }
      scheduleHit();
    }, gap * 1000);
  }
  scheduleHit();
}

// progress(0..1) 대화 진행도 → 드롭 빈도(밀도)를 높인다.
export function updateAmbience({ rapport = 0.5, mismatch = 0, progress = 0 } = {}) {
  if (!amb) return;
  amb.density = Math.min(1, 0.1 + progress * 0.95);
}

export function stopAmbience() {
  if (!amb) return;
  const a = amb; amb = null;
  a.alive = false;
  clearTimeout(a.timer);
  stopBed(a.bed);
  a.bus.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.4);
}

// ============================================================
//  타이틀 화면
//   · 후경: 끊김 없이 매끄럽게 "끝없이 올라가는" 셰퍼드–리세 글리산도
//           (여러 사인 보이스가 로그-피치로 연속 상승, 양 끝에서 음량이
//            0으로 사라져 무한 상승의 착청을 만든다)
//   · 전경: 숨소리 — 필터된 노이즈가 들숨/날숨으로 차오르고 빠진다
//   · 바닥: 잔잔한 저음 베드
// ============================================================
let titleSeq = null;

function pluck8(freq, when, dur, gain, type, dest) {
  const o = ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(freq, when);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(gain, when + 0.004);  // 딱! 어택
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);  // 짧은 감쇠
  o.connect(g); g.connect(dest);
  o.start(when); o.stop(when + dur + 0.02);
}

// 숨소리 레이어 — 들숨(밝아지며 차오름)·날숨(어두워지며 빠짐)을 반복.
function makeBreathLayer(dest) {
  const len = Math.floor(ctx.sampleRate * 2);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;   // 화이트 노이즈
  const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
  bp.frequency.value = 600; bp.Q.value = 0.7;
  const env = ctx.createGain(); env.gain.value = 0.0001;
  src.connect(bp); bp.connect(env); env.connect(dest);
  src.start();

  let alive = true, timer = null;
  function breathe() {
    if (!alive) return;
    const t = ctx.currentTime;
    const inh = 1.1 + Math.random() * 0.6;   // 들숨
    const exh = 1.6 + Math.random() * 0.9;   // 날숨(조금 더 길게)
    const pause = 0.3 + Math.random() * 0.8; // 쉼
    const peak = 0.22 + Math.random() * 0.1;
    env.gain.cancelScheduledValues(t);
    env.gain.setTargetAtTime(peak, t, inh * 0.4);            // 들숨: 차오름
    bp.frequency.setTargetAtTime(1300, t, inh * 0.5);         //       밝아짐
    env.gain.setTargetAtTime(0.0001, t + inh, exh * 0.4);     // 날숨: 빠짐
    bp.frequency.setTargetAtTime(480, t + inh, exh * 0.5);    //       어두워짐
    timer = setTimeout(breathe, (inh + exh + pause) * 1000);
  }
  timer = setTimeout(breathe, 250);

  return {
    stop() {
      alive = false; clearTimeout(timer);
      const end = ctx.currentTime + 0.7;
      env.gain.cancelScheduledValues(ctx.currentTime);
      env.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.3);
      try { src.stop(end); } catch (e) {}
    },
  };
}

export function startTitleMusic() {
  if (!ctx || titleSeq) return;
  if (ctx.state === 'suspended') ctx.resume();
  ensureReverb();
  const now = ctx.currentTime;

  // --- 후경: 셰퍼드 글리산도 (낮은 음량으로 뒤에 깐다) ---
  const back = ctx.createGain(); back.gain.value = 0.0001;
  back.connect(master);
  back.gain.setTargetAtTime(0.3, now, 1.4);
  const verb = ctx.createGain(); verb.gain.value = 0.55;   // 몽환적으로 리버브 듬뿍
  back.connect(verb); verb.connect(reverb);

  const fMin = 55, fMax = 55 * Math.pow(2, 5);             // A1~A6 (5옥타브)
  const logMin = Math.log2(fMin), logMax = Math.log2(fMax);
  const span = logMax - logMin;
  const N = 7;
  const voices = [];
  for (let i = 0; i < N; i++) {
    const o = ctx.createOscillator(); o.type = 'sine';
    const g = ctx.createGain(); g.gain.value = 0;
    o.connect(g); g.connect(back);
    const p = logMin + (i / N) * span;                     // 로그-피치 균등 배치
    o.frequency.value = Math.pow(2, p);
    o.start(now);
    voices.push({ o, g, p });
  }
  // 종 모양 음량창: 중역에서 가장 크고 양 끝(고·저)에서 0 → 무한 상승 이음매 숨김
  const ampFor = (p) => Math.sin(Math.PI * ((p - logMin) / span)) * 0.15;

  // 연속 상승: 작은 폭을 자주 갱신해 "끊기지 않고" 매끄럽게 글라이드.
  const cycleSec = 20;                  // 5옥타브를 천천히 가로지르는 시간 → 끝없이
  const tick = 0.06;
  const perTick = span * (tick / cycleSec);
  const timer = setInterval(() => {
    const t = ctx.currentTime;
    voices.forEach((v) => {
      v.p += perTick;
      if (v.p > logMax) v.p -= span;     // 천장 넘으면 바닥으로 되돌려 끝없이
      const f = Math.pow(2, v.p);
      v.o.frequency.setTargetAtTime(f, t, tick * 0.9);     // 부드럽게 이어짐
      v.g.gain.setTargetAtTime(ampFor(v.p), t, tick * 0.9);
    });
  }, tick * 1000);

  // --- 전경: 숨소리 ---
  const fore = ctx.createGain(); fore.gain.value = 0.0001;
  fore.connect(master);
  fore.gain.setTargetAtTime(0.6, now, 1.0);
  const foreVerb = ctx.createGain(); foreVerb.gain.value = 0.18;
  fore.connect(foreVerb); foreVerb.connect(reverb);
  const breath = makeBreathLayer(fore);

  // --- 바닥: 잔잔한 저음 베드 ---
  const bed = makeAmbienceBed(back);

  titleSeq = { back, fore, voices, timer, bed, breath };
}

export function stopTitleMusic() {
  if (!titleSeq) return;
  const t = titleSeq; titleSeq = null;
  clearInterval(t.timer);
  const end = ctx.currentTime + 1.6;
  t.back.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.4);
  t.fore.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.4);
  t.voices.forEach((v) => { try { v.o.stop(end); } catch (e) {} });
  t.breath.stop();
  stopBed(t.bed);
}

// ============================================================
//  캐릭터 선택 화면 — 경쾌한 8비트 음악(칩튠) + 잔잔한 저음 베드.
// ============================================================
let selectSeq = null;

export function startSelectTone() {
  if (!ctx || selectSeq) return;
  if (ctx.state === 'suspended') ctx.resume();
  const out = ctx.createGain(); out.gain.value = 0.0001;
  out.connect(master);
  out.gain.setTargetAtTime(0.32, ctx.currentTime, 0.3);

  const root = 57;                          // A3
  const PENTA = [0, 2, 4, 7, 9];            // 장5음계 — 밝은 8비트
  const BASS = [0, 0, 7, 5, 0, 9, 7, 4];    // 마디별 베이스 음정(반음)
  const ARP = [0, 2, 4, 7, 9, 7, 4, 2];     // 아르페지오 진행
  const step = 0.15;                        // 16분음표 (~100 BPM의 16분)
  let i = 0;
  let next = ctx.currentTime + 0.06;
  const timer = setInterval(() => {
    const now = ctx.currentTime;
    while (next < now + 0.12) {
      const bar = Math.floor(i / 8);
      // 리드(square) — 매 스텝 아르페지오, 가끔 한 옥타브 위로
      if (Math.random() < 0.92) {
        const deg = ARP[i % ARP.length];
        const oct = (i % 16 < 8) ? 12 : 24;
        pluck8(mtof(root + oct + deg), next, step * 1.4, 0.12, 'square', out);
      }
      // 베이스(triangle) — 4스텝마다
      if (i % 4 === 0) {
        pluck8(mtof(root - 12 + BASS[bar % BASS.length]), next, step * 3.2, 0.22, 'triangle', out);
      }
      // 하이햇풍 짧은 고음 칩 — 2스텝마다 옅게
      if (i % 2 === 1) {
        pluck8(mtof(root + 36 + PENTA[(i * 3) % PENTA.length]), next, step * 0.5, 0.04, 'square', out);
      }
      i++;
      next += step;
    }
  }, 25);

  const bed = makeAmbienceBed(out);
  selectSeq = { out, timer, bed };
}

export function stopSelectTone() {
  if (!selectSeq) return;
  const s = selectSeq; selectSeq = null;
  clearInterval(s.timer);
  s.out.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.2);
  stopBed(s.bed);
}

// ============================================================
//  화면 배경음 WAV 루프 플레이어
//  audio/ 폴더에 화면별 wav를 넣으면 그 화면의 배경음으로 루프 재생한다.
//   audio/title.wav   — 타이틀
//   audio/select.wav  — 캐릭터 선택
//   audio/play.wav     — 대화(플레이)
//   audio/ending.wav   — 엔딩
//  파일이 없으면 조용히 합성 배경음으로 폴백한다(아무것도 깨지지 않음).
//  타이핑/보이스(합성)는 그대로 유지 — "화면 배경음만" 대체한다.
// ============================================================
const SCREEN_WAV = {
  title:  'audio/title.wav',
  select: 'audio/select.wav',
  play:   'audio/play.wav',
  ending: 'audio/ending.wav',
};
const wavCache = new Map();   // url -> AudioBuffer | null(파일 없음)
let wavBus = null;            // 화면 배경 WAV 전용 서브믹스
let curWav = null;            // { src, gain, url }

async function loadWav(url) {
  if (wavCache.has(url)) return wavCache.get(url);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const arr = await res.arrayBuffer();
    const buf = await ctx.decodeAudioData(arr);
    wavCache.set(url, buf);
    return buf;
  } catch (e) {
    wavCache.set(url, null);  // 다음부터 재시도하지 않음(조용히 폴백)
    return null;
  }
}

// 화면 배경 WAV를 루프 재생. 성공하면 true(=합성 배경 생략), 없으면 false.
export async function playScreenWav(screen) {
  if (!ctx) return false;
  const url = SCREEN_WAV[screen];
  if (!url) return false;
  const buf = await loadWav(url);
  if (!buf) return false;
  if (curWav && curWav.url === url) return true;  // 같은 트랙이면 그대로 둔다
  stopScreenWav();
  if (ctx.state === 'suspended') ctx.resume();
  if (!wavBus) { wavBus = ctx.createGain(); wavBus.gain.value = 0.9; wavBus.connect(master); }
  const src = ctx.createBufferSource();
  src.buffer = buf; src.loop = true;
  const g = ctx.createGain(); g.gain.value = 0.0001;
  src.connect(g); g.connect(wavBus);
  g.gain.setTargetAtTime(1, ctx.currentTime, 0.6);   // 크로스페이드 인
  src.start();
  curWav = { src, gain: g, url };
  return true;
}

export function stopScreenWav() {
  if (!curWav) return;
  const c = curWav; curWav = null;
  const end = ctx.currentTime + 1.0;
  c.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.35);  // 페이드 아웃
  try { c.src.stop(end); } catch (e) {}
}

// 악보 전체 연주. 반환값은 중단 함수.
export function playScore(notes, { tempo = 128, root = 38, onDone } = {}) {
  if (!ctx || !notes || !notes.length) { if (onDone) onDone(); return () => {}; }
  if (ctx.state === 'suspended') ctx.resume();
  ensureReverb(); ensureGrainBuf();

  const spb = 60 / tempo;
  const start = ctx.currentTime + 0.2;
  const bin = [];                 // 정지 가능한 소스 노드들
  const send = reverb;
  let totalBeats = 0;
  notes.forEach((n) => { totalBeats += n.dur; });

  startDrone(root, start, totalBeats * spb, send, bin);

  let beat = 0;
  notes.forEach((n) => {
    const when = start + beat * spb;
    if (!n.rest) {
      const freq = mtof(n.midi);
      const dur = n.dur * spb;
      const g = n.accent ? 0.32 : 0.24;
      if (n.technique === 'piano') voicePiano(freq, when, dur, g, n.vowel || 'a', n.garble || 0, send, bin);
      else voiceFormant(freq, when, dur, g, n.vowel || 'a', n.garble || 0, send, bin);
      if (n.accent) granularBurst(when, Math.min(dur, 0.45), freq * 2, 0.16, send, bin);
    }
    beat += n.dur;
  });

  let cancelled = false;
  const totalMs = (start - ctx.currentTime + totalBeats * spb) * 1000 + 400;
  const done = setTimeout(() => { if (!cancelled && onDone) onDone(); }, totalMs);

  return () => {
    cancelled = true; clearTimeout(done);
    for (const s of bin) { try { s.stop(); } catch (e) { /* 이미 끝남 */ } }
  };
}

// 미리 voices 로딩 (일부 브라우저는 비동기)
export function warmVoices() {
  if ('speechSynthesis' in window) {
    speechSynthesis.getVoices();
    speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
  }
}
