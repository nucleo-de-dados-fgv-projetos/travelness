/* Service worker do app estático.
   Guarda a casca do app e também o motor de OCR vindo da CDN, para funcionar offline.
   Nada de dados do usuário passa por aqui: os cupons ficam no IndexedDB. */
const CACHE = "travelness-v1.4.1";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg", "./icon-192.png"];
const RUNTIME = [/tesseract/i, /tessdata/i, /jsdelivr\.net/i, /unpkg\.com/i];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // o motor de OCR é grande e imutável: vale guardar na primeira vez que for baixado
  if (RUNTIME.some((re) => re.test(url.href))) {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === "opaque") c.put(req, res.clone());
      return res;
    }));
    return;
  }

  if (url.origin !== location.origin) return;

  // O leitor de PDF e seu worker chegam depois do primeiro acesso: guarda na
  // primeira vez que forem buscados, senão o app perde a leitura de PDF offline.
  // idem para os modelos do PaddleOCR (~31 MB): baixados uma vez, servidos do cache
  if (/pdf-read\.js|pdf\.worker\.mjs|\/models\//.test(url.pathname)) {
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
    e.respondWith(fetch(req).then((r) => {
      const copy = r.clone();
      caches.open(CACHE).then((c) => c.put("./index.html", copy));
      return r;
    }).catch(() => caches.match("./index.html")));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
