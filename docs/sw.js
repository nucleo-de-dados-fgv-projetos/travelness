/* Service worker do app estático.
   Guarda a casca do app e também o motor de OCR vindo da CDN, para funcionar offline.
   Nada de dados do usuário passa por aqui: os cupons ficam no IndexedDB. */
const CACHE = "travelness-v1.4.6-e8141700";   // casca do app: muda a cada build
// Modelos do PaddleOCR (~31 MB) e worker do pdf.js não mudam entre versões do app: ficam num cache
// próprio, que sobrevive às atualizações. Se trocar os modelos ou a versão do pdf.js, mude o nome.
const ASSETS = "travelness-assets-v1";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg", "./icon-192.png"];
const RUNTIME = [/tesseract/i, /tessdata/i, /jsdelivr\.net/i, /unpkg\.com/i];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((c) => Promise.allSettled(SHELL.map((u) => c.add(new Request(u, { cache: "reload" })))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k !== ASSETS).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // o motor de OCR é grande e imutável: vale guardar na primeira vez que for baixado
  if (RUNTIME.some((re) => re.test(url.href))) {
    e.respondWith(caches.open(ASSETS).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === "opaque") c.put(req, res.clone());
      return res;
    }));
    return;
  }

  if (url.origin !== location.origin) return;

  // Modelos do PaddleOCR e worker do pdf.js: baixados uma vez e guardados no cache que
  // sobrevive às atualizações (ver ASSETS acima).
  if (/pdf\.worker\.mjs|\/models\//.test(url.pathname)) {
    e.respondWith(caches.open(ASSETS).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }

  // O leitor de PDF muda a cada build: acompanha a versão da casca.
  if (/pdf-read\.js/.test(url.pathname)) {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }

  if (req.mode === "navigate") {
    // no-cache: confere com o servidor mesmo dentro dos 10 min de cache do GitHub Pages
    e.respondWith(fetch(req, { cache: "no-cache" }).then((r) => {
      const copy = r.clone();
      caches.open(CACHE).then((c) => c.put("./index.html", copy));
      return r;
    }).catch(() => caches.match("./index.html")));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
