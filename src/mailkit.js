/* Texto do compartilhamento (assunto e mensagem montados a partir da viagem) e a planilha em CSV
   que o menu de compartilhar do Chrome aceita (ele recusa .xlsx). Tudo roda no aparelho. */

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

/* Modelo salvo antes (versões 1.4.x) neste navegador: ainda vale para o texto do compartilhamento. */
const KEY = "travelness.email.v1";
export function loadTemplate() {
  try {
    const t = JSON.parse(localStorage.getItem(KEY) || "null");
    if (t && typeof t === "object") return { subject: t.subject || DEFAULT_SUBJECT, body: t.body || DEFAULT_BODY };
  } catch { /* sem armazenamento: usa o padrão */ }
  return { subject: DEFAULT_SUBJECT, body: DEFAULT_BODY };
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
