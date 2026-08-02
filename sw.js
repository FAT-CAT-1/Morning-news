/* アプリシェル（HTML/JS/アイコン一式）をキャッシュしてオフライン動作させる */
const CACHE = "summer-dia-v6";

/* 夏休みダイヤ本体（アプリシェル）。中身が変わらないのでキャッシュ優先でよい。 */
const SHELL = [
  "./", "./index.html", "./manifest.webmanifest",
  "./icon.svg", "./icon-180.png", "./icon-192.png", "./icon-512.png"
];

/* 朝ニュース。単体でインストールできるよう、専用のmanifestとアイコンを持つ。 */
const NEWS = [
  "./news/", "./news/index.html", "./news/manifest.webmanifest",
  "./news/icon.svg", "./news/icon-180.png", "./news/icon-192.png", "./news/icon-512.png"
];

const FILES = SHELL.concat(NEWS);

/*
 * ネットワーク優先にするのは /news/ の「ページ」だけ。中身が毎朝変わるため。
 * 同じ /news/ でもアイコンとmanifestは変わらないので、キャッシュ優先のままにする。
 */
function isNewsPage(url) {
  const p = new URL(url).pathname;
  return p.includes("/news/") && (p.endsWith("/") || p.endsWith(".html"));
}

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c =>
      // addAll は1つでも404だと全部失敗する。初回ビルド前でもインストールを通したいので
      // 1ファイルずつ入れて、取れなかったものは黙って飛ばす。
      Promise.all(FILES.map(f => c.add(f).catch(() => {})))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const req = e.request;
  if (new URL(req.url).origin !== self.location.origin) return;

  if (isNewsPage(req.url)) {
    /* ネットワーク優先。取れたら保存し、圏外なら最後に取れた号を返す。 */
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() =>
        caches.match(req).then(r => r || caches.match("./news/index.html"))
      )
    );
    return;
  }

  /* アプリシェルはキャッシュ優先のまま。 */
  e.respondWith(
    caches.match(req).then(r => r || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match("./index.html")))
  );
});
