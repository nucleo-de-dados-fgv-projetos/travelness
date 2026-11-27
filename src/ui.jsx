/* Interface React, compartilhada pelas duas versões do app.
   O módulo "./backend.js" é trocado em tempo de build (esbuild --alias):
     backend.server.js -> fala com o Flask     backend.local.js -> IndexedDB + OCR no aparelho */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { backend } from "./backend.js";
import { LOGO, LOGO_ALT } from "./logo.js";
import { buildMessage, loadTemplate, buildCsv, canShareFiles, compartilhaSoTiposSimples, downloadBlob } from "./mailkit.js";

/* ------------------------------------------------------------------ util */
const CATS = [
  { id: "alimentacao", label: "Alimentação", icon: "utensils" },
  { id: "combustivel", label: "Combustível", icon: "fuel" },
  { id: "transporte", label: "Transporte", icon: "car" },
  { id: "estacionamento", label: "Estacionamento", icon: "parking" },
  { id: "outros", label: "Outros", icon: "tag" },
];
const CAT_LABEL = Object.fromEntries(CATS.map((c) => [c.id, c.label]));
const brl = (v) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const todayISO = () => new Date().toLocaleDateString("sv-SE");
const IS_LOCAL = backend.kind === "local";

function fmtDate(iso, opts) {
  if (!iso) return "Sem data";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y) return "Sem data";
  return new Date(y, m - 1, d).toLocaleDateString("pt-BR",
    opts || { day: "2-digit", month: "2-digit", year: "numeric" });
}
function dayLabel(iso) {
  if (!iso) return "Sem data";
  if (iso === todayISO()) return "Hoje";
  return fmtDate(iso, { weekday: "short", day: "2-digit", month: "short" }).replaceAll(".", "");
}
const maskCPF = (v) =>
  v.replace(/\D/g, "").slice(0, 11)
    .replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");

function parseMoneyInput(s) {
  if (typeof s === "number") return s;
  let t = String(s ?? "").replace(/[^\d.,-]/g, "");
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if ((t.match(/\./g) || []).length > 1) t = t.replace(/\.(?=.*\.)/g, "");
  const n = parseFloat(t);
  return isNaN(n) ? 0 : n;
}
const api = (path, opts) => backend.api(path, opts);

/** Entrega o arquivo: menu de compartilhar no celular, download no resto. */
async function deliver({ blob, filename, type }, { share = false } = {}) {
  if (share && navigator.canShare) {
    const file = new File([blob], filename, { type: type || blob.type });
    if (navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: filename }); return "shared"; }
      catch (e) { if (e?.name === "AbortError") return "cancelled"; }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return "downloaded";
}

/* ------------------------------------------------------------------ ícones */
const PATHS = {
  camera: "M3 8.5A2.5 2.5 0 0 1 5.5 6h1.2a2 2 0 0 0 1.7-1l.5-.8A2 2 0 0 1 10.6 3h2.8a2 2 0 0 1 1.7 1.2l.5.8a2 2 0 0 0 1.7 1h1.2A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5zM12 9.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z",
  image: "M4 5h16v14H4zM4 16l4.5-4.5 3 3L15 11l5 5M9 9.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0z",
  utensils: "M5 3v8a2 2 0 0 0 2 2v8M9 3v7M13 3v18M17 3c-1.5 2-2 4-2 6s.5 3 2 3 2-1 2-3-.5-4-2-6z",
  fuel: "M4 20V5a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v15M3 20h12M7 9h4M16 8l3 3v6a1.5 1.5 0 0 1-3 0v-3h-3",
  car: "M5 16v2M19 16v2M4 15h16M5.5 15l1.4-5.2A2 2 0 0 1 8.8 8h6.4a2 2 0 0 1 1.9 1.8L18.5 15M4 15h16v-3H4zM7 12.5h.01M17 12.5h.01",
  tag: "M3 11V5a2 2 0 0 1 2-2h6l10 10-8 8L3 11zM8 8h.01",
  back: "M15 5l-7 7 7 7",
  plus: "M12 5v14M5 12h14",
  user: "M4 20c0-3.3 3.6-5.5 8-5.5s8 2.2 8 5.5M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  share: "M12 15V3m0 0L8 7m4-4 4 4M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5",
  check: "M4 12.5l5 5L20 6.5",
  close: "M6 6l12 12M18 6L6 18",
  warn: "M12 9v4m0 3.5h.01M10.3 3.9 2.6 17.3A2 2 0 0 0 4.3 20.3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  file: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4",
  mail: "M3 7l9 6 9-6M3 6h18v12H3z",
  pencil: "M4 20h4L20 8l-4-4L4 16zM14 6l4 4",
  receipt: "M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2zM9 8h6M9 12h6M9 16h3",
  pending: "M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
  briefcase: "M3 9h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM8 9V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v3M3 13h18",
  parking: "M4 4h16v16H4zM9.5 16V8h3a2.5 2.5 0 0 1 0 5h-3",
  gear: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 13a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-3-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-3l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.2V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 3 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  cloud: "M7 18a4 4 0 0 1-.4-8 5.5 5.5 0 0 1 10.6-1.3A3.8 3.8 0 0 1 18 18z",
};
const Icon = ({ name, size = 20, style }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
       strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>
    <path d={PATHS[name] || ""} />
  </svg>
);

/* ------------------------------------------------------------------ marca */
/**
 * Logo institucional. O arquivo é embutido em base64 por build-docs.mjs a partir
 * de static/logo.png, para a marca aparecer também offline. Se não houver
 * arquivo, o componente simplesmente não renderiza nada.
 */
/* A marca é um lockup horizontal (350x27): ao lado do título ela ocuparia a
   barra inteira num celular. Vai numa faixa própria acima, que rola junto com
   a página e deixa a barra de navegação fixa logo abaixo. O fundo é branco
   porque o azul da marca desapareceria no tema escuro. */
const Logo = () => (LOGO
  ? <div className="brandbar"><img src={LOGO} alt={LOGO_ALT} /></div>
  : null);

/* ------------------------------------------------------------------ base UI */
const Field = ({ label, hint, children }) => (
  <div className="field"><label>{label}</label>{children}{hint && <p className="hint">{hint}</p>}</div>
);

function Sheet({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);
  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="grabber" />
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="iconbtn ghost" onClick={onClose} aria-label="Fechar"><Icon name="close" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

const Confirm = ({ text, confirmLabel = "Excluir", onConfirm, onClose }) => (
  <Sheet title="Confirmar" onClose={onClose}>
    <p style={{ margin: "4px 2px 20px", color: "var(--ink-2)" }}>{text}</p>
    <div className="btn-row">
      <button className="btn" onClick={onClose}>Cancelar</button>
      <button className="btn danger" onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</button>
    </div>
  </Sheet>
);

/** Imagem do cupom: URL direta no servidor, objeto do IndexedDB no app local. */
function ReceiptImage({ receipt, kind = "thumb", pagina = 1, className, alt = "", onClick }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let live = true;
    setSrc(null);
    backend.loadImage(receipt, kind, pagina).then((u) => live && setSrc(u)).catch(() => {});
    return () => { live = false; };
  }, [receipt.id, receipt.image_key, receipt.image_path, kind, pagina]);
  if (!src) return <div className={className}><Icon name="pencil" size={18} /></div>;
  return <img className={className} src={src} alt={alt} loading="lazy" onClick={onClick} />;
}

/* ------------------------------------------------------------------ toasts */
function useToasts() {
  const [items, setItems] = useState([]);
  const push = useCallback((msg, kind = "") => {
    const id = Math.random();
    setItems((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setItems((t) => t.filter((x) => x.id !== id)), kind === "err" ? 5200 : 3200);
  }, []);
  const view = (
    <div className="toasts" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <Icon name={t.kind === "err" ? "warn" : "check"} size={18} /><span>{t.msg}</span>
        </div>
      ))}
    </div>
  );
  return [push, view];
}

/* ------------------------------------------------------------------ perfil */
function ProfileSheet({ profile, onSaved, onClose, push }) {
  const [f, setF] = useState({ ...profile });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: k === "cpf" ? maskCPF(e.target.value) : e.target.value });

  async function save() {
    if (!f.nome?.trim()) return push("Informe seu nome completo.", "err");
    setSaving(true);
    try {
      onSaved(await api("/api/profile", { method: "PUT", body: f }));
      push("Dados salvos.", "ok");
      onClose();
    } catch (e) { push(e.message, "err"); } finally { setSaving(false); }
  }
  return (
    <Sheet title="Meus dados" onClose={onClose}>
      <p className="hint" style={{ margin: "-4px 2px 16px" }}>
        {IS_LOCAL
          ? "Entram no cabeçalho da planilha e do PDF. Ficam só neste aparelho."
          : "Entram no cabeçalho da planilha e do PDF. Ficam guardados só neste servidor."}
      </p>
      <Field label="Nome completo">
        <input value={f.nome || ""} onChange={set("nome")} autoComplete="name" placeholder="Maria Souza" />
      </Field>
      <div className="row stack-sm">
        <Field label="CPF">
          <input value={f.cpf || ""} onChange={set("cpf")} inputMode="numeric" placeholder="000.000.000-00" />
        </Field>
        <Field label="E-mail">
          <input type="email" value={f.email || ""} onChange={set("email")} autoComplete="email"
                 placeholder="voce@email.com" />
        </Field>
      </div>
      <Field label="Banco"><input value={f.banco || ""} onChange={set("banco")} placeholder="Santander" /></Field>
      <div className="row">
        <Field label="Agência"><input value={f.agencia || ""} onChange={set("agencia")} inputMode="numeric" /></Field>
        <Field label="Conta"><input value={f.conta || ""} onChange={set("conta")} inputMode="numeric" /></Field>
      </div>
      <button className="btn primary block" onClick={save} disabled={saving}>
        {saving ? "Salvando…" : "Salvar"}
      </button>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ ajustes */
function SettingsSheet({ settings, onSaved, onClose, push }) {
  const [f, setF] = useState({ ...settings });
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [space, setSpace] = useState(null);
  const [warming, setWarming] = useState(null);

  useEffect(() => { backend.usage().then(setSpace).catch(() => {}); }, []);

  async function test() {
    setTesting(true);
    const url = String(f.serverUrl || "").trim().replace(/\/+$/, "");
    const ok = await backend.pingServer(url);
    push(ok ? "Servidor respondeu." : "Não consegui falar com o servidor.", ok ? "ok" : "err");
    setTesting(false);
  }
  async function save() {
    setSaving(true);
    try { onSaved(await backend.saveSettings(f)); push("Ajustes salvos.", "ok"); onClose(); }
    catch (e) { push(e.message, "err"); } finally { setSaving(false); }
  }
  async function warm() {
    setWarming(0);
    try {
      await backend.warmUpOcr(({ phase, progress }) => {
        if (phase === "download") setWarming(Math.round((progress || 0) * 100));
      });
      push("Motor de OCR guardado. Já funciona sem internet.", "ok");
    } catch (e) { push(e.message, "err"); } finally { setWarming(null); }
  }

  return (
    <Sheet title="Ajustes" onClose={onClose}>
      <div className="card tight">
        <div className="card-head"><h2>Leitura dos cupons</h2></div>
        <p className="hint" style={{ marginTop: 0 }}>
          O OCR roda no próprio aparelho (3 a 8s por cupom). Se você tiver o servidor Travelness
          ligado na mesma rede, ele faz a leitura em cerca de 1s e poupa bateria.
        </p>
        <Field label="Endereço do servidor (opcional)"
               hint="Ex.: http://192.168.0.12:5000 — deixe vazio para usar só o aparelho.">
          <input value={f.serverUrl || ""} inputMode="url" placeholder="http://192.168.0.12:5000"
                 onChange={(e) => setF({ ...f, serverUrl: e.target.value })} />
        </Field>
        <label className="check">
          <input type="checkbox" checked={!!f.useServerOcr} disabled={!f.serverUrl}
                 onChange={(e) => setF({ ...f, useServerOcr: e.target.checked })} />
          <span>Usar o servidor para ler os cupons quando ele estiver no ar</span>
        </label>
        <button className="btn sm block" onClick={test} disabled={!f.serverUrl || testing}>
          <Icon name="cloud" size={16} /> {testing ? "Testando…" : "Testar conexão"}
        </button>
      </div>

      <div className="card tight">
        <div className="card-head"><h2>Funcionar sem internet</h2></div>
        <p className="hint" style={{ marginTop: 0 }}>
          O motor de OCR tem cerca de 15 MB e é baixado na primeira leitura. Baixe agora se você
          for viajar para um lugar sem sinal.
        </p>
        <button className="btn sm block" onClick={warm} disabled={warming !== null}>
          {warming === null ? "Baixar motor de OCR agora" : `Baixando… ${warming}%`}
        </button>
      </div>

      {space && (
        <div className="card tight">
          <div className="card-head"><h2>Espaço usado</h2></div>
          <p className="hint" style={{ marginTop: 0 }}>
            {(space.usage / 1048576).toFixed(1)} MB guardados neste aparelho
            {space.quota ? ` de ${(space.quota / 1048576).toFixed(0)} MB disponíveis` : ""}.
            As fotos ficam só aqui — exporte antes de limpar os dados do navegador.
          </p>
        </div>
      )}

      <button className="btn primary block" onClick={save} disabled={saving}>
        {saving ? "Salvando…" : "Salvar ajustes"}
      </button>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ viagem */
function TripSheet({ trip, onSaved, onClose, push }) {
  const isNew = !trip?.id;
  const [f, setF] = useState({
    projeto: "", centro_custo: "", motivo: "", data_inicio: "", data_fim: "",
    email_destinatario: "", adiantamento: "", ...(trip || {}),
  });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const periodoInvalido = !!(f.data_inicio && f.data_fim && f.data_fim < f.data_inicio);

  async function save() {
    if (!f.projeto.trim()) return push("Dê um nome ao projeto.", "err");
    if (periodoInvalido) {
      return push("A data de fim não pode ser anterior à de início.", "err");
    }
    setSaving(true);
    try {
      const body = { ...f, adiantamento: parseMoneyInput(f.adiantamento) };
      const t = isNew
        ? await api("/api/trips", { method: "POST", body })
        : await api(`/api/trips/${trip.id}`, { method: "PUT", body });
      onSaved(t);
      onClose();
    } catch (e) { push(e.message, "err"); } finally { setSaving(false); }
  }
  return (
    <Sheet title={isNew ? "Nova prestação de contas" : "Editar viagem"} onClose={onClose}>
      <Field label="Projeto" hint="Aparece no topo da planilha e no nome do arquivo.">
        <input value={f.projeto} onChange={set("projeto")} placeholder="Ex.: Reembolso Sergipe" autoFocus />
      </Field>
      <Field label="Motivo da viagem">
        <textarea value={f.motivo} onChange={set("motivo")}
                  placeholder="Ex.: Reuniões com as equipes de RH da Secretaria Estadual de Saúde em Aracaju." />
      </Field>
      <div className="row">
        <Field label="Início">
          <input type="date" value={f.data_inicio || ""} max={f.data_fim || undefined}
                 onChange={set("data_inicio")} />
        </Field>
        <Field label="Fim">
          {/* min/max guiam o seletor nativo; o aviso abaixo cobre a digitação
              manual, que escapa deles. Aceitamos o valor e barramos no salvar:
              recusar a tecla faz a data sumir e o usuário não entende por quê. */}
          <input type="date" value={f.data_fim || ""} min={f.data_inicio || undefined}
                 aria-invalid={periodoInvalido} onChange={set("data_fim")} />
        </Field>
      </div>
      {periodoInvalido && (
        <p className="hint" role="alert" style={{ color: "var(--danger)", margin: "-8px 2px 14px" }}>
          A data de fim é anterior à de início.
        </p>
      )}
      <div className="row stack-sm">
        <Field label="Centro de custo"><input value={f.centro_custo} onChange={set("centro_custo")} /></Field>
        <Field label="Adiantamento recebido" hint="Deixe 0 se não houve.">
          <input value={f.adiantamento} onChange={set("adiantamento")} inputMode="decimal" placeholder="0,00" />
        </Field>
      </div>
      <Field label="E-mail de quem vai receber" hint="Para quem a prestação será enviada.">
        <input type="email" value={f.email_destinatario} onChange={set("email_destinatario")}
               placeholder="financeiro@organizacao.org" />
      </Field>
      <button className="btn primary block" onClick={save} disabled={saving || periodoInvalido}>
        {saving ? "Salvando…" : isNew ? "Criar viagem" : "Salvar alterações"}
      </button>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ cupom */
/** O que o OCR não conseguiu resolver sozinho, em português claro. */
function motivosDeRevisao(r) {
  const m = [];
  if (!r.valor) m.push("não achei o valor");
  if (!r.data) m.push("não achei a data");
  if (r.categoria === "outros") m.push("não reconheci o tipo de despesa");
  if (!r.estabelecimento && !r.cnpj) m.push("não identifiquei o estabelecimento");
  if (!m.length && r.confianca < 0.75) m.push("a leitura saiu com baixa confiança");
  return m;
}

function ReceiptSheet({ receipt, onSaved, onDelete, onClose, push, review }) {
  const [f, setF] = useState({
    ...receipt,
    valor: receipt.valor ? String(receipt.valor).replace(".", ",") : "",
    litros: receipt.litros ?? "",
    km: receipt.km ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [zoom, setZoom] = useState(null);
  const [pagina, setPagina] = useState(1);
  const totalPaginas = receipt.paginas || 1;
  const [confirm, setConfirm] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const hasImage = !!(receipt.image_key || receipt.image_path);

  async function save() {
    const valor = parseMoneyInput(f.valor);
    if (!valor) return push("Informe o valor do cupom.", "err");
    if (!f.data) return push("Informe a data do cupom.", "err");
    setSaving(true);
    try {
      const body = {
        ...f, valor,
        litros: f.litros === "" ? null : parseMoneyInput(f.litros),
        km: f.km === "" ? null : parseMoneyInput(f.km),
      };
      // quem fecha (ou avança para o próximo da fila) é o pai
      onSaved(await api(`/api/receipts/${receipt.id}`, { method: "PUT", body }));
    } catch (e) { push(e.message, "err"); } finally { setSaving(false); }
  }

  async function openZoom() {
    const u = await backend.loadImage(receipt, "full", pagina);
    if (u) setZoom(u);
  }

  return (
    <Sheet title={review && review.total > 1
                    ? `Conferir cupom ${review.idx} de ${review.total}`
                    : "Conferir cupom"}
           onClose={onClose}>
      {receipt.revisar ? (() => {
        const motivos = motivosDeRevisao(receipt);
        return (
          <div className="banner">
            <Icon name="warn" size={18} />
            <span>
              {motivos.length
                ? <>Confira antes de exportar — {motivos.join("; ")}.</>
                : <>O OCR não teve certeza aqui. Confira valor, data e categoria.</>}
            </span>
          </div>
        );
      })() : review ? (
        <div className="banner info">
          <Icon name="check" size={18} />
          {receipt.fonte === "texto do PDF" ? (
            <span>Lido direto do texto do PDF: o valor é exato, não passou por OCR.
              Só confirme se é esta a despesa.</span>
          ) : (
            <span>Leitura feita. Confira o valor na foto — o OCR às vezes troca um
              dígito nos centavos sem perceber.</span>
          )}
        </div>
      ) : null}
      {hasImage && (
        <>
          <ReceiptImage receipt={receipt} kind="full" pagina={pagina} className="preview"
                        alt={`Comprovante, página ${pagina}`} onClick={openZoom} />
          {totalPaginas > 1 && (
            <div className="pager">
              <button className="iconbtn" onClick={() => setPagina((n) => Math.max(1, n - 1))}
                      disabled={pagina === 1} aria-label="Página anterior">
                <Icon name="back" size={18} />
              </button>
              <span>Página {pagina} de {totalPaginas}</span>
              <button className="iconbtn" onClick={() => setPagina((n) => Math.min(totalPaginas, n + 1))}
                      disabled={pagina === totalPaginas} aria-label="Próxima página">
                <Icon name="back" size={18} style={{ transform: "rotate(180deg)" }} />
              </button>
            </div>
          )}
        </>
      )}
      {zoom && <div className="lightbox" onClick={() => setZoom(null)}><img src={zoom} alt="" /></div>}

      <Field label="Categoria">
        <div className="seg">
          {CATS.map((c) => (
            <button key={c.id} aria-pressed={f.categoria === c.id}
                    style={{ color: f.categoria === c.id ? `var(--cat-${c.id})` : undefined }}
                    onClick={() => setF({ ...f, categoria: c.id })}>
              <Icon name={c.icon} /><span>{c.label}</span>
            </button>
          ))}
        </div>
      </Field>
      <div className="row">
        <Field label="Data"><input type="date" value={f.data || ""} onChange={set("data")} /></Field>
        <Field label="Valor (R$)">
          <input value={f.valor} onChange={set("valor")} inputMode="decimal" placeholder="0,00" />
        </Field>
      </div>
      <Field label="Estabelecimento">
        <input value={f.estabelecimento || ""} onChange={set("estabelecimento")} placeholder="Nome do local" />
      </Field>
      <Field label="Descrição" hint="É o texto que aparece na planilha.">
        <input value={f.descricao || ""} onChange={set("descricao")}
               placeholder={f.categoria === "alimentacao" ? "Almoço" : "Descrição da despesa"} />
      </Field>
      {f.categoria === "transporte" && (
        <div className="row stack-sm">
          <Field label="Origem"><input value={f.origem || ""} onChange={set("origem")} /></Field>
          <Field label="Destino"><input value={f.destino || ""} onChange={set("destino")} /></Field>
        </div>
      )}
      {f.categoria === "combustivel" && (
        <div className="row">
          <Field label="Litros"><input value={f.litros} onChange={set("litros")} inputMode="decimal" /></Field>
          <Field label="Km rodados"><input value={f.km} onChange={set("km")} inputMode="decimal" /></Field>
        </div>
      )}
      <Field label="CNPJ"><input value={f.cnpj || ""} onChange={set("cnpj")} inputMode="numeric" /></Field>

      <div className="btn-row" style={{ marginTop: 6 }}>
        <button className="btn danger" style={{ flex: "0 0 56px" }} onClick={() => setConfirm(true)}
                aria-label="Excluir cupom"><Icon name="trash" /></button>
        <button className="btn primary" onClick={save} disabled={saving}>
          {saving ? "Salvando…"
            : review && review.idx < review.total ? "Salvar e conferir próximo"
            : "Salvar"}
        </button>
      </div>
      {review && review.idx < review.total && (
        <button className="btn sm block" style={{ marginTop: 8 }} onClick={onClose}>
          Conferir o resto depois
        </button>
      )}
      {confirm && (
        <Confirm text="Excluir este cupom e a imagem dele?"
                 onConfirm={() => { onDelete(receipt.id); onClose(); }} onClose={() => setConfirm(false)} />
      )}
    </Sheet>
  );
}

/* ------------------------------------------------------------------ exportar */
function ExportSheet({ trip, receipts, profile, features, onClose, push }) {
  const [busy, setBusy] = useState(null);
  const [built, setBuilt] = useState({});            // arquivos já prontos: { xlsx, pdf }
  const pend = receipts.filter((r) => r.revisar).length;
  const canShare = typeof navigator !== "undefined" && !!navigator.canShare;

  /* O menu de compartilhar do celular só abre enquanto o toque ainda está "fresco" (no
     iPhone, cerca de 1 segundo), e gerar o PDF com as fotos leva mais que isso. Por isso os
     arquivos são montados ao abrir a tela, e o toque no botão só chama o menu. */
  useEffect(() => {
    if (!canShare) return;
    let dead = false;
    (async () => {
      for (const k of ["xlsx", "pdf"]) {
        try {
          const o = await backend.buildExport(trip.id, k);
          if (dead) return;
          const f = new File([o.blob], o.filename, { type: o.type || o.blob.type });
          setBuilt((b) => ({ ...b, [k]: f }));
        } catch (e) { if (!dead) push(e.message, "err"); return; }
      }
    })();
    return () => { dead = true; };
  }, [canShare, trip.id]);

  const pronto = !!(built.xlsx && built.pdf);
  /* No Chrome o menu recusa .xlsx; a planilha vai como CSV (o Excel abre) e o .xlsx fica em "Baixar". */
  const soSimples = compartilhaSoTiposSimples();
  const csv = useMemo(() => (built.xlsx
    ? new File([buildCsv({ receipts, catLabels: CAT_LABEL })], built.xlsx.name.replace(/\.xlsx$/i, ".csv"), { type: "text/csv" })
    : null), [built.xlsx, receipts]);
  const shareFiles = pronto ? [soSimples ? csv : built.xlsx, built.pdf] : null;
  const podeCompartilhar = canShare && pronto && canShareFiles(shareFiles);
  const textoPadrao = useMemo(() => buildMessage({
    template: loadTemplate(), profile, trip, receipts, products: { xlsx: true, pdf: true }, catLabels: CAT_LABEL,
  }), [profile, trip, receipts]);

  async function grab(kind, share) {
    setBusy(kind + (share ? "-s" : ""));
    try {
      const out = await backend.buildExport(trip.id, kind);
      const how = await deliver(out, { share });
      if (how === "downloaded") push(`${out.filename} baixado.`, "ok");
    } catch (e) { push(e.message, "err"); } finally { setBusy(null); }
  }

  /* Celular: menu de compartilhar (WhatsApp, Gmail, Drive…) com os dois arquivos e o texto. */
  async function shareBoth() {
    setBusy("both");
    try {
      await navigator.share({ files: shareFiles, title: textoPadrao.subject, text: textoPadrao.body });
    } catch (e) {
      if (e?.name === "AbortError") return;
      push(e?.name === "NotAllowedError"
        ? "O navegador recusou os arquivos. Use “Baixar arquivos” e anexe na mão."
        : `Não consegui compartilhar: ${e?.message || e}`, "err");
    } finally { setBusy(null); }
  }

  /* Computador: o WhatsApp Web não recebe anexo por link; baixa os arquivos e abre a conversa
     com o texto, e a pessoa arrasta os arquivos para ela. */
  async function whatsappWeb() {
    const aba = window.open("about:blank", "_blank");   // abre já, enquanto o clique vale
    setBusy("wa");
    try {
      for (const k of ["xlsx", "pdf"]) {
        const f = built[k] || await (async () => {
          const o = await backend.buildExport(trip.id, k);
          return new File([o.blob], o.filename, { type: o.type || o.blob.type });
        })();
        downloadBlob(f, f.name);
        await new Promise((r) => setTimeout(r, 400));
      }
      const url = `https://wa.me/?text=${encodeURIComponent(textoPadrao.body.slice(0, 1800))}`;
      if (aba) aba.location.href = url; else window.open(url, "_blank");
      push("Arquivos baixados. Arraste-os para a conversa do WhatsApp.", "ok");
    } catch (e) { aba?.close(); push(e.message, "err"); } finally { setBusy(null); }
  }

  return (
    <Sheet title="Exportar" onClose={onClose}>
      {pend > 0 && (
        <div className="banner">
          <Icon name="warn" size={18} />
          <span><b>{pend}</b> {pend === 1 ? "cupom precisa" : "cupons precisam"} de conferência.
            Dá para exportar assim mesmo.</span>
        </div>
      )}

      {canShare ? (
        <div style={{ marginBottom: 14 }}>
          {podeCompartilhar || !pronto ? (
            <button className="btn primary block" onClick={shareBoth} disabled={!podeCompartilhar || busy !== null}>
              <Icon name="share" size={18} />{" "}
              {!pronto ? "Preparando arquivos…" : busy === "both" ? "Abrindo…" : "Compartilhar (WhatsApp, e-mail…)"}
            </button>
          ) : (
            <div className="banner info">
              <Icon name="warn" size={18} />
              <span>Este aparelho não aceita compartilhar esses arquivos. Use “Baixar arquivos” abaixo.</span>
            </div>
          )}
          {podeCompartilhar && (
            <p className="hint" style={{ marginTop: 8 }}>
              Abre o menu do aparelho com a planilha, o PDF e o texto da viagem. Escolha o WhatsApp,
              o Gmail ou outro app e depois o contato.
              {soSimples && " Neste navegador a planilha segue em CSV (o Excel abre); a planilha .xlsx completa fica em “Baixar arquivos”."}
            </p>
          )}
        </div>
      ) : (
        <button className="btn block" onClick={whatsappWeb} disabled={busy !== null} style={{ marginBottom: 14 }}>
          <Icon name="share" size={18} /> {busy === "wa" ? "Preparando…" : "WhatsApp: baixar arquivos e abrir conversa"}
        </button>
      )}

      <div className="card tight">
        <div className="card-head"><h2>Baixar arquivos</h2></div>
        <div style={{ display: "grid", gap: 10 }}>
          <button className="btn dark block" onClick={() => grab("xlsx", false)} disabled={busy !== null}>
            <Icon name="file" size={18} /> {busy === "xlsx" ? "Gerando…" : "Planilha (Excel)"}
          </button>
          <button className="btn dark block" onClick={() => grab("pdf", false)} disabled={busy !== null}>
            <Icon name="receipt" size={18} /> {busy === "pdf" ? "Gerando…" : "PDF das notas"}
          </button>
        </div>
        <p className="hint" style={{ marginTop: 10 }}>
          Planilha no formato de prestação de contas, com uma aba extra de dados.
          PDF com capa, índice e uma página por comprovante.
        </p>
      </div>

    </Sheet>
  );
}

/* ------------------------------------------------------------------ home */
function Home({ trips, profile, onOpen, onNew, onProfile, onSettings }) {
  const incomplete = !profile.nome || !profile.cpf;
  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1>Travelness<span className="sub">Prestação de contas de viagens</span></h1>
        </div>
        {IS_LOCAL && (
          <button className="iconbtn" onClick={onSettings} aria-label="Ajustes"><Icon name="gear" /></button>
        )}
        <button className="iconbtn" onClick={onProfile} aria-label="Meus dados"><Icon name="user" /></button>
      </div>

      {incomplete && (
        <div className="banner">
          <Icon name="warn" size={18} />
          <span>Complete <button onClick={onProfile}>seus dados</button> (nome, CPF e conta bancária)
            para a planilha sair preenchida.</span>
        </div>
      )}

      {trips.length === 0 ? (
        <div className="empty">
          <Icon name="briefcase" size={46} />
          <h3>Nenhuma viagem ainda</h3>
          <p>Crie uma prestação de contas e comece a fotografar os cupons.</p>
        </div>
      ) : (
        <div className="list">
          {trips.map((t) => (
            <button key={t.id} className="trip" onClick={() => onOpen(t.id)}>
              <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                <h3 style={{ flex: 1 }}>{t.projeto}</h3>
                <span className="amount">{brl(t.total)}</span>
              </div>
              <div className="meta">
                <span>{t.qtd} {t.qtd === 1 ? "cupom" : "cupons"}</span>
                {t.data_inicio && (
                  <span>{fmtDate(t.data_inicio, { day: "2-digit", month: "short" })}
                    {t.data_fim ? ` – ${fmtDate(t.data_fim, { day: "2-digit", month: "short" })}` : ""}</span>
                )}
                {t.pendentes > 0 ? (
                  <span className="chip warn"><Icon name="pending" size={12} /> {t.pendentes} a conferir</span>
                ) : t.qtd > 0 && (
                  <span className="chip ok"><Icon name="check" size={12} /> conferido</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="actionbar"><div className="inner">
        <button className="btn primary" onClick={onNew}><Icon name="plus" size={18} /> Nova viagem</button>
      </div></div>
    </>
  );
}

/* ------------------------------------------------------------------ viagem */
function TripView({ tripId, profile, features, onBack, onTripsChanged, push }) {
  const [trip, setTrip] = useState(null);
  const [receipts, setReceipts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [queue, setQueue] = useState([]);
  const [editing, setEditing] = useState(null);
  const [reviewIds, setReviewIds] = useState([]);   // fila de conferência após um envio
  const [reviewTotal, setReviewTotal] = useState(0);
  const [sheet, setSheet] = useState(null);
  const [filter, setFilter] = useState("todos");
  const camRef = useRef(null);
  const galRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const d = await api(`/api/trips/${tripId}`);
      setTrip(d.trip);
      setReceipts(d.receipts);
    } catch (e) { push(e.message, "err"); onBack(); } finally { setLoading(false); }
  }, [tripId, onBack, push]);
  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => {
    const t = { alimentacao: 0, combustivel: 0, transporte: 0, estacionamento: 0, outros: 0, geral: 0 };
    receipts.forEach((r) => { t[r.categoria] += r.valor; t.geral += r.valor; });
    return t;
  }, [receipts]);
  const pend = receipts.filter((r) => r.revisar).length;

  const groups = useMemo(() => {
    const list = filter === "todos" ? receipts
      : filter === "revisar" ? receipts.filter((r) => r.revisar)
      : receipts.filter((r) => r.categoria === filter);
    const map = new Map();
    list.forEach((r) => {
      const k = r.data || "";
      if (!map.has(k)) map.set(k, { k, items: [], total: 0 });
      const g = map.get(k);
      g.items.push(r);
      g.total += r.valor;
    });
    return [...map.values()];
  }, [receipts, filter]);

  const upload = useCallback(async (files) => {
    const arr = [...files].filter((f) => f.type.startsWith("image/") || f.type === "application/pdf");
    if (!arr.length) return;
    const items = arr.map((f, i) => ({ id: `${Date.now()}-${i}`, name: f.name, file: f, state: "wait" }));
    setQueue((q) => [...q, ...items]);
    let ok = 0, dup = 0;
    const novos = [];
    for (const it of items) {
      const setState = (patch) => setQueue((q) => q.map((x) => (x.id === it.id ? { ...x, ...patch } : x)));
      setState({ state: "run" });
      try {
        const d = await backend.addReceipt(tripId, it.file, ({ phase, progress }) => {
          if (phase === "download") setState({ note: `baixando OCR ${Math.round((progress || 0) * 100)}%` });
          else if (phase === "fallback") setState({ note: "servidor fora do ar, lendo aqui" });
          else if (phase === "ocr") setState({ note: `lendo ${Math.round((progress || 0) * 100)}%` });
          else setState({ note: null });
        });
        setReceipts((rs) => [...rs, d.receipt].sort(
          (a, b) => (a.data || "9").localeCompare(b.data || "9") || a.id - b.id));
        novos.push(d.receipt);
        ok++;
        setQueue((q) => q.filter((x) => x.id !== it.id));
      } catch (e) {
        if (e.status === 409) { dup++; setQueue((q) => q.filter((x) => x.id !== it.id)); }
        else setState({ state: "failed", msg: e.message });
      }
    }
    if (ok) push(`${ok} ${ok === 1 ? "cupom lido" : "cupons lidos"}.${dup ? ` ${dup} repetido(s) ignorado(s).` : ""}`, "ok");
    else if (dup) push("Esse cupom já estava na lista.", "err");
    onTripsChanged();
    load();

    // Medimos que o Tesseract às vezes erra com confiança alta — trocar o "0"
    // por "6" nos centavos, por exemplo — e nenhum sinal automático pega isso
    // de forma confiável. Numa prestação de contas o valor errado é caro, então
    // todo cupom recém-lido passa por uma olhada humana. Quem está com pressa
    // usa "Conferir o resto depois"; o selo laranja continua marcando os piores.
    if (novos.length) {
      setReviewIds(novos.map((r) => r.id));
      setReviewTotal(novos.length);
      setEditing(novos[0]);
    }
  }, [tripId, push, onTripsChanged, load]);

  const fecharRevisao = useCallback(() => {
    setEditing(null);
    setReviewIds([]);
    setReviewTotal(0);
  }, []);

  const pick = (ref) => () => { ref.current.value = ""; ref.current.click(); };

  async function addManual() {
    try {
      const d = await api(`/api/trips/${tripId}/receipts`, {
        method: "POST", body: { categoria: "outros", data: todayISO(), valor: 0, descricao: "" },
      });
      setReceipts((rs) => [...rs, d.receipt]);
      setEditing(d.receipt);
    } catch (e) { push(e.message, "err"); }
  }

  function onReceiptSaved(r) {
    const atualizados = receipts.map((x) => (x.id === r.id ? r : x))
      .sort((a, b) => (a.data || "9").localeCompare(b.data || "9") || a.id - b.id);
    setReceipts(atualizados);
    onTripsChanged();
    load();

    const resto = reviewIds.filter((id) => id !== r.id);
    setReviewIds(resto);
    const proximo = resto.length ? atualizados.find((x) => x.id === resto[0]) : null;
    setEditing(proximo || null);
    if (!proximo) setReviewTotal(0);
  }
  async function removeReceipt(id) {
    await api(`/api/receipts/${id}`, { method: "DELETE" });
    setReceipts((rs) => rs.filter((r) => r.id !== id));
    push("Cupom excluído.");
    onTripsChanged();
    load();
  }

  if (loading || !trip) {
    return (
      <>
        <div className="topbar"><h1>Carregando…</h1></div>
        {[1, 2, 3].map((i) => <div key={i} className="skel" style={{ marginBottom: 12 }} />)}
      </>
    );
  }

  const filters = [
    ["todos", `Todos (${receipts.length})`],
    ...(pend ? [["revisar", `A conferir (${pend})`]] : []),
    ...CATS.map((c) => [c.id, c.label]).filter(([id]) => receipts.some((r) => r.categoria === id)),
  ];

  return (
    <>
      <div className="topbar">
        <button className="iconbtn ghost" onClick={onBack} aria-label="Voltar"><Icon name="back" /></button>
        <h1>{trip.projeto}
          <span className="sub">{trip.qtd} {trip.qtd === 1 ? "cupom" : "cupons"}
            {trip.motivo ? ` · ${trip.motivo.slice(0, 38)}${trip.motivo.length > 38 ? "…" : ""}` : ""}</span>
        </h1>
        <button className="iconbtn" onClick={() => setSheet("trip")} aria-label="Editar viagem">
          <Icon name="pencil" />
        </button>
      </div>

      <div className="grand" style={{ marginBottom: 14 }}>
        <div><div className="k">Total de despesas</div><div className="v">{brl(totals.geral)}</div></div>
        {trip.adiantamento > 0 && (
          <div style={{ textAlign: "right" }}>
            <div className="k">{totals.geral >= trip.adiantamento ? "A receber" : "A restituir"}</div>
            <div style={{ fontSize: 17, fontWeight: 700 }}>{brl(Math.abs(totals.geral - trip.adiantamento))}</div>
          </div>
        )}
      </div>
      <div className="totals" style={{ marginBottom: 16 }}>
        {CATS.map((c) => (
          <div key={c.id} className="tot">
            <div className="k" style={{ color: `var(--cat-${c.id})` }}>{c.label}</div>
            <div className="v">{brl(totals[c.id])}</div>
          </div>
        ))}
      </div>

      {pend > 0 && !editing && (
        <div className="banner" style={{ alignItems: "center" }}>
          <Icon name="warn" size={18} />
          <span style={{ flex: 1 }}>
            <b>{pend}</b> {pend === 1 ? "cupom precisa" : "cupons precisam"} de conferência.
          </span>
          <button className="btn sm" style={{ flex: "0 0 auto" }}
                  onClick={() => {
                    const alvos = receipts.filter((r) => r.revisar);
                    setReviewIds(alvos.map((r) => r.id));
                    setReviewTotal(alvos.length);
                    setEditing(alvos[0]);
                  }}>
            Conferir agora
          </button>
        </div>
      )}

      {queue.length > 0 && (
        <div className="queue">
          {queue.map((q) => (
            <div key={q.id}
                 className={`qitem ${q.state === "failed" ? "failed" : ""} ${q.state === "wait" ? "wait" : ""}`}>
              {q.state === "failed" ? <Icon name="warn" size={17} />
                : q.state === "wait" ? <Icon name="pending" size={17} /> : <div className="spinner" />}
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {q.state === "failed" ? q.msg
                  : q.state === "wait" ? `${q.name} · na fila`
                  : `Lendo ${q.name}…${q.note ? ` (${q.note})` : ""}`}
              </span>
              {q.state === "failed" && (
                <button className="iconbtn ghost" style={{ width: 28, height: 28, flex: "0 0 28px" }}
                        onClick={() => setQueue((x) => x.filter((i) => i.id !== q.id))} aria-label="Dispensar">
                  <Icon name="close" size={16} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {receipts.length > 1 && (
        <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "0 2px 12px" }}>
          {filters.map(([id, label]) => (
            <button key={id} className={`chip ${filter === id ? "ok" : ""}`} aria-pressed={filter === id}
                    style={{ cursor: "pointer", padding: "7px 13px", fontSize: 12.5 }}
                    onClick={() => setFilter(id)}>{label}</button>
          ))}
        </div>
      )}

      {receipts.length === 0 ? (
        <div className="empty">
          <Icon name="camera" size={46} />
          <h3>Fotografe o primeiro cupom</h3>
          <p>O app lê valor, data e categoria sozinho. Dá para enviar vários de uma vez.</p>
          <button className="btn sm" style={{ marginTop: 14 }} onClick={addManual}>
            <Icon name="pencil" size={16} /> Lançar sem foto
          </button>
        </div>
      ) : groups.map((g) => (
        <div key={g.k}>
          <div className="day-head"><span>{dayLabel(g.k)}</span><span>{brl(g.total)}</span></div>
          <div className="list">
            {g.items.map((r) => (
              <button key={r.id} className="receipt" onClick={() => setEditing(r)}>
                <ReceiptImage receipt={r} className="thumb" />
                <div style={{ minWidth: 0 }}>
                  <div className="title">{r.descricao || r.estabelecimento || CAT_LABEL[r.categoria]}</div>
                  <div className="sub">
                    <span className={`chip ${r.categoria}`}><span className="dot" />{CAT_LABEL[r.categoria]}</span>
                    {r.revisar
                      ? <span className="chip warn"><Icon name="pending" size={11} /> conferir</span>
                      : r.estabelecimento && r.descricao ? <span>{r.estabelecimento}</span> : null}
                    {(r.paginas || 1) > 1 && (
                      <span className="chip"><Icon name="file" size={11} /> {r.paginas} págs.</span>
                    )}
                  </div>
                </div>
                <div className="val">{brl(r.valor)}</div>
              </button>
            ))}
          </div>
        </div>
      ))}

      {receipts.length > 0 && (
        <div style={{ marginTop: 20, display: "grid", gap: 8 }}>
          <button className="btn sm" onClick={addManual}>
            <Icon name="pencil" size={16} /> Lançar despesa sem foto
          </button>
          <button className="btn sm" onClick={() => setSheet("delete")}
                  style={{ color: "var(--danger)", borderColor: "transparent", background: "transparent" }}>
            Excluir esta viagem
          </button>
        </div>
      )}

      <input ref={camRef} type="file" accept="image/*" capture="environment" multiple
             onChange={(e) => upload(e.target.files)} />
      <input ref={galRef} type="file" accept="image/*,application/pdf" multiple
             onChange={(e) => upload(e.target.files)} />

      <div className="actionbar">
        <div className="inner">
          <button className="btn primary" onClick={pick(camRef)}><Icon name="camera" size={18} /> Fotografar</button>
          <button className="btn" onClick={pick(galRef)} aria-label="Enviar da galeria"
                  style={{ flex: "0 0 56px" }}><Icon name="image" size={18} /></button>
          <button className="btn dark" onClick={() => setSheet("export")} disabled={receipts.length === 0}>
            <Icon name="share" size={18} /> Exportar
          </button>
        </div>
        <div className="fab-note">Na galeria dá para marcar vários cupons de uma vez.</div>
      </div>

      {editing && (
        /* key força remontagem ao avançar na fila: sem ela o formulário manteria
           o estado do cupom anterior e gravaria os valores dele no próximo. */
        <ReceiptSheet key={editing.id}
                      receipt={editing} push={push} onSaved={onReceiptSaved} onDelete={removeReceipt}
                      onClose={fecharRevisao}
                      review={reviewTotal > 0
                        ? { idx: reviewTotal - reviewIds.length + 1, total: reviewTotal }
                        : null} />
      )}
      {sheet === "trip" && (
        <TripSheet trip={trip} push={push} onClose={() => setSheet(null)}
                   onSaved={(t) => { setTrip({ ...trip, ...t }); onTripsChanged(); }} />
      )}
      {sheet === "export" && (
        <ExportSheet trip={trip} receipts={receipts} profile={profile} features={features} push={push}
                     onClose={() => setSheet(null)} />
      )}
      {sheet === "delete" && (
        <Confirm text={`Excluir a viagem “${trip.projeto}” e seus ${receipts.length} cupons? Não dá para desfazer.`}
                 onConfirm={async () => {
                   await api(`/api/trips/${trip.id}`, { method: "DELETE" });
                   onTripsChanged();
                   onBack();
                 }}
                 onClose={() => setSheet(null)} />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ app */
function App() {
  const [boot, setBoot] = useState(null);
  const [profile, setProfile] = useState({});
  const [trips, setTrips] = useState([]);
  const [settings, setSettings] = useState(null);
  const [tripId, setTripId] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [push, toasts] = useToasts();

  useEffect(() => {
    backend.boot().then((b) => {
      setBoot(b); setProfile(b.profile); setTrips(b.trips); setSettings(b.settings);
    }).catch((e) => push(e.message, "err"));
  }, []);

  const reloadTrips = useCallback(async () => {
    try { setTrips(await api("/api/trips")); } catch { /* a tela já mostra o que tem */ }
  }, []);

  useEffect(() => {
    const onPop = () => setTripId(history.state?.tripId ?? null);
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);
  const openTrip = (id) => { history.pushState({ tripId: id }, "", `#viagem-${id}`); setTripId(id); };
  const back = useCallback(() => {
    if (history.state?.tripId) history.back(); else setTripId(null);
  }, []);

  if (!boot) {
    return (
      <div className="app">
        <Logo />
        <div className="topbar"><h1>Travelness<span className="sub">carregando…</span></h1></div>
        {[1, 2].map((i) => <div key={i} className="skel" style={{ marginBottom: 12 }} />)}
      </div>
    );
  }

  const features = { ...boot.features, email: IS_LOCAL ? !!settings?.serverUrl : boot.features.email };

  return (
    <div className="app">
      <Logo />
      {tripId ? (
        <TripView tripId={tripId} profile={profile} features={features} push={push}
                  onBack={back} onTripsChanged={reloadTrips} />
      ) : (
        <Home trips={trips} profile={profile} onOpen={openTrip} onProfile={() => setSheet("profile")}
              onSettings={() => setSheet("settings")} onNew={() => setSheet("trip")} />
      )}
      {sheet === "profile" && (
        <ProfileSheet profile={profile} push={push} onSaved={setProfile} onClose={() => setSheet(null)} />
      )}
      {sheet === "settings" && settings && (
        <SettingsSheet settings={settings} push={push} onSaved={setSettings} onClose={() => setSheet(null)} />
      )}
      {sheet === "trip" && (
        <TripSheet trip={null} push={push} onClose={() => setSheet(null)}
                   onSaved={(t) => { reloadTrips(); openTrip(t.id); }} />
      )}
      {toasts}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
if ("serviceWorker" in navigator) {
  const sw = new URL("sw.js", document.baseURI).href;
  navigator.serviceWorker.register(sw, { scope: "./" }).catch(() => {});
}
