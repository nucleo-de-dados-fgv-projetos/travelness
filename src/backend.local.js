/* Backend do app estático: tudo no aparelho (IndexedDB + OCR), e o servidor Flask
   entra só como acelerador do OCR e como carteiro do e-mail — ambos opcionais. */

import * as store from "./store.js";
import { readReceipt, pingServer, warmUpOcr } from "./ocr-engine.js";
import { buildXlsx, baseFilename } from "./xlsx.js";
import { buildPdf } from "./pdf.js";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const urlCache = new Map();

function httpError(msg, status, extra) {
  return Object.assign(new Error(msg), { status, ...extra });
}

async function bundle(tripId) {
  const data = await store.getTrip(tripId);
  if (!data) throw httpError("Viagem não encontrada.", 404);
  const profile = await store.getProfile();
  return { profile, trip: data.trip, receipts: data.receipts };
}

export const backend = {
  kind: "local",

  async boot() {
    const [profile, trips, settings] = await Promise.all([
      store.getProfile(), store.listTrips(), store.getSettings(),
    ]);
    return { profile, trips, settings, features: { email: !!settings.serverUrl, ocr: true } };
  },

  /* Mesma assinatura do fetch da versão servidor, para a UI não saber a diferença. */
  async api(path, { method = "GET", body } = {}) {
    let m;
    if (path === "/api/profile") {
      return method === "PUT" ? store.saveProfile(body) : store.getProfile();
    }
    if (path === "/api/trips") {
      return method === "POST" ? store.createTrip(body) : store.listTrips();
    }
    if ((m = path.match(/^\/api\/trips\/(\d+)$/))) {
      const id = +m[1];
      if (method === "PUT") return store.updateTrip(id, body);
      if (method === "DELETE") { await store.deleteTrip(id); return null; }
      const d = await store.getTrip(id);
      if (!d) throw httpError("Viagem não encontrada.", 404);
      return d;
    }
    if ((m = path.match(/^\/api\/trips\/(\d+)\/receipts$/)) && method === "POST") {
      return { receipt: await store.createReceipt(+m[1], { ...body, revisar: 0, confianca: 1 }, null) };
    }
    if ((m = path.match(/^\/api\/receipts\/(\d+)$/))) {
      const id = +m[1];
      if (method === "DELETE") { await store.deleteReceipt(id); return null; }
      if (method === "PUT") return store.updateReceipt(id, body);
    }
    throw httpError(`Rota não suportada: ${path}`, 404);
  },

  /** Lê o cupom e grava. Lança erro 409 quando já existe um igual. */
  async addReceipt(tripId, file, onProgress) {
    const settings = await store.getSettings();
    const res = await readReceipt(file, settings, onProgress);
    const f = res.fields;
    const dup = await store.findDuplicate(tripId, res.hash, f.chave_acesso, f.cnpj, f.data, f.valor);
    if (dup) throw httpError("Este cupom já foi adicionado.", 409, { duplicate_of: dup });

    const receipt = await store.createReceipt(
      tripId,
      { ...f, ocr_text: res.text, image_hash: res.hash, fonte: res.engine || "" },
      { full: res.full, thumb: res.thumb },
    );
    return { receipt, engine: res.engine };
  },

  async loadImage(receipt, kind = "thumb", pagina = 1) {
    if (!receipt.image_key) return null;
    const key = kind === "thumb"
      ? `thumb_${receipt.image_key}`
      : store.pageKey(receipt.image_key, pagina);
    if (urlCache.has(key)) return urlCache.get(key);
    const blob = await store.getImage(key);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    urlCache.set(key, url);
    return url;
  },

  async buildExport(tripId, kind) {
    const { profile, trip, receipts } = await bundle(tripId);
    if (kind === "xlsx") {
      return {
        blob: await buildXlsx(profile, trip, receipts),
        filename: baseFilename(trip, receipts, "xlsx"),
        type: XLSX_MIME,
      };
    }
    const images = new Map();
    for (const r of receipts) {
      if (!r.image_key) continue;
      const paginas = [];
      for (let n = 1; n <= (r.paginas || 1); n++) {
        const b = await store.getImage(store.pageKey(r.image_key, n));
        if (b) paginas.push(b);
      }
      if (paginas.length) images.set(r.id, paginas);
    }
    return {
      blob: await buildPdf(profile, trip, receipts, images),
      filename: baseFilename(trip, receipts, "pdf"),
      type: "application/pdf",
    };
  },

  /** O servidor Flask só recebe os arquivos já prontos e despacha. */
  async sendEmail(tripId, { recipient, me, extra, products, subject, body }) {
    const settings = await store.getSettings();
    if (!settings.serverUrl) {
      throw new Error("Configure o endereço do servidor em Ajustes para enviar por e-mail.");
    }
    const { profile, trip, receipts } = await bundle(tripId);
    const to = [];
    if (recipient && trip.email_destinatario) to.push(trip.email_destinatario);
    if (me && profile.email) to.push(profile.email);
    for (const e of (extra || "").replace(/;/g, ",").split(",")) {
      if (e.includes("@")) to.push(e.trim());
    }
    const uniq = [...new Set(to)];
    if (!uniq.length) throw new Error("Escolha ao menos um destinatário com e-mail válido.");

    const form = new FormData();
    form.append("to", uniq.join(","));
    form.append("profile", JSON.stringify(profile));
    form.append("trip", JSON.stringify(trip));
    form.append("total", String(receipts.reduce((s, r) => s + r.valor, 0)));
    form.append("count", String(receipts.length));
    if (subject) form.append("subject", subject);
    if (body) form.append("body", body);
    for (const kind of products) {
      const { blob, filename, type } = await this.buildExport(tripId, kind);
      form.append("files", new File([blob], filename, { type }));
    }
    const res = await fetch(`${settings.serverUrl}/api/send`, { method: "POST", body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `O servidor respondeu ${res.status}.`);
    return data;
  },

  getSettings: store.getSettings,
  saveSettings: store.saveSettings,
  usage: store.usage,
  pingServer,
  warmUpOcr,
};
