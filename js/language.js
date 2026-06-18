// 모두 미지의 언어.
// 캐릭터마다 "다른 언어"를 쓴다 — 각자의 기호 체계(sysId = 캐릭터 인덱스)로 변환.
// 이해도(comprehension) 개념은 더 이상 없다. 누가 말하든 늘 그 캐릭터의 기호로 보인다.

import { toAlien } from './glyphs.js';

// 표시용 문자열: 화자의 기호 체계로 전부 변환.
// sysId = 화자 캐릭터 인덱스(glyphs.js의 SYSTEMS와 1:1).
export function renderDisplay(text, sysId) {
  return toAlien(text, sysId);
}

// 읽기 모드 — 언제나 미지의 언어(포먼트 보이스).
export function speakMode() {
  return 'alien';
}

// 항상 외계어 룩(자간 넓힘).
export function isAlienLook() {
  return 'full';
}

// 입력바 모드 태그.
export function modeTag() {
  return '◈ ???';
}

// (호환용) 한국어 섞임 추정 — 더 이상 TTS 분기엔 안 쓰지만 남겨둔다.
export function guessLang(text) {
  return /[가-힣]/.test(text) ? 'ko-KR' : 'en-US';
}
