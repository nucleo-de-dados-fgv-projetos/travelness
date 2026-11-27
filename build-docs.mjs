/* Monta docs/index.html: um único arquivo com CSS e JS embutidos.
   Tudo em caminhos relativos, porque o GitHub Pages serve o app em /Travelness/. */
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from "fs";
import { createHash } from "crypto";

const css = readFileSync("static/style.css", "utf8");
const js = readFileSync(".build-web.js", "utf8");
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
// Muda a cada build (mesmo sem trocar a versão): o sw.js passa a ter bytes novos e o navegador
// detecta a atualização sozinho.
const build = createHash("sha1").update(js).update(css).digest("hex").slice(0, 8);

mkdirSync("docs", { recursive: true });
for (const f of ["icon.svg", "icon-180.png", "icon-192.png", "icon-512.png"]) {
  copyFileSync(`static/${f}`, `docs/${f}`);
}

const manifest = {
  name: "Travelness · Prestação de contas",
  short_name: "Travelness",
  description: "Fotografe cupons fiscais e gere a planilha e o PDF da prestação de contas da viagem.",
  start_url: "./",
  scope: "./",
  display: "standalone",
  orientation: "portrait",
  background_color: "#f4f6fa",
  theme_color: "#1f3a5f",
  lang: "pt-BR",
  icons: [
    { src: "./icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    { src: "./icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "./icon-512.png", sizes: "512x512", type: "image/png" },
    { src: "./icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
};
writeFileSync("docs/manifest.webmanifest", JSON.stringify(manifest, null, 2));

const sw = `/* Service worker do app estático.
   Guarda a casca do app e também o motor de OCR vindo da CDN, para funcionar offline.
   Nada de dados do usuário passa por aqui: os cupons ficam no IndexedDB. */
const CACHE = "travelness-v${version}-${build}";   // casca do app: muda a cada build
// Modelos do PaddleOCR (~31 MB) e worker do pdf.js não mudam entre versões do app: ficam num cache
// próprio, que sobrevive às atualizações. Se trocar os modelos ou a versão do pdf.js, mude o nome.
const ASSETS = "travelness-assets-v1";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg", "./icon-192.png"];
const RUNTIME = [/tesseract/i, /tessdata/i, /jsdelivr\\.net/i, /unpkg\\.com/i];

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
  if (/pdf\\.worker\\.mjs|\\/models\\//.test(url.pathname)) {
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
  if (/pdf-read\\.js/.test(url.pathname)) {
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
`;
writeFileSync("docs/sw.js", sw);

// O GitHub Pages usa Jekyll por padrão e ignora arquivos iniciados por "_".
writeFileSync("docs/.nojekyll", "");

const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#1f3a5f" media="(prefers-color-scheme: dark)" />
<meta name="theme-color" content="#f4f6fa" media="(prefers-color-scheme: light)" />
<meta name="description" content="Fotografe cupons fiscais e gere a planilha e o PDF da prestação de contas da viagem. Funciona offline, os dados ficam no seu aparelho." />
<meta name="app-version" content="${version}" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="default" />
<meta name="apple-mobile-web-app-title" content="Travelness" />
<title>Travelness · Prestação de contas</title>
<link rel="manifest" href="./manifest.webmanifest" />
<link rel="icon" href="./icon.svg" type="image/svg+xml" />
<link rel="apple-touch-icon" href="./icon-180.png" />
<style>
${css}
</style>
</head>
<body>
<div id="root">
  <div class="app">
    <div class="topbar"><div style="flex:1"><h1>Travelness<span class="sub">Prestação de contas de viagens</span></h1></div></div>
    <div class="empty"><h3>Abrindo…</h3><p>Carregando seus dados deste aparelho.</p></div>
  </div>
</div>
<noscript><p style="padding:24px;text-align:center">O Travelness precisa de JavaScript ativado.</p></noscript>
<script type="module">
${js}
</script>
</body>
</html>
`;
writeFileSync("docs/index.html", html);
console.log(`  docs/index.html  ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB`);
