// 미지의 언어 체계 — 캐릭터마다 "다른 언어"를 쓴다.
// 입력한 각 글자를 코드포인트 기반으로, 그 캐릭터의 알파벳 안에서 결정론적으로 매핑한다.
// → 같은 캐릭터·같은 키는 언제나 같은 기호. 캐릭터가 다르면 기호 체계 자체가 다르다.

// 캐릭터별 알파벳(기호 체계). sprites.js의 CHARACTERS 순서와 1:1.
//  0 핑크토마토 · 1 심해어 · 2 새 · 3 우파루파
//  4 소금빵 · 5 쿠키 · 6 지우개 · 7 생쥐
const SYSTEMS = [
  // 0 핑크토마토 — 룬 문자(우아한 선)
  ['ᚠ','ᚢ','ᚦ','ᚨ','ᚱ','ᚲ','ᚷ','ᚹ','ᚺ','ᚾ','ᛁ','ᛃ','ᛈ','ᛇ','ᛉ','ᛊ','ᛏ','ᛒ','ᛖ','ᛗ','ᛚ','ᛜ','ᛟ','ᛞ'],
  // 1 심해어 — 점자(빽빽하고 어두운 심해의 질감)
  ['⠿','⡿','⣟','⣯','⣷','⣾','⣽','⣻','⢿','⣄','⣆','⣇','⣰','⣸','⣙','⣚','⣉','⣁','⡇','⢸','⣏','⣝','⣗','⣖'],
  // 2 새 — 갈매기·깃털 같은 가벼운 획
  ['✦','✧','✶','✴','⋆','˄','˅','ʌ','˜','≺','≻','⌃','⌄','⟁','⟑','⌁','ᨈ','ᨆ','ᨇ','ᨋ','ᨔ','ᨕ','⟓','⟔'],
  // 3 우파루파 — 동글동글 거품
  ['◌','○','◍','◎','●','◯','⊙','⊚','⊛','⦾','⦿','◴','◵','◶','◷','◉','⊜','⊝','❍','⭘','⬤','⊘','⊗','⊖'],
  // 4 소금빵 — 옅은 점·알갱이(그레뉼러)
  ['⠁','⠂','⠄','⠆','⠇','⠋','⠉','⠈','⠐','⠠','⡀','⢀','⠰','⠘','⠌','⠡','⠢','⠔','⠒','⠦','⠶','⠷','⠾','⠽'],
  // 5 쿠키 — 네모·격자 블록(단단한 과자)
  ['▢','▣','▤','▥','▦','▧','▨','▩','◧','◨','◩','◪','⬓','⬒','⬔','⬕','▰','▱','◰','◱','◲','◳','⊞','⊟'],
  // 6 지우개 — 박스 드로잉(기계적·직선적)
  ['─','│','┌','┐','└','┘','├','┤','┬','┴','┼','╴','╵','╶','╷','╫','╪','═','║','╔','╗','╚','╝','╬'],
  // 7 생쥐 — 작은 점·찍찍 자국
  ['˙','·','ʼ','ˌ','ˏ','ˎ','˜','ⁿ','‧','⁘','⁙','⁚','∴','∵','⁖','⸬','⸫','⸭','꙳','﹒','﹕','﹖','◦','‥'],
];
const DEFAULT_SYS = 0;

function pickSystem(sysId) {
  if (sysId == null) return SYSTEMS[DEFAULT_SYS];
  const i = ((sysId % SYSTEMS.length) + SYSTEMS.length) % SYSTEMS.length;
  return SYSTEMS[i];
}

// 코드포인트를 잘 섞기 위한 간단한 정수 해시
function hash(n) {
  n = ((n >> 16) ^ n) * 0x45d9f3b;
  n = ((n >> 16) ^ n) * 0x45d9f3b;
  n = (n >> 16) ^ n;
  return n < 0 ? -n : n;
}

// 한 글자 → 그 캐릭터 알파벳의 기호 문자열. 한글 음절처럼 복잡한 글자는 2기호로 더 빽빽하게.
export function glyphForChar(ch, sysId) {
  if (ch === ' ') return '  ';
  if (ch === '\n') return ' ';   // 줄바꿈도 그냥 공백으로(연속 흐름 유지)
  const A = pickSystem(sysId);
  const code = ch.codePointAt(0);
  // 시스템마다 해시 시드를 달리해 같은 글자도 캐릭터별로 다른 기호가 되게 한다
  const h = hash(code * 131 + (sysId || 0) * 977 + 7);
  const isHangul = code >= 0xac00 && code <= 0xd7a3;
  const count = isHangul ? 2 : 1;
  let out = '';
  let seed = h;
  for (let i = 0; i < count; i++) {
    out += A[seed % A.length];
    seed = hash(seed + 1);
  }
  return out;
}

// 임의의 정수(음표 속성 등) → 기호 하나. 악보의 음표 머리로 쓴다.
// sysId를 주면 그 캐릭터 체계에서 고른다.
export function glyphForCode(n, sysId) {
  const A = pickSystem(sysId);
  const h = hash(Math.floor(Math.abs(n)) + 1 + (sysId || 0) * 977);
  return A[h % A.length];
}

// 문자열 전체를 그 캐릭터의 미지 언어로 변환
export function toAlien(text, sysId) {
  let out = '';
  for (const ch of text) out += glyphForChar(ch, sysId);
  return out;
}

// 캐릭터 언어 개수
export function systemCount() { return SYSTEMS.length; }

// 음성용: 글자 → 0..1 음높이 (코드포인트 기반). 합성 피치 매핑에 사용.
export function pitchForChar(ch) {
  const code = ch.codePointAt(0) || 65;
  return (hash(code) % 1000) / 1000;
}
