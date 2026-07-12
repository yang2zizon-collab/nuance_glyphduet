// 서비스 워커 — 터널 사망(Cloudflare 1033) 대책.
// 페이지를 한 번이라도 연 폰은 이 워커가 심어져서, 죽은 주소에서 새로고침해도
// Cloudflare 에러 대신 캐시된 recover.html이 뜨고, 거기서 GitHub의 최신 터널
// 주소를 읽어 스스로 갈아탄다. 일반 요청(폴링·SSE)은 건드리지 않는다.
const CACHE = 'nuance-recover-v2';   // recover.html 갱신 시 버전을 올려 재설치 유발
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/recover.html'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(Promise.all([
    self.clients.claim(),
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  ]));
});
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;   // 문서 이동/새로고침만 보호
  e.respondWith(
    fetch(e.request)
      .then((r) => (r.status >= 500 ? caches.match('/recover.html').then((c) => c || r) : r))
      .catch(() => caches.match('/recover.html').then((c) => c || Response.error()))
  );
});
