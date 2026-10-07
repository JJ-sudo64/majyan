/*
 * ホーム画面に追加して遊ぶ時（PWA）のサービスワーカー。
 *
 * - 画面本体（HTML）は常にサーバーへ取りに行き、つながらない時だけ前回の分を出す
 *   （更新したのに古い画面のまま、を起こさないため）。
 * - Viteがハッシュ付きの名前を付ける /assets/ は中身が変わらないので、一度取ったら使い回す。
 * - 画像・音（/avatars/ /voices/ 等）は手元の分をすぐ出しつつ、裏で新しいものを取り直す。
 * - /api/ と /ws は対局・アカウントの通信なので一切触らない。
 *
 * 中身の扱いを変えた時はCACHE_VERSIONを上げる（古いキャッシュは消える）。
 */
const CACHE_VERSION = "v1";
const PAGES = `majyan-pages-${CACHE_VERSION}`;
const ASSETS = `majyan-assets-${CACHE_VERSION}`;
const MEDIA = `majyan-media-${CACHE_VERSION}`;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  const keep = new Set([PAGES, ASSETS, MEDIA]);
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n.startsWith("majyan-") && !keep.has(n)).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname === "/ws" || url.pathname === "/healthz") return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(PAGES).then((c) => c.put("/", copy));
          return res;
        })
        .catch(() => caches.match("/").then((cached) => cached || Response.error())),
    );
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.open(ASSETS).then((cache) =>
        cache.match(request).then(
          (cached) =>
            cached ||
            fetch(request).then((res) => {
              if (res.ok) cache.put(request, res.clone());
              return res;
            }),
        ),
      ),
    );
    return;
  }

  // 音声は範囲指定（Range）で取りに来ることがあり、部分的な返事はキャッシュできないので素通しにする。
  if (request.headers.has("range")) return;
  event.respondWith(
    caches.open(MEDIA).then((cache) =>
      cache.match(request).then((cached) => {
        const fresh = fetch(request)
          .then((res) => {
            if (res.ok && res.status === 200) cache.put(request, res.clone());
            return res;
          })
          .catch(() => cached || Response.error());
        return cached || fresh;
      }),
    ),
  );
});
