// 픽셀 캐릭터 — 32x32 가상 그리드에 블록 단위로 그린다.
// 각 캐릭터는 draw(g, t, talking) 함수. g는 픽셀 헬퍼, t는 시간(초), talking은 말하는 중 여부.

const GRID = 32;

// 가상 그리드를 실제 캔버스에 그리는 헬퍼 묶음을 만든다.
function makePixelPen(ctx, originX, originY, cell) {
  const px = (gx, gy, col) => {
    if (!col) return;
    ctx.fillStyle = col;
    ctx.fillRect(originX + gx * cell, originY + gy * cell, cell, cell);
  };
  const rect = (gx, gy, w, h, col) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(gx + x, gy + y, col);
  };
  // 채워진 픽셀 원
  const disc = (cx, cy, r, col) => {
    const r2 = r * r;
    for (let y = -r; y <= r; y++)
      for (let x = -r; x <= r; x++)
        if (x * x + y * y <= r2) px(Math.round(cx + x), Math.round(cy + y), col);
  };
  // 타원
  const ellipse = (cx, cy, rx, ry, col) => {
    for (let y = -ry; y <= ry; y++)
      for (let x = -rx; x <= rx; x++)
        if ((x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1)
          px(Math.round(cx + x), Math.round(cy + y), col);
  };
  // ── 라인아트(외곽선) 도구 ──
  // 원 외곽선(두께 lw)
  const ringDisc = (cx, cy, r, lw, col) => {
    const ro = r * r, ri = Math.max(0, r - lw) * Math.max(0, r - lw);
    for (let y = -r; y <= r; y++)
      for (let x = -r; x <= r; x++) {
        const d = x * x + y * y;
        if (d <= ro && d >= ri) px(Math.round(cx + x), Math.round(cy + y), col);
      }
  };
  // 타원 외곽선(두께 lw)
  const ringEllipse = (cx, cy, rx, ry, lw, col) => {
    const ix = Math.max(1, rx - lw), iy = Math.max(1, ry - lw);
    for (let y = -ry; y <= ry; y++)
      for (let x = -rx; x <= rx; x++) {
        const o = (x * x) / (rx * rx) + (y * y) / (ry * ry);
        const inn = (x * x) / (ix * ix) + (y * y) / (iy * iy);
        if (o <= 1 && inn >= 1) px(Math.round(cx + x), Math.round(cy + y), col);
      }
  };
  // 사각 외곽선(두께 lw)
  const strokeRect = (gx, gy, w, h, lw, col) => {
    rect(gx, gy, w, lw, col); rect(gx, gy + h - lw, w, lw, col);
    rect(gx, gy, lw, h, col); rect(gx + w - lw, gy, lw, h, col);
  };
  // 선분 (Bresenham)
  const seg = (x0, y0, x1, y1, col) => {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      px(x0, y0, col);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  };
  return { px, rect, disc, ellipse, ringDisc, ringEllipse, strokeRect, seg };
}

// 눈/입 같은 공통 표정 (대부분 캐릭터가 재사용)
function face(g, cx, eyeY, mouthY, opt = {}) {
  const eye = opt.eye || '#1a1a1a';
  const blink = opt.blink;
  const gap = opt.gap ?? 4;
  if (blink) {
    g.rect(cx - gap - 1, eyeY, 2, 1, eye);
    g.rect(cx + gap, eyeY, 2, 1, eye);
  } else {
    g.rect(cx - gap - 1, eyeY - 1, 2, 2, eye);
    g.rect(cx + gap, eyeY - 1, 2, 2, eye);
    if (opt.shine !== false) {
      g.px(cx - gap, eyeY - 1, '#fff');
      g.px(cx + gap + 1, eyeY - 1, '#fff');
    }
  }
  // 입 (mood: happy=웃음 / sad=시무룩 / 그 외=일자)
  const m = opt.mouth || '#7a1f2b';
  if (opt.talking) {
    g.ellipse(cx, mouthY + 1, 2, 2, m);
  } else if (opt.mood === 'happy') {
    g.px(cx - 2, mouthY, m); g.px(cx - 1, mouthY + 1, m);
    g.px(cx, mouthY + 1, m); g.px(cx + 1, mouthY, m);
  } else if (opt.mood === 'sad') {
    g.px(cx - 2, mouthY + 1, m); g.px(cx - 1, mouthY, m);
    g.px(cx, mouthY, m); g.px(cx + 1, mouthY + 1, m);
  } else {
    g.rect(cx - 2, mouthY, 4, 1, m);
  }
}

// ===== 미니멀(라인아트) 모드 =====
// 아이 게임 같은 블롭/볼터치/큰 눈을 버리고, 얇은 외곽선 + 차분한 슬림 아이로
// 그리는 모노크롬 라인아트. "디자인된 아이콘"에 가까운 어른스러운 톤.
// 단색 ink 하나로 통일 — CRT 녹색 필터에서 밝은 선으로 떠오른다.
let MINI = false;
export function setMinimal(v) { MINI = !!v; }

const INK = '#cdebd4';

// 슬림 얼굴: 작은 머리에 점 눈 + 1~2px 입선만. 이목구비를 최소화해 절제된 인상.
function slimFace(g, cx, eyeY, mouthY, mood, talking) {
  g.px(cx - 2, eyeY, INK);
  g.px(cx + 1, eyeY, INK);
  if (talking) g.rect(cx - 1, mouthY, 2, 1, INK);
  else if (mood === 'happy') { g.px(cx - 2, mouthY, INK); g.px(cx - 1, mouthY + 1, INK); g.px(cx, mouthY + 1, INK); g.px(cx + 1, mouthY, INK); }
  else if (mood === 'sad') { g.px(cx - 2, mouthY + 1, INK); g.px(cx - 1, mouthY, INK); g.px(cx, mouthY, INK); g.px(cx + 1, mouthY + 1, INK); }
  else g.rect(cx, mouthY, 1, 1, INK);
}

// 인덱스 순서는 CHARACTERS와 동일.
// 스케치 레퍼런스 기반 실루엣 — 몸은 검정 통짜, 디테일(눈·꼭지·이빨)은 흰색으로 비운다.
// (silhouetteFill이 흰 픽셀을 보존한다 — 검정은 캐릭터 색으로 칠해질 수 있다)
const K = '#000';
const W = '#fff';

// 흰 별(꼭지) — 8방향 반짝 별
function starW(g, cx, cy) {
  g.seg(cx, cy - 3, cx, cy + 3, W);
  g.seg(cx - 3, cy, cx + 3, cy, W);
  g.seg(cx - 2, cy - 2, cx + 2, cy + 2, W);
  g.seg(cx - 2, cy + 2, cx + 2, cy - 2, W);
  g.px(cx, cy, W);
}

const MINI_DRAW = [
  // 0 핑크토마토 — 매끈한 토마토(위 가운데 옴폭 + 은은한 굴곡), 흰 별 꼭지 + 큰 흰 눈·세모 입
  (g, t, talking, mood) => {
    // 몸 — 위 두 봉긋(가운데 옴폭), 본체는 매끈한 타원, 옆·아래는 아주 은은한 굴곡만
    g.disc(12, 12, 6, K); g.disc(20, 12, 6, K);
    g.ellipse(16, 18, 11, 8, K);
    g.ellipse(16, 21, 10, 6, K);
    // 흰 별 꼭지 — 위 옴폭 한가운데
    starW(g, 16, 11);
    // 크고 동그란 흰 눈(깜박) + 세모 입
    const blink = (Math.floor(t * 1.3) % 7) === 0;
    if (blink) { g.rect(10, 18, 3, 1, W); g.rect(19, 18, 3, 1, W); }
    else { g.disc(11, 18, 1.5, W); g.disc(20, 18, 1.5, W); }
    if (talking) g.ellipse(16, 23, 2, 2, W);
    else if (mood === 'sad') { g.px(14, 24, W); g.px(15, 23, W); g.px(16, 23, W); g.px(17, 24, W); }
    else { g.rect(15, 22, 3, 1, W); g.px(16, 23, W); }   // 아래로 뾰족한 세모 입
  },
  // 1 심해어(아귀) — 큰 머리·벌린 입에 삐죽 이빨, 더듬이 발광체, 눈만 희게
  (g, t, talking, mood) => {
    // 몸 — 앞(왼쪽) 크고 뒤로 갈수록 좁아진다
    g.ellipse(18, 18, 11, 8, K);
    g.disc(11, 16, 8, K);
    // 꼬리
    g.seg(29, 14, 31, 11, K); g.seg(29, 22, 31, 25, K); g.seg(31, 11, 31, 25, K);
    g.ellipse(30, 18, 1, 5, K);
    // 더듬이 + 발광체(깜박)
    g.seg(11, 8, 8, 5, K); g.seg(8, 5, 6, 5, K);
    g.disc(5, 4, 2, K);
    if (Math.sin(t * 3) > 0) g.px(5, 4, W);
    // 벌린 입 — 흰 쐐기 + 검정 삐죽 이빨
    const open = talking ? 1 : 0;
    g.ellipse(8, 21 + open, 6, 4 + open, W);
    g.px(5, 19, K); g.px(7, 20, K); g.px(9, 19, K); g.px(11, 20, K);   // 윗니
    g.px(6, 24 + open, K); g.px(9, 24 + open, K);                       // 아랫니
    // 흰 눈(하트 느낌 — 위 두 점 + 아래 한 점)
    g.px(14, 12, W); g.px(16, 12, W);
    g.rect(14, 13, 3, 2, W);
    g.px(15, 15, W);
  },
  // 2 새 — 서 있는 옆모습, 위로 든 부리(지저귐), 눈만 희게
  (g, t, talking, mood) => {
    const hop = Math.abs(Math.sin(t * 2.2)) * 1;
    // 몸(가슴 불룩) + 머리(위로 살짝 든)
    g.ellipse(17, 19 - hop * 0.3, 8, 6, K);
    g.disc(11, 11, 5, K);
    // 부리 — 위로 벌린 두 갈래
    g.seg(7, 8, 3, 5, K); g.seg(7, 10, 4, 9, K);
    if (talking) g.seg(6, 9, 3, 7, K);
    // 꼬리(뒤로 뾰족)
    g.seg(24, 17, 29, 14, K); g.seg(24, 20, 29, 19, K); g.seg(29, 14, 29, 19, K);
    g.ellipse(25, 18, 2, 3, K);
    // 다리 + 발
    g.seg(14, 25, 14, 29, K); g.seg(12, 29, 16, 29, K);
    g.seg(19, 25, 19, 29, K); g.seg(17, 29, 21, 29, K);
    // 흰 눈
    g.rect(10, 10, 2, 2, W);
  },
  // 3 생쥐 — 큰 귀 + 뾰족 코 + 길게 휘어지는 꼬리, 눈만 희게
  (g, t, talking, mood) => {
    const tail = Math.round(Math.sin(t * 2.5) * 2);
    // 큰 귀(앞) + 작은 귀(뒤)
    g.disc(11, 9, 5, K);
    g.disc(17, 8, 3, K);
    // 머리(왼쪽 뾰족 코) + 몸
    g.ellipse(11, 16, 7, 5, K);
    g.seg(4, 16, 2, 17, K); g.px(3, 17, K);
    g.ellipse(19, 19, 9, 6, K);
    // 길게 휘어지는 꼬리 — 몸 뒤에서 크게 스윽
    g.seg(27, 21, 30, 17 + tail, K);
    g.seg(30, 17 + tail, 31, 22 + tail, K);
    g.seg(31, 22 + tail, 27, 26 + tail, K);
    // 발
    g.seg(14, 24, 14, 27, K); g.seg(21, 24, 21, 27, K);
    // 흰 눈
    g.rect(8, 14, 2, 2, W);
  },
];

// ===== 캐릭터 정의 =====
const CHARACTERS = [
  {
    id: 'tomato', name: '핑크토마토', color: '#ff5d8f', voice: 0,
    draw(g, t, talking, mood) {
      const blink = (Math.floor(t * 1.3) % 7) === 0;
      // 잎
      g.rect(15, 2, 2, 4, '#3a8f3a');
      g.disc(11, 5, 2, '#5fbf5f'); g.disc(20, 5, 2, '#5fbf5f'); g.disc(16, 4, 2, '#5fbf5f');
      // 몸통
      g.disc(16, 19, 11, '#b3303c');
      g.disc(16, 19, 10, '#ff5d8f');
      g.disc(13, 15, 3, '#ff9bbb'); // 하이라이트
      face(g, 16, 18, 23, { gap: 5, talking, mood, mouth: '#8a2233' });
      // 볼터치
      g.px(9, 21, '#ff9bbb'); g.px(10, 21, '#ff9bbb');
      g.px(22, 21, '#ff9bbb'); g.px(23, 21, '#ff9bbb');
      if (blink) face(g, 16, 18, 23, { gap: 5, blink: true });
    }
  },
  {
    id: 'anglerfish', name: '심해어', color: '#3a4fa0', voice: 1,
    draw(g, t, talking, mood) {
      const glow = 0.5 + 0.5 * Math.sin(t * 3);
      // 안테나 + 발광체
      g.rect(16, 2, 1, 4, '#2a3550');
      g.disc(16, 3, 2, `rgba(255,236,120,${0.4 + glow * 0.6})`);
      g.disc(16, 3, 1, '#fff7c2');
      // 몸통
      g.ellipse(15, 19, 11, 8, '#243a5e');
      g.ellipse(15, 19, 10, 7, '#36527e');
      // 꼬리
      g.rect(26, 16, 3, 2, '#243a5e'); g.rect(27, 14, 3, 6, '#243a5e');
      // 큰 눈
      g.disc(11, 16, 3, '#fff'); g.disc(12, 16, 1, '#101820');
      // 이빨난 입
      const my = 22;
      g.rect(6, my, 14, 1, '#0d1622');
      if (talking) g.rect(6, my, 14, 3, '#160c14');
      for (let i = 0; i < 6; i++) g.px(7 + i * 2, my + (talking ? 2 : 1), '#fff');
    }
  },
  {
    id: 'bird', name: '새', color: '#ff9d3b', voice: 2,
    draw(g, t, talking, mood) {
      const blink = (Math.floor(t * 1.1) % 8) === 0;
      g.disc(16, 18, 9, '#3d9be9');   // 몸
      g.disc(16, 18, 8, '#7cc7ff');
      g.disc(16, 12, 6, '#7cc7ff');   // 머리
      g.disc(13, 22, 4, '#bfe4ff');  // 배
      // 부리
      g.rect(7, 12, 4, 2, '#ff9f1c'); g.px(6, 13, '#ff9f1c');
      if (talking) { g.rect(7, 14, 3, 1, '#e07a00'); }
      // 날개
      g.ellipse(22, 19, 3, 5, '#3d9be9');
      // 눈
      if (blink) g.rect(11, 11, 2, 1, '#101820');
      else { g.disc(12, 11, 1, '#101820'); g.px(13, 10, '#fff'); }
      // 다리
      g.rect(14, 27, 1, 2, '#ff9f1c'); g.rect(18, 27, 1, 2, '#ff9f1c');
    }
  },
  {
    id: 'mouse', name: '생쥐', color: '#b9a6e8', voice: 7,
    draw(g, t, talking, mood) {
      const blink = (Math.floor(t * 1.4) % 9) === 0;
      const tail = Math.round(Math.sin(t * 3) * 2);
      // 귀
      g.disc(9, 9, 4, '#9a9ab0'); g.disc(9, 9, 2, '#ffc2d1');
      g.disc(23, 9, 4, '#9a9ab0'); g.disc(23, 9, 2, '#ffc2d1');
      // 머리/몸
      g.disc(16, 18, 9, '#9a9ab0');
      g.disc(16, 18, 8, '#cfcfe0');
      // 코
      g.disc(16, 21, 1, '#ff7aa2');
      // 수염
      g.rect(8, 21, 4, 1, '#7a7a90'); g.rect(20, 21, 4, 1, '#7a7a90');
      // 눈
      if (blink) { g.rect(11, 16, 2, 1, '#101820'); g.rect(19, 16, 2, 1, '#101820'); }
      else {
        g.disc(12, 16, 1, '#101820'); g.disc(20, 16, 1, '#101820');
        g.px(13, 15, '#fff'); g.px(21, 15, '#fff');
      }
      if (talking) g.ellipse(16, 24, 2, 1, '#7a1f2b');
      else if (mood === 'sad') { g.px(14, 24, '#7a1f2b'); g.px(15, 23, '#7a1f2b'); g.px(16, 23, '#7a1f2b'); g.px(17, 24, '#7a1f2b'); }
      else if (mood === 'happy') { g.px(14, 23, '#7a1f2b'); g.px(15, 24, '#7a1f2b'); g.px(16, 24, '#7a1f2b'); g.px(17, 23, '#7a1f2b'); }
      // 꼬리
      g.rect(25, 22 + tail, 5, 1, '#ff9bbb');
    }
  },
];

// 캔버스 정사각 영역에 캐릭터를 그린다. size px, t 시간(초)
export function drawCharacter(ctx, charIndex, x, y, size, t = 0, talking = false, mood = 'neutral') {
  const cell = size / GRID;
  const pen = makePixelPen(ctx, x, y, cell);
  const prev = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  const i = charIndex % CHARACTERS.length;
  if (MINI) MINI_DRAW[i](pen, t, talking, mood);
  else CHARACTERS[i].draw(pen, t, talking, mood);
  ctx.imageSmoothingEnabled = prev;
}

export function characterCount() { return CHARACTERS.length; }
// 캐릭터의 "원래" 소리·글리프 체계 인덱스(목록에서 빠진 캐릭터가 있어도 고유 음색/글자 유지).
export function characterVoice(i) {
  const a = CHARACTERS; const k = ((i % a.length) + a.length) % a.length;
  return a[k].voice != null ? a[k].voice : k;
}
export function characterName(i) { return CHARACTERS[i % CHARACTERS.length].name; }
export function characterColor(i) { return CHARACTERS[i % CHARACTERS.length].color; }
export function characterId(i) { return CHARACTERS[i % CHARACTERS.length].id; }
