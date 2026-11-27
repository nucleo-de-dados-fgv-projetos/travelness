/* E-mail pelo próprio aparelho — sem servidor SMTP.
   Um site não consegue enviar e-mail sozinho nem anexar arquivo num link mailto:. O que dá
   para fazer, e que cobre o caso "a pessoa só informa o e-mail e envia":
     · celular: menu de compartilhar do sistema, com os anexos e o texto já preenchidos;
     · computador: rascunho .eml (destinatário, assunto, texto e anexos) que o Outlook,
       o Thunderbird e afins abrem pronto para conferir e enviar;
     · qualquer um: baixa os anexos e abre um rascunho mailto: só com o texto.
   O último clique em "Enviar" é sempre da pessoa, no programa de e-mail dela. */

/* ------------------------------------------------------------------ texto */
export const DEFAULT_SUBJECT = "Prestação de contas – {projeto} – {solicitante}";

export const DEFAULT_BODY = [
  "Olá,",
  "",
  "Segue a prestação de contas da viagem do projeto {projeto}{periodo}.",
  "",
  "Motivo da viagem: {motivo}",
  "Centro de custo: {centro_custo}",
  "",
  "Comprovantes: {qtd}",
  "Por categoria: {categorias}",
  "Total das despesas: {total}",
  "Adiantamento recebido: {adiantamento}",
  "Saldo {acerto}: {saldo}",
  "",
  "Anexos: {anexos}",
  "",
  "Nome: {solicitante}",
  "Dados bancários: Banco {banco} · Ag. {agencia} · C/c {conta}",
  "",
  "Atenciosamente,",
  "{solicitante}",
].join("\n");

/** Lista mostrada na tela de ajuste do modelo. */
export const PLACEHOLDERS = [
  "projeto", "motivo", "periodo", "data_inicio", "data_fim", "centro_custo", "qtd", "categorias",
  "total", "adiantamento", "saldo", "acerto", "anexos", "solicitante", "cpf", "email",
  "banco", "agencia", "conta",
];

const brl = (v) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function dataBR(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

function periodo(a, b) {
  const i = dataBR(a), f = dataBR(b);
  if (i && f) return i === f ? ` (em ${i})` : ` (de ${i} a ${f})`;
  if (i) return ` (a partir de ${i})`;
  if (f) return ` (até ${f})`;
  return "";
}

/** Valores que alimentam {marcadores} do modelo, tirados da própria viagem. */
export function valoresDoModelo({ profile = {}, trip = {}, receipts = [], products = { xlsx: true, pdf: true }, catLabels = {} }) {
  const total = receipts.reduce((s, r) => s + (Number(r.valor) || 0), 0);
  const adiant = Number(trip.adiantamento) || 0;
  const saldo = total - adiant;

  const porCat = new Map();
  for (const r of receipts) {
    if (!r.valor) continue;
    const k = r.categoria || "outros";
    porCat.set(k, (porCat.get(k) || 0) + Number(r.valor));
  }
  const categorias = [...porCat.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${catLabels[k] || k} ${brl(v)}`).join(" · ");

  const anexos = [
    products.xlsx && "planilha (Excel)",
    products.pdf && "PDF com os comprovantes",
  ].filter(Boolean).join(" e ");

  return {
    projeto: (trip.projeto || "").trim(),
    motivo: (trip.motivo || "").trim().replace(/\s*\n\s*/g, " "),
    periodo: periodo(trip.data_inicio, trip.data_fim),
    data_inicio: dataBR(trip.data_inicio),
    data_fim: dataBR(trip.data_fim),
    centro_custo: (trip.centro_custo || "").trim(),
    qtd: receipts.length ? String(receipts.length) : "",
    categorias,
    total: receipts.length ? brl(total) : "",
    adiantamento: adiant > 0 ? brl(adiant) : "",
    saldo: receipts.length ? brl(Math.abs(saldo)) : "",
    acerto: saldo < 0 ? "a devolver" : "a reembolsar",
    anexos,
    solicitante: (profile.nome || "").trim(),
    cpf: (profile.cpf || "").trim(),
    email: (profile.email || "").trim(),
    banco: (profile.banco || "").trim(),
    agencia: (profile.agencia || "").trim(),
    conta: (profile.conta || "").trim(),
  };
}

const RE_MARCADOR = /\{([a-z_]+)\}/g;

/** Troca {marcadores}; linha cujos marcadores ficaram todos vazios some (nada de "Motivo: "). */
export function preencher(modelo, valores) {
  const saida = [];
  for (const linha of String(modelo ?? "").split(/\r?\n/)) {
    const chaves = [...linha.matchAll(RE_MARCADOR)].map((m) => m[1]).filter((k) => k in valores);
    if (chaves.length && chaves.every((k) => !valores[k])) continue;
    saida.push(linha.replace(RE_MARCADOR, (t, k) => (k in valores ? valores[k] : t)));
  }
  return saida.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function buildMessage({ template, ...dados }) {
  const v = valoresDoModelo(dados);
  const t = template || {};
  return {
    subject: preencher(t.subject || DEFAULT_SUBJECT, v).replace(/\s+/g, " ").replace(/\s[–-]\s*$/, ""),
    body: preencher(t.body || DEFAULT_BODY, v),
  };
}

/* Modelo salvo só neste navegador: não depende do servidor nem do backend escolhido. */
const KEY = "travelness.email.v1";
export function loadTemplate() {
  try {
    const t = JSON.parse(localStorage.getItem(KEY) || "null");
    if (t && typeof t === "object") return { subject: t.subject || DEFAULT_SUBJECT, body: t.body || DEFAULT_BODY };
  } catch { /* sem armazenamento: usa o padrão */ }
  return { subject: DEFAULT_SUBJECT, body: DEFAULT_BODY };
}
export function saveTemplate(t) {
  try {
    if (!t) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify({ subject: t.subject, body: t.body }));
  } catch { /* ignora */ }
}

/* ------------------------------------------------------------------ endereços */
const RE_EMAIL = /^[^\s@,;<>()]+@[^\s@,;<>()]+\.[^\s@,;<>()]{2,}$/;

export function parseEmails(texto) {
  const valid = [], invalid = [];
  for (const raw of String(texto || "").split(/[,;\s]+/)) {
    const e = raw.trim();
    if (!e) continue;
    (RE_EMAIL.test(e) ? valid : invalid).push(e);
  }
  return { valid: [...new Set(valid)], invalid };
}

/* ------------------------------------------------------------------ .eml */
const CRLF = "\r\n";
const enc = new TextEncoder();

function b64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const wrap76 = (s) => (s.match(/.{1,76}/g) || []).join(CRLF) + CRLF;

/** Cabeçalho com acento: palavras codificadas (RFC 2047), cada uma curta o bastante. */
export function encodeHeader(texto) {
  const t = String(texto).replace(/[\r\n]+/g, " ");
  if (/^[\x20-\x7e]*$/.test(t)) return t;
  const palavras = [];
  let atual = [], bytes = 0;
  for (const ch of t) {
    const n = enc.encode(ch).length;
    if (bytes + n > 42) { palavras.push(atual.join("")); atual = []; bytes = 0; }
    atual.push(ch); bytes += n;
  }
  if (atual.length) palavras.push(atual.join(""));
  return palavras.map((p) => `=?UTF-8?B?${b64(enc.encode(p))}?=`).join(CRLF + " ");
}

const asciiName = (n) => n.replace(/[–—]/g, "-").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");

/** Mensagem MIME completa, marcada como rascunho (X-Unsent) para abrir pronta para editar. */
export async function buildEml({ to, subject, body, files = [] }) {
  const boundary = "----=_Travelness_" + Math.random().toString(16).slice(2) + Date.now().toString(16);
  const head = [
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    "X-Unsent: 1",
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ].join(CRLF) + CRLF + CRLF;

  const partes = [
    `--${boundary}${CRLF}Content-Type: text/plain; charset=UTF-8${CRLF}Content-Transfer-Encoding: base64${CRLF}${CRLF}` +
      wrap76(b64(enc.encode(String(body).replace(/\r?\n/g, CRLF)))),
  ];
  for (const f of files) {
    const dados = new Uint8Array(await f.arrayBuffer());
    const tipo = f.type || "application/octet-stream";
    partes.push(
      `--${boundary}${CRLF}Content-Type: ${tipo}; name="${asciiName(f.name)}"${CRLF}` +
      `Content-Transfer-Encoding: base64${CRLF}` +
      `Content-Disposition: attachment; filename="${asciiName(f.name)}"; filename*=UTF-8''${encodeURIComponent(f.name)}${CRLF}${CRLF}` +
      wrap76(b64(dados)));
  }
  partes.push(`--${boundary}--${CRLF}`);
  return new Blob([head, ...partes], { type: "message/rfc822" });
}

/* ------------------------------------------------------------------ entrega */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export const isMobile = () =>
  typeof navigator !== "undefined" &&
  (navigator.userAgentData?.mobile === true ||
   /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
   (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)); // iPad pedindo site de desktop

/** O Chrome (Android, Windows, Mac), o Edge e o Samsung Internet só deixam compartilhar PDF, CSV,
    TXT, imagem, áudio e vídeo: .xlsx dá "Permission denied". Safari e navegadores do iPhone aceitam. */
export function compartilhaSoTiposSimples() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)) return false;          // iPhone: motor do Safari
  return /Chrome|Chromium|SamsungBrowser|Edg\/|OPR\//.test(ua);
}

const dataBRcsv = (iso) => dataBR(iso) || "";
const csvCelula = (v) => {
  const t = String(v ?? "");
  return /[";\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

/** Planilha simples (CSV com ; e vírgula decimal, que o Excel em português abre direto). */
export function buildCsv({ receipts = [], catLabels = {} }) {
  const num = (v) => (Number(v) || 0).toFixed(2).replace(".", ",");
  const linhas = [["Data", "Estabelecimento", "CNPJ", "Categoria", "Valor (R$)"]];
  let total = 0;
  for (const r of receipts) {
    total += Number(r.valor) || 0;
    linhas.push([dataBRcsv(r.data), r.estabelecimento || "", r.cnpj || "", catLabels[r.categoria] || r.categoria || "", num(r.valor)]);
  }
  linhas.push([], ["Total", "", "", "", num(total)]);
  return "\ufeff" + linhas.map((l) => l.map(csvCelula).join(";")).join("\r\n") + "\r\n";
}

export function canShareFiles(files) {
  try { return !!(files?.length && navigator.canShare?.({ files })); } catch { return false; }
}

const nomeSeguro = (s) => String(s || "viagem").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "viagem";

/** Menu de compartilhar do sistema quando aceita os arquivos (celular, Windows com app de e-mail);
    senão, rascunho .eml. `shareFiles` são os arquivos que o menu aceita (no Chrome, CSV no lugar do xlsx). */
export async function enviarPeloAparelho({ to, subject, body, files, shareFiles, nome }) {
  const paraMenu = shareFiles || files;
  if (canShareFiles(paraMenu)) {
    let copied = false;
    try { await navigator.clipboard.writeText(to); copied = true; } catch { /* sem permissão: segue */ }
    try {
      await navigator.share({ files: paraMenu, title: subject, text: body });
      return { how: "shared", copied };
    } catch (e) {
      if (e?.name === "AbortError") return { how: "cancelled" };
      throw Object.assign(new Error(
        e?.name === "NotAllowedError"
          ? "O navegador recusou os arquivos. Use “Baixar arquivos” ou o rascunho .eml."
          : `Não consegui abrir o menu de compartilhar: ${e?.message || e}`), { cause: e });
    }
  }
  return baixarRascunhoEml({ to, subject, body, files, nome });
}

export async function baixarRascunhoEml({ to, subject, body, files, nome }) {
  const eml = await buildEml({ to, subject, body, files });
  downloadBlob(eml, `Rascunho - ${nomeSeguro(nome)}.eml`);
  return { how: "eml" };
}

/** Plano B (Gmail na web, etc.): baixa os anexos e abre um rascunho só com o texto. */
export async function abrirRascunho({ to, subject, body, files }) {
  for (const f of files || []) {
    downloadBlob(f, f.name);
    await new Promise((r) => setTimeout(r, 400)); // navegadores barram downloads simultâneos
  }
  const corpo = body.length > 1800 ? body.slice(0, 1800) + "…" : body; // limite prático do mailto:
  location.href = `mailto:${encodeURIComponent(to).replace(/%2C/gi, ",").replace(/%40/g, "@")}` +
    `?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(corpo)}`;
  return { how: "mailto", truncated: body.length > 1800 };
}
