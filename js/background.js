// 두 캐릭터의 세계를 하나의 '상상된 공간'으로 합성한다.
// 예) 우파루파(물) + 쿠키(베이커리) → 물빛이 도는 베이커리.
// 벽/하늘 + 바닥 + 양쪽 캐릭터의 테마 소품을 한 무대에 섞어 그리고,
// rapport(0..1)가 높을수록 두 세계가 서로에게 번져 섞이며 따뜻해지고,
// 낮을수록 좌/우로 갈라지며 차갑고 어둑해진다.

const CHAR_SCENE = ['garden', 'deepsea', 'sky', 'water', 'bakery', 'sweet', 'desk', 'house'];

function lerp(a, b, t) { return a + (b - a) * t; }
function mix(c1, c2, t) { return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)]; }
function rgb(c, a = 1) { return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`; }
function desat(c, amt) { const g = (c[0] + c[1] + c[2]) / 3; return mix(c, [g, g, g], amt); }

// ---- 픽셀 블록 헬퍼 ----
function blk(ctx, x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x | 0, y | 0, Math.max(1, w | 0), Math.max(1, h | 0)); }
// 모서리를 살짝 깎은 둥근 픽셀 덩어리
function blob(ctx, x, y, w, h, c) { blk(ctx, x + 1, y, w - 2, h, c); blk(ctx, x, y + 1, w, h - 2, c); }

// ===== 소품 그리기 (각 fn(ctx, x, y, s, t) — y는 바닥선/벽 기준) =====
// near 소품: y가 바닥(아래)이라고 보고 위로 그린다.
function flower(ctx, x, y, s, t) {
  const sway = Math.sin(t * 1.5 + x) * 2 * s;
  blk(ctx, x, y - 18 * s, 2 * s, 18 * s, '#3f8f4a');                 // 줄기
  blk(ctx, x - 4 * s, y - 11 * s, 4 * s, 2 * s, '#3f8f4a');           // 잎
  const pc = ['#ff6f91', '#ffd166', '#a78bfa', '#ff8c42'][((x | 0) % 4 + 4) % 4];
  const cx = x + 1 * s + sway, cy = y - 22 * s;
  blob(ctx, cx - 4 * s, cy - 4 * s, 8 * s, 8 * s, pc);
  blk(ctx, cx - 1 * s, cy - 1 * s, 2 * s, 2 * s, '#fff4c2');          // 꽃술
}
function grassTuft(ctx, x, y, s) {
  const c = '#5aa85a';
  for (let i = -2; i <= 2; i++) blk(ctx, x + i * 3 * s, y - (8 + Math.abs(i) * -3 + 6) * s, 2 * s, (10 - Math.abs(i) * 2) * s, c);
}
function mushroom(ctx, x, y, s) {
  blk(ctx, x - 2 * s, y - 8 * s, 4 * s, 8 * s, '#f3ead7');
  blob(ctx, x - 6 * s, y - 14 * s, 12 * s, 8 * s, '#e5484d');
  blk(ctx, x - 3 * s, y - 12 * s, 2 * s, 2 * s, '#fff'); blk(ctx, x + 2 * s, y - 11 * s, 2 * s, 2 * s, '#fff');
}
function coral(ctx, x, y, s, t) {
  const sway = Math.sin(t + x) * 2 * s;
  blk(ctx, x - 1 * s, y - 16 * s, 3 * s, 16 * s, '#ff8c66');
  blk(ctx, x - 6 * s + sway, y - 22 * s, 3 * s, 10 * s, '#ff7aa8');
  blk(ctx, x + 4 * s + sway, y - 20 * s, 3 * s, 9 * s, '#ffb3c1');
  blk(ctx, x - 8 * s, y - 4 * s, 16 * s, 4 * s, '#c9628a');
}
function seaweed(ctx, x, y, s, t) {
  const c = '#3fa37a';
  for (let i = 0; i < 7; i++) { const yy = y - i * 4 * s; blk(ctx, x + Math.sin(t * 1.2 + i * 0.6) * 4 * s, yy, 3 * s, 4 * s, c); }
}
function lilyPad(ctx, x, y, s, t) {
  const bob = Math.sin(t + x) * 1.5 * s;
  blob(ctx, x - 9 * s, y - 4 * s + bob, 18 * s, 5 * s, '#3f9d63');
  blk(ctx, x - 1 * s, y - 4 * s + bob, 6 * s, 2 * s, '#2c7a49');
  blob(ctx, x + 2 * s, y - 11 * s + bob, 7 * s, 7 * s, '#ffe1ee');   // 수련꽃
}
function reed(ctx, x, y, s, t) {
  blk(ctx, x + Math.sin(t + x) * 2 * s, y - 24 * s, 2 * s, 24 * s, '#5fae7a');
  blob(ctx, x - 1 * s, y - 30 * s, 5 * s, 8 * s, '#8a5a3a');         // 부들 머리
}
function oven(ctx, x, y, s, t) {
  blk(ctx, x - 14 * s, y - 26 * s, 28 * s, 26 * s, '#8a5236');       // 벽돌 몸체
  for (let r = 0; r < 4; r++) for (let cI = 0; cI < 4; cI++) blk(ctx, x - 13 * s + cI * 7 * s, y - 25 * s + r * 6 * s, 6 * s, 5 * s, '#9c6042');
  blob(ctx, x - 9 * s, y - 20 * s, 18 * s, 14 * s, '#2a1a12');       // 아치 입구
  const glow = 0.55 + 0.25 * Math.sin(t * 4);
  blob(ctx, x - 7 * s, y - 17 * s, 14 * s, 10 * s, rgb([255, 150, 60], glow)); // 불빛
  blk(ctx, x - 16 * s, y - 30 * s, 32 * s, 4 * s, '#6f3f28');        // 상판
}
function breadBasket(ctx, x, y, s) {
  blk(ctx, x - 12 * s, y - 8 * s, 24 * s, 8 * s, '#b07a3c');         // 바구니
  blk(ctx, x - 12 * s, y - 9 * s, 24 * s, 2 * s, '#7a5226');
  for (let i = -1; i <= 1; i++) blob(ctx, x + i * 8 * s - 4 * s, y - 16 * s, 8 * s, 9 * s, '#e8b56b'); // 빵 덩이
}
function cupcake(ctx, x, y, s) {
  blk(ctx, x - 6 * s, y - 8 * s, 12 * s, 8 * s, '#d98c5f');          // 컵
  for (let i = 0; i < 6; i++) blk(ctx, x - 6 * s + i * 2 * s, y - 8 * s, 1 * s, 8 * s, '#b06a40');
  blob(ctx, x - 7 * s, y - 16 * s, 14 * s, 10 * s, '#ff9ec4');       // 크림
  blk(ctx, x - 1 * s, y - 20 * s, 2 * s, 4 * s, '#e5484d');          // 체리
}
function lollipop(ctx, x, y, s, t) {
  blk(ctx, x, y - 16 * s, 2 * s, 16 * s, '#f0eef5');
  const spin = t * 2 + x;
  blob(ctx, x - 7 * s, y - 24 * s, 14 * s, 14 * s, '#ff7aa8');
  blk(ctx, x - 3 * s + Math.cos(spin) * 2 * s, y - 18 * s + Math.sin(spin) * 2 * s, 3 * s, 3 * s, '#fff');
  blk(ctx, x + 1 * s + Math.cos(spin + 2) * 3 * s, y - 18 * s + Math.sin(spin + 2) * 3 * s, 3 * s, 3 * s, '#a78bfa');
}
function candyCane(ctx, x, y, s) {
  for (let i = 0; i < 9; i++) blk(ctx, x - 2 * s, y - i * 3 * s, 4 * s, 3 * s, i % 2 ? '#fff' : '#e5484d');
  blk(ctx, x - 2 * s, y - 30 * s, 8 * s, 4 * s, '#e5484d');
}
function bookStack(ctx, x, y, s) {
  const cols = ['#4f76d1', '#e5484d', '#3fa37a', '#ffb02e'];
  for (let i = 0; i < 4; i++) { const w = (18 - i * 2) * s; blk(ctx, x - w / 2, y - (i + 1) * 5 * s, w, 5 * s, cols[i]); blk(ctx, x - w / 2, y - (i + 1) * 5 * s, w, 1 * s, '#0003'); }
}
function deskLamp(ctx, x, y, s, t) {
  blk(ctx, x - 6 * s, y - 2 * s, 12 * s, 2 * s, '#444');             // 받침
  blk(ctx, x - 1 * s, y - 14 * s, 2 * s, 12 * s, '#666');            // 목
  blk(ctx, x - 6 * s, y - 20 * s, 12 * s, 6 * s, '#ffb02e');         // 갓
  blob(ctx, x - 5 * s, y - 14 * s, 10 * s, 8 * s, rgb([255, 230, 150], 0.5 + 0.15 * Math.sin(t * 3))); // 빛
}
function pencilCup(ctx, x, y, s) {
  blk(ctx, x - 5 * s, y - 10 * s, 10 * s, 10 * s, '#7fb0e0');
  const cc = ['#e5484d', '#ffb02e', '#3fa37a'];
  for (let i = 0; i < 3; i++) blk(ctx, x - 4 * s + i * 3 * s, y - 18 * s, 2 * s, 9 * s, cc[i]);
}
function potPlant(ctx, x, y, s, t) {
  blk(ctx, x - 6 * s, y - 8 * s, 12 * s, 8 * s, '#c06a4a');          // 화분
  blk(ctx, x - 6 * s, y - 9 * s, 12 * s, 2 * s, '#9c5238');
  const sway = Math.sin(t + x) * 2 * s;
  for (let i = -1; i <= 1; i++) blk(ctx, x + i * 4 * s + sway, y - 22 * s, 3 * s, 14 * s, '#3fa37a');
}
function floorLamp(ctx, x, y, s, t) {
  blk(ctx, x - 1 * s, y - 30 * s, 2 * s, 30 * s, '#5a4632');
  blk(ctx, x - 7 * s, y - 40 * s, 14 * s, 10 * s, '#ffcf6b');
  blob(ctx, x - 9 * s, y - 38 * s, 18 * s, 14 * s, rgb([255, 220, 150], 0.35 + 0.1 * Math.sin(t * 2)));
}
function rug(ctx, x, y, s) {
  blob(ctx, x - 26 * s, y - 5 * s, 52 * s, 9 * s, '#b5536b');
  blob(ctx, x - 20 * s, y - 4 * s, 40 * s, 7 * s, '#e08aa0');
  blk(ctx, x - 12 * s, y - 4 * s, 24 * s, 2 * s, '#b5536b');
}

// far(벽/하늘) 소품: y가 벽의 세로 중심.
function cloud(ctx, x, y, s, t) {
  const c = '#ffffff';
  blob(ctx, x - 14 * s, y - 4 * s, 28 * s, 9 * s, c);
  blob(ctx, x - 6 * s, y - 9 * s, 16 * s, 9 * s, c);
  blob(ctx, x + 4 * s, y - 6 * s, 14 * s, 8 * s, c);
}
function sun(ctx, x, y, s, t) {
  const r = 10 * s;
  blob(ctx, x - r, y - r, r * 2, r * 2, '#ffe27a');
  blob(ctx, x - r + 2, y - r + 2, r * 2 - 4, r * 2 - 4, '#fff1ad');
  for (let i = 0; i < 8; i++) { const a = i / 8 * 6.283 + t * 0.3; blk(ctx, x + Math.cos(a) * (r + 6 * s), y + Math.sin(a) * (r + 6 * s), 2 * s, 2 * s, '#ffe27a'); }
}
function lightRay(ctx, x, y, s, t) {
  const a = 0.10 + 0.06 * Math.sin(t * 1.5 + x);
  ctx.fillStyle = rgb([150, 220, 255], a);
  ctx.beginPath();
  ctx.moveTo(x - 6 * s, y - 30 * s); ctx.lineTo(x + 6 * s, y - 30 * s);
  ctx.lineTo(x + 16 * s, y + 60 * s); ctx.lineTo(x - 16 * s, y + 60 * s);
  ctx.closePath(); ctx.fill();
}
function hangingBread(ctx, x, y, s, t) {
  const sw = Math.sin(t + x) * 2 * s;
  blk(ctx, x + sw, y - 14 * s, 1 * s, 14 * s, '#7a5226');            // 끈
  blob(ctx, x - 3 * s + sw, y, 7 * s, 16 * s, '#e0a85a');           // 바게트
}
function wallShelf(ctx, x, y, s) {
  blk(ctx, x - 18 * s, y, 36 * s, 3 * s, '#7a5226');
  for (let i = -1; i <= 1; i++) blob(ctx, x + i * 11 * s - 5 * s, y - 9 * s, 10 * s, 9 * s, '#e8b56b');
}
function garland(ctx, x, y, s, t) {
  const cc = ['#ff7aa8', '#ffd166', '#7fd1ff', '#a78bfa'];
  for (let i = 0; i < 7; i++) { const yy = y + Math.sin(i * 0.9) * 4 * s; blob(ctx, x + i * 9 * s - 30 * s, yy + Math.sin(t + i) * 1.5 * s, 7 * s, 8 * s, cc[i % 4]); }
}
function framedNote(ctx, x, y, s) {
  blk(ctx, x - 8 * s, y - 10 * s, 16 * s, 20 * s, '#8a6a4a');
  blk(ctx, x - 6 * s, y - 8 * s, 12 * s, 16 * s, '#f4efe2');
  for (let i = 0; i < 4; i++) blk(ctx, x - 4 * s, y - 5 * s + i * 4 * s, 8 * s, 1 * s, '#9aa');
}
function wallClock(ctx, x, y, s, t) {
  blob(ctx, x - 10 * s, y - 10 * s, 20 * s, 20 * s, '#e8e4d8');
  blob(ctx, x - 8 * s, y - 8 * s, 16 * s, 16 * s, '#fff');
  const a = t * 0.5;
  blk(ctx, x, y, Math.cos(a) * 6 * s, 1 * s, '#333'); blk(ctx, x, y, 1 * s, -Math.abs(Math.sin(a)) * 7 * s, '#333');
}
function window_(ctx, x, y, s, t) {
  blk(ctx, x - 16 * s, y - 18 * s, 32 * s, 36 * s, '#6a4a32');       // 창틀
  const g = ctx.createLinearGradient(0, y - 16 * s, 0, y + 16 * s);
  g.addColorStop(0, '#aee0ff'); g.addColorStop(1, '#e7f6ff');
  ctx.fillStyle = g; ctx.fillRect((x - 14 * s) | 0, (y - 16 * s) | 0, 28 * s, 32 * s);
  cloud(ctx, x + Math.sin(t * 0.2) * 6 * s, y - 4 * s, 0.5, t);      // 창밖 구름
  blk(ctx, x - 1 * s, y - 16 * s, 2 * s, 32 * s, '#6a4a32'); blk(ctx, x - 14 * s, y - 1 * s, 28 * s, 2 * s, '#6a4a32');
}
function frame(ctx, x, y, s) {
  blk(ctx, x - 10 * s, y - 8 * s, 20 * s, 16 * s, '#caa15a');
  blk(ctx, x - 8 * s, y - 6 * s, 16 * s, 12 * s, '#8fd1c0');
  blob(ctx, x - 4 * s, y - 1 * s, 8 * s, 6 * s, '#ffd166');
}

const SCENES = {
  garden:  { wallTop: [150, 205, 255], wallBot: [206, 234, 234], floor: [112, 172, 92],  floorShade: [78, 130, 64],  interior: false, far: [cloud, sun],            near: [flower, grassTuft, mushroom] },
  deepsea: { wallTop: [18, 42, 88],    wallBot: [8, 18, 48],     floor: [12, 28, 56],    floorShade: [6, 14, 34],    interior: false, far: [lightRay, cloud],        near: [coral, seaweed] },
  sky:     { wallTop: [120, 186, 250], wallBot: [202, 230, 255], floor: [226, 240, 252], floorShade: [188, 210, 236], interior: false, far: [cloud, sun],            near: [grassTuft, flower] },
  water:   { wallTop: [150, 212, 240], wallBot: [202, 236, 246], floor: [74, 154, 168],  floorShade: [40, 112, 132],  interior: false, far: [cloud, reed],           near: [lilyPad, reed] },
  bakery:  { wallTop: [242, 212, 168], wallBot: [226, 186, 138], floor: [172, 116, 70],  floorShade: [136, 88, 52],   interior: true,  far: [hangingBread, wallShelf], near: [oven, breadBasket] },
  sweet:   { wallTop: [255, 206, 226], wallBot: [255, 232, 242], floor: [228, 172, 202], floorShade: [200, 142, 176], interior: true,  far: [garland, cloud],        near: [cupcake, lollipop, candyCane] },
  desk:    { wallTop: [226, 222, 210], wallBot: [206, 206, 200], floor: [182, 150, 110], floorShade: [150, 120, 85],  interior: true,  far: [framedNote, wallClock],  near: [bookStack, deskLamp, pencilCup] },
  house:   { wallTop: [226, 196, 162], wallBot: [206, 172, 136], floor: [162, 122, 86],  floorShade: [126, 92, 64],   interior: true,  far: [window_, frame],         near: [rug, potPlant, floorLamp] },
};

// ---- 소품 배치 캐시 (rapport는 매 프레임 적용하므로 캐시 키에서 제외) ----
function rngFrom(seed) {
  let a = seed >>> 0;
  return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
let _cacheKey = '';
let _cache = null;
function placements(c1, c2) {
  const key = c1 + '-' + c2;
  if (key === _cacheKey) return _cache;
  const A = SCENES[CHAR_SCENE[c1 % 8]], B = SCENES[CHAR_SCENE[c2 % 8]];
  const rnd = rngFrom((c1 + 1) * 73856093 ^ (c2 + 1) * 19349663);
  const list = [];
  const farPool = [...A.far.map(fn => ({ fn, owner: 0 })), ...B.far.map(fn => ({ fn, owner: 1 }))];
  const nearPool = [...A.near.map(fn => ({ fn, owner: 0 })), ...B.near.map(fn => ({ fn, owner: 1 }))];
  for (let i = 0; i < 6; i++) { const p = farPool[(rnd() * farPool.length) | 0]; list.push({ ...p, layer: 'far', rx: rnd(), ry: rnd(), scale: 2.6 + rnd() * 1.7, phase: rnd() * 6.28 }); }
  const nearCount = 16;
  for (let i = 0; i < nearCount; i++) { const p = nearPool[(rnd() * nearPool.length) | 0]; list.push({ ...p, layer: 'near', order: i, rx: rnd(), ry: rnd(), scale: 1.15 + rnd() * 0.75, phase: rnd() * 6.28 }); }
  // near는 멀리(작게) 있는 것부터 그려 가까운 것이 앞에 오게
  list.sort((p, q) => (p.layer === q.layer ? p.ry - q.ry : (p.layer === 'far' ? -1 : 1)));
  list.nearCount = nearCount;
  _cacheKey = key; _cache = list;
  return list;
}

// ===== 메인 =====
export function drawPairBackground(ctx, W, H, t, p1Index, p2Index, rapport, progress = 1) {
  const A = SCENES[CHAR_SCENE[p1Index % 8]], B = SCENES[CHAR_SCENE[p2Index % 8]];
  const r = Math.max(0, Math.min(1, rapport));
  const gloom = (1 - r) * 0.6;
  const conv = 0.5;                       // 두 팔레트는 늘 절반씩 섞어 '합성된 공간'을 만든다

  const wallTop = desat(mix(A.wallTop, B.wallTop, conv), gloom * 0.5);
  const wallBot = desat(mix(A.wallBot, B.wallBot, conv), gloom * 0.5);
  const floorC = desat(mix(A.floor, B.floor, conv), gloom * 0.5);
  const floorS = desat(mix(A.floorShade, B.floorShade, conv), gloom * 0.5);
  const horizon = H * 0.6;

  // 벽/하늘
  let g = ctx.createLinearGradient(0, 0, 0, horizon);
  g.addColorStop(0, rgb(wallTop)); g.addColorStop(1, rgb(wallBot));
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, horizon);

  // 바닥
  g = ctx.createLinearGradient(0, horizon, 0, H);
  g.addColorStop(0, rgb(floorC)); g.addColorStop(1, rgb(floorS));
  ctx.fillStyle = g; ctx.fillRect(0, horizon, W, H - horizon);

  // 실내면 걸레받이 + 마룻바닥 원근선
  if (A.interior || B.interior) {
    blk(ctx, 0, horizon - 4, W, 4, rgb(mix(floorS, [0, 0, 0], 0.25)));
    ctx.strokeStyle = rgb(floorS, 0.5); ctx.lineWidth = 1;
    for (let i = 1; i <= 6; i++) {
      const fx = i / 7;
      ctx.beginPath();
      ctx.moveTo(lerp(W * 0.5, fx * W, 1), horizon);
      ctx.lineTo(lerp(W * 0.5, fx * W, 2.6), H);
      ctx.stroke();
    }
  } else {
    // 야외: 지평선 안개 띠
    blk(ctx, 0, horizon - 6, W, 8, rgb(mix(wallBot, floorC, 0.5), 0.5));
  }

  // 소품 배치 — far(공간/배경)는 늘 보이고, near(물건)는 대화가 쌓일수록 점점 채워진다
  const list = placements(p1Index, p2Index);
  const nearVisible = Math.ceil(Math.max(0, Math.min(1, progress)) * list.nearCount);
  for (const p of list) {
    if (p.layer === 'near' && p.order >= nearVisible) continue;
    // rapport 낮으면 주인 쪽으로 갈라지고, 높으면 전체로 번져 섞인다
    const sideX = p.owner === 0 ? lerp(0.06, 0.46, p.rx) : lerp(0.54, 0.94, p.rx);
    const fullX = lerp(0.06, 0.94, p.rx);
    const x = lerp(sideX, fullX, r) * W;
    if (p.layer === 'far') {
      const y = lerp(horizon - H * 0.46, horizon - 12, p.ry) + Math.sin(t * 0.4 + p.phase) * 3;
      const drift = (p.fn === cloud || p.fn === garland) ? ((t * 6 * (0.4 + p.rx)) % (W + 160)) - 80 : 0;
      p.fn(ctx, x + drift, y, p.scale, t);
    } else {
      const y = lerp(horizon + 10, H - 16, p.ry);
      const depth = lerp(0.9, 1.6, p.ry);
      p.fn(ctx, x, y, p.scale * depth, t);
    }
  }

  // ===== 조명/분위기 (rapport) =====
  if (r >= 0.5) {
    const warm = (r - 0.5) * 2;
    const wg = ctx.createRadialGradient(W / 2, horizon, H * 0.1, W / 2, horizon, H * 0.9);
    wg.addColorStop(0, rgb([255, 226, 150], 0.22 * warm));
    wg.addColorStop(1, 'rgba(255,210,140,0)');
    ctx.fillStyle = wg; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 26 * warm; i++) {
      const yy = (t * 24 + i * 53) % H;
      const xx = (i * 97 + Math.sin(t + i) * 30) % W;
      ctx.fillStyle = rgb([255, 235, 175], 0.4 * warm * (0.5 + 0.5 * Math.sin(t * 2 + i)));
      ctx.fillRect(xx, H - yy, 2, 2);
    }
  } else {
    // 차갑고 어둑하게
    ctx.fillStyle = rgb([26, 30, 52], gloom * 0.4);
    ctx.fillRect(0, 0, W, H);
  }

  // 전체 비네트 (조화 낮을수록 강함)
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.85);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, `rgba(0,0,0,${0.22 + gloom * 0.5})`);
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
}

// ===========================================================
// 미니멀(비트맵/CRT) 모드 배경 — 선화(line-art) 한 장.
// 화려한 디오라마 대신 지평선 + 단순 격자 + 두 캐릭터 세계의 작은 아이콘만.
// 라이트 톤으로 그리면 CRT의 고대비 녹색 필터가 1비트처럼 만들어준다.
// ===========================================================
const SCENE_ICON = {
  garden: 'flower', deepsea: 'fish', sky: 'cloud', water: 'wave',
  bakery: 'house', sweet: 'lolly', desk: 'book', house: 'house',
};

function drawIcon(ctx, type, cx, by, h) {
  ctx.save();
  ctx.lineWidth = Math.max(2, h * 0.05);
  ctx.lineJoin = 'round';
  switch (type) {
    case 'house':
      ctx.strokeRect(cx - h * 0.4, by - h * 0.6, h * 0.8, h * 0.6);
      ctx.beginPath(); ctx.moveTo(cx - h * 0.5, by - h * 0.6); ctx.lineTo(cx, by - h); ctx.lineTo(cx + h * 0.5, by - h * 0.6); ctx.stroke();
      break;
    case 'flower':
      ctx.beginPath(); ctx.moveTo(cx, by); ctx.lineTo(cx, by - h * 0.55); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, by - h * 0.74, h * 0.22, 0, 6.2832); ctx.stroke();
      break;
    case 'fish':
      ctx.beginPath(); ctx.ellipse(cx - h * 0.05, by - h * 0.4, h * 0.38, h * 0.24, 0, 0, 6.2832); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + h * 0.33, by - h * 0.4); ctx.lineTo(cx + h * 0.55, by - h * 0.6); ctx.lineTo(cx + h * 0.55, by - h * 0.2); ctx.closePath(); ctx.stroke();
      break;
    case 'cloud':
      ctx.beginPath();
      ctx.arc(cx - h * 0.22, by - h * 0.45, h * 0.2, 0, 6.2832);
      ctx.arc(cx + h * 0.06, by - h * 0.58, h * 0.26, 0, 6.2832);
      ctx.arc(cx + h * 0.33, by - h * 0.45, h * 0.18, 0, 6.2832);
      ctx.stroke();
      break;
    case 'wave':
      for (let k = 0; k < 3; k++) {
        const yy = by - h * 0.25 - k * h * 0.18;
        ctx.beginPath(); ctx.moveTo(cx - h * 0.5, yy);
        ctx.quadraticCurveTo(cx - h * 0.25, yy - h * 0.13, cx, yy);
        ctx.quadraticCurveTo(cx + h * 0.25, yy + h * 0.13, cx + h * 0.5, yy);
        ctx.stroke();
      }
      break;
    case 'lolly':
      ctx.beginPath(); ctx.moveTo(cx, by); ctx.lineTo(cx, by - h * 0.5); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, by - h * 0.66, h * 0.22, 0, 6.2832); ctx.stroke();
      break;
    case 'book':
      ctx.strokeRect(cx - h * 0.35, by - h * 0.5, h * 0.7, h * 0.5);
      ctx.beginPath(); ctx.moveTo(cx, by - h * 0.5); ctx.lineTo(cx, by); ctx.stroke();
      break;
    default:
      ctx.strokeRect(cx - h * 0.3, by - h * 0.6, h * 0.6, h * 0.6);
  }
  ctx.restore();
}

export function drawMinimalPairBackground(ctx, W, H, t, p1Index, p2Index, progress = 1) {
  const horizon = Math.round(H * 0.62);
  const fg = '#86c596';

  ctx.fillStyle = '#040804';
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = fg;
  ctx.fillStyle = fg;

  // 지평선
  ctx.fillRect(0, horizon, W, 2);

  // 바닥: 단순 원근 격자(선만)
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 1;
  for (let i = 1; i <= 5; i++) {
    const fx = i / 6;
    ctx.beginPath(); ctx.moveTo(W * 0.5, horizon); ctx.lineTo(fx * W, H); ctx.stroke();
  }
  for (let i = 1; i <= 4; i++) {
    const yy = horizon + (H - horizon) * (i * i / 18);
    ctx.fillRect(0, yy, W, 1);
  }
  ctx.restore();

  // 두 캐릭터 세계의 작은 아이콘 (좌/우)
  const ih = Math.min(130, H * 0.17);
  drawIcon(ctx, SCENE_ICON[CHAR_SCENE[p1Index % 8]], W * 0.27, horizon, ih);
  drawIcon(ctx, SCENE_ICON[CHAR_SCENE[p2Index % 8]], W * 0.73, horizon, ih);

  // 대화가 쌓일수록 바닥에 작은 사각형(아이템)이 늘어난다 — 미니멀하게
  const n = Math.round(Math.max(0, Math.min(1, progress)) * 12);
  ctx.save();
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = 2;
  for (let i = 0; i < n; i++) {
    const x = W * 0.12 + ((i * 137) % Math.floor(W * 0.76));
    const y = horizon + 24 + ((i * 89) % Math.max(20, Math.floor(H - horizon - 48)));
    const sz = 8 + (i % 3) * 5;
    ctx.strokeRect(x, y, sz, sz);
  }
  ctx.restore();
}
