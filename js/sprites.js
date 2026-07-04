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
// 음식·사물은 몸 없이 형태 그대로 + 얼굴, 동물은 실제 그 동물의 몸 형태.
const MINI_DRAW = [
  // 0 핑크토마토 — 열매 그대로(몸 없음) + 줄기/잎
  (g, t, talking, mood) => {
    g.ringDisc(16, 18, 9, 2, INK);
    g.seg(16, 9, 16, 4, INK);
    g.seg(16, 6, 12, 3, INK); g.seg(16, 6, 20, 3, INK);
    slimFace(g, 16, 17, 21, mood, talking);
  },
  // 1 심해어 — 가로로 긴 물고기 몸 + 지느러미 + 발광체
  (g, t, talking, mood) => {
    const glow = 0.5 + 0.5 * Math.sin(t * 3);
    g.ringEllipse(15, 17, 11, 6, 2, INK);
    g.seg(26, 14, 30, 11, INK); g.seg(26, 20, 30, 23, INK); g.seg(30, 11, 30, 23, INK); // 꼬리
    g.seg(12, 11, 16, 8, INK); g.seg(16, 8, 19, 11, INK);   // 등지느러미
    g.seg(13, 23, 16, 26, INK); g.seg(16, 26, 19, 23, INK); // 배지느러미
    g.seg(8, 12, 5, 6, INK); g.ringDisc(5, 5, 2, 1, `rgba(205,235,212,${0.55 + glow * 0.45})`); // 발광체
    g.px(10, 16, INK);                                       // 눈
    g.seg(4, 19, 11, 19, INK);
    if (talking) g.seg(4, 20, 11, 20, INK);
  },
  // 2 새 — 옆모습 새 몸통 + 머리 + 부리 + 날개 + 꼬리 + 가는 다리
  (g, t, talking, mood) => {
    g.ringEllipse(16, 18, 8, 6, 2, INK);                     // 몸통
    g.ringDisc(10, 10, 4, 2, INK);                           // 머리
    g.seg(6, 9, 2, 10, INK); g.seg(6, 12, 2, 10, INK); g.seg(6, 9, 6, 12, INK); // 부리
    if (talking) g.seg(3, 10, 5, 11, INK);
    g.px(9, 9, INK);                                         // 눈
    g.seg(24, 15, 30, 13, INK); g.seg(24, 21, 30, 23, INK); g.seg(30, 13, 30, 23, INK); // 꼬리
    g.seg(15, 15, 20, 18, INK); g.seg(20, 18, 15, 20, INK);  // 날개
    g.seg(14, 24, 14, 28, INK); g.seg(12, 29, 16, 29, INK);  // 다리
    g.seg(19, 24, 19, 28, INK); g.seg(17, 29, 21, 29, INK);
  },
  // 3 생쥐 — 둥근 쥐 몸 + 큰 귀 + 수염 + 긴 꼬리 + 작은 발
  (g, t, talking, mood) => {
    const tail = Math.round(Math.sin(t * 3) * 2);
    g.ringDisc(15, 17, 8, 2, INK);                           // 몸
    g.ringDisc(9, 8, 3, 1, INK); g.ringDisc(19, 8, 3, 1, INK); // 귀
    g.px(12, 15, INK); g.px(18, 15, INK);                    // 눈
    g.px(15, 19, INK);                                       // 코
    g.seg(8, 19, 3, 18, INK); g.seg(22, 19, 27, 18, INK);    // 수염
    g.seg(22, 21, 28, 19 + tail, INK); g.seg(28, 19 + tail, 30, 23 + tail, INK); // 꼬리
    g.seg(12, 24, 12, 27, INK); g.seg(18, 24, 18, 27, INK);  // 발
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
