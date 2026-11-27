"""Travelness — prestação de contas de viagens a partir de cupons fiscais.

Executar:  python app.py   (abre em http://0.0.0.0:5000)
"""
import json
import os
import shutil
import subprocess
import tempfile
import uuid

from flask import Flask, abort, jsonify, render_template, request, send_file, send_from_directory
import io

import db
import exporters
import mailer
import ocr

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 20 * 1024 * 1024  # 20 MB por arquivo
app.json.ensure_ascii = False
db.init_db()

ASSET_VERSION = "1.1.0"
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

# O app do GitHub Pages roda em outra origem, então precisa de CORS nas rotas que ele usa.
# ALLOWED_ORIGINS limita quem pode falar com este servidor ("*" libera geral).
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get(
    "ALLOWED_ORIGINS", "https://nucleo-de-dados-fgv-projetos.github.io").split(",") if o.strip()]
SHARED_ROUTES = ("/api/ocr", "/api/send", "/api/health")


@app.after_request
def _cors(resp):
    origin = request.headers.get("Origin")
    if origin and request.path in SHARED_ROUTES:
        if "*" in ALLOWED_ORIGINS or origin in ALLOWED_ORIGINS:
            resp.headers["Access-Control-Allow-Origin"] = origin
            resp.headers["Vary"] = "Origin"
            resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
            resp.headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
            resp.headers["Access-Control-Max-Age"] = "86400"
    return resp


@app.route("/api/health", methods=["GET", "OPTIONS"])
def health():
    """Usado pelo app estático para saber se vale a pena mandar o OCR para cá."""
    return jsonify({"ok": True, "ocr": ocr.HAS_TESSERACT, "email": mailer.is_configured(),
                    "version": ASSET_VERSION})


@app.route("/api/ocr", methods=["POST", "OPTIONS"])
def ocr_only():
    """Lê um cupom e devolve os campos, sem gravar nada. O app estático é quem guarda."""
    if request.method == "OPTIONS":
        return "", 204
    f = request.files.get("file")
    if not f:
        return err("Envie uma imagem do cupom.")
    raw = f.read()
    if raw[:4] == b"%PDF":
        texto = _pdf_text(raw)
        if _tem_texto(texto):
            campos = dict(ocr.parse_receipt(texto))
            campos.pop("_scores", None)
            return jsonify({"text": texto, "fields": campos, "fonte": "texto do PDF"})
        if not shutil.which("pdftoppm"):
            return err("PDF não suportado neste servidor.")
        raw = _pdf_pages(raw)[0]
    try:
        res = ocr.extract(raw)
    except Exception:
        return err("Não consegui abrir esta imagem.", 415)
    fields = dict(res["fields"])
    fields.pop("_scores", None)
    return jsonify({"text": res["text"], "fields": fields, "fonte": "servidor"})


@app.route("/api/send", methods=["POST", "OPTIONS"])
def send_files():
    """Recebe os arquivos já prontos do app estático e despacha por e-mail."""
    if request.method == "OPTIONS":
        return "", 204
    if not mailer.is_configured():
        return err("Este servidor não está configurado para enviar e-mail (SMTP_HOST / SMTP_FROM).")
    to = [e.strip() for e in (request.form.get("to") or "").split(",") if "@" in e]
    if not to:
        return err("Nenhum destinatário válido.")
    files = request.files.getlist("files")
    if not files:
        return err("Nenhum arquivo para anexar.")
    try:
        profile = json.loads(request.form.get("profile") or "{}")
        trip = json.loads(request.form.get("trip") or "{}")
    except ValueError:
        return err("Dados da viagem inválidos.")

    att = [(f.filename, f.read(), f.mimetype or "application/octet-stream") for f in files]
    total = float(request.form.get("total") or 0)
    text = (f"Olá,\n\nSegue a prestação de contas da viagem do projeto "
            f"{trip.get('projeto', '')}.\n\n"
            f"Solicitante: {profile.get('nome', '')} (CPF {profile.get('cpf', '')})\n"
            f"Motivo: {trip.get('motivo') or '—'}\n"
            f"Comprovantes: {request.form.get('count', '?')}\n"
            f"Total: {exporters.brl(total)}\n\n"
            f"Dados bancários: Banco {profile.get('banco', '')} · Ag. {profile.get('agencia', '')} · "
            f"C/c {profile.get('conta', '')}\n\nEnviado pelo Travelness.")
    try:
        mailer.send(to, f"Prestação de contas – {trip.get('projeto', '')} – {profile.get('nome', '')}",
                    text, att, reply_to=profile.get("email") or None)
    except Exception as e:
        return err(f"Falha no envio: {e}", 502)
    return jsonify({"sent_to": to})


def err(msg, code=400, **extra):
    return jsonify({"error": msg, **extra}), code


@app.errorhandler(ValueError)
def _value_error(e):
    return err(str(e))


@app.errorhandler(413)
def _too_big(_):
    return err("Arquivo muito grande (máx. 20 MB).", 413)


# ------------------------------------------------------------------ página
@app.get("/")
def index():
    state = {
        "profile": db.get_profile(),
        "trips": db.list_trips(),
        "features": {"email": mailer.is_configured(), "ocr": ocr.HAS_TESSERACT,
                     "pdfUpload": bool(shutil.which("pdftoppm"))},
    }
    return render_template("index.html", state=state, v=ASSET_VERSION)


@app.get("/sw.js")
def service_worker():
    resp = send_from_directory(app.static_folder, "sw.js")
    resp.headers["Service-Worker-Allowed"] = "/"
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@app.get("/manifest.webmanifest")
def manifest():
    return send_from_directory(app.static_folder, "manifest.webmanifest",
                               mimetype="application/manifest+json")


# ------------------------------------------------------------------ perfil
@app.get("/api/profile")
def get_profile():
    return jsonify(db.get_profile())


@app.put("/api/profile")
def put_profile():
    return jsonify(db.save_profile(request.get_json(force=True)))


# ------------------------------------------------------------------ viagens
@app.get("/api/trips")
def trips():
    return jsonify(db.list_trips())


@app.post("/api/trips")
def create_trip():
    return jsonify(db.create_trip(request.get_json(force=True))), 201


def _trip_or_404(tid):
    t = db.get_trip(tid)
    if not t:
        abort(404)
    return t


@app.get("/api/trips/<int:tid>")
def get_trip(tid):
    return jsonify({"trip": _trip_or_404(tid), "receipts": db.list_receipts(tid)})


@app.put("/api/trips/<int:tid>")
def put_trip(tid):
    _trip_or_404(tid)
    return jsonify(db.update_trip(tid, request.get_json(force=True)))


@app.delete("/api/trips/<int:tid>")
def del_trip(tid):
    _trip_or_404(tid)
    db.delete_trip(tid)
    return "", 204


# ------------------------------------------------------------------ cupons
def _pdf_text(raw: bytes) -> str:
    """Camada de texto do PDF. Recibo de Uber/99 tem — e aí o valor sai exato,
    sem OCR e sem chance de trocar um dígito."""
    try:
        from pypdf import PdfReader
    except ImportError:
        return ""
    try:
        leitor = PdfReader(io.BytesIO(raw))
        return "\n".join((pg.extract_text() or "") for pg in leitor.pages)
    except Exception:
        return ""


def _tem_texto(t: str) -> bool:
    return sum(c.isalpha() for c in t) >= 40


MAX_PAGINAS = 20   # trava de segurança: recibo não tem 200 páginas


def _pdf_pages(raw: bytes) -> list:
    """Converte todas as páginas do PDF em PNG via poppler.

    O comprovante vale como documento inteiro — num recibo de app as páginas
    seguintes trazem trajeto, pagamento e tributos.
    """
    with tempfile.TemporaryDirectory() as d:
        src = os.path.join(d, "in.pdf")
        open(src, "wb").write(raw)
        subprocess.run(["pdftoppm", "-png", "-r", "200", "-f", "1", "-l", str(MAX_PAGINAS),
                        src, os.path.join(d, "p")],
                       check=True, timeout=180, capture_output=True)
        pngs = sorted(f for f in os.listdir(d) if f.endswith(".png"))
        if not pngs:
            raise ValueError("Não foi possível ler o PDF.")
        return [open(os.path.join(d, f), "rb").read() for f in pngs]


@app.post("/api/trips/<int:tid>/receipts")
def upload_receipt(tid):
    _trip_or_404(tid)

    # lançamento manual (sem imagem), ex.: táxi sem recibo
    if request.is_json:
        data = request.get_json()
        r = db.create_receipt(tid, data, {"revisar": 0, "confianca": 1})
        return jsonify({"receipt": r}), 201

    f = request.files.get("file")
    if not f:
        return err("Envie uma imagem do cupom.")
    raw = f.read()
    fonte = "servidor"
    texto_pdf = ""
    paginas_extra = []
    if raw[:4] == b"%PDF":
        texto_pdf = _pdf_text(raw)
        if not shutil.which("pdftoppm"):
            return err("PDF não suportado neste servidor. Envie uma foto ou print do cupom.")
        paginas = _pdf_pages(raw)
        raw, paginas_extra = paginas[0], paginas[1:]
    try:
        res = ocr.extract(raw)
    except Exception:
        return err("Não consegui abrir esta imagem. Tente JPG ou PNG.", 415)

    # com camada de texto, ela vale mais que o OCR da página rasterizada
    if _tem_texto(texto_pdf):
        res = {**res, "text": texto_pdf, "fields": ocr.parse_receipt(texto_pdf)}
        fonte = "texto do PDF"

    fields = res["fields"]
    dup = db.find_duplicate(tid, res["hash"], fields["chave_acesso"], fields["cnpj"], fields["data"],
                            fields["valor"])
    if dup and request.form.get("force") != "1":
        return err("Este cupom já foi adicionado.", 409, duplicate_of=dup)

    name = f"{uuid.uuid4().hex}.jpg"
    open(os.path.join(db.UPLOAD_DIR, name), "wb").write(res["jpeg"])
    open(os.path.join(db.UPLOAD_DIR, "thumb_" + name), "wb").write(res["thumb"])
    base = name[:-4]
    for i, pagina in enumerate(paginas_extra, start=2):
        extra_jpeg, _, _, _ = ocr.normalize_image(pagina)
        open(os.path.join(db.UPLOAD_DIR, f"{base}-p{i}.jpg"), "wb").write(extra_jpeg)

    extra = {"image_path": name, "image_hash": res["hash"], "ocr_text": res["text"],
             "confianca": fields["confianca"], "revisar": fields["revisar"], "fonte": fonte,
             "paginas": 1 + len(paginas_extra)}
    payload = {k: v for k, v in fields.items() if k in db.RECEIPT_FIELDS and k != "revisar"}
    r = db.create_receipt(tid, payload, extra)
    return jsonify({"receipt": r, "hora": fields.get("hora")}), 201


@app.put("/api/receipts/<int:rid>")
def put_receipt(rid):
    if not db.get_receipt(rid):
        abort(404)
    data = request.get_json(force=True)
    data["revisar"] = 0  # salvar pela tela de conferência marca o cupom como revisado
    return jsonify(db.update_receipt(rid, data))


@app.delete("/api/receipts/<int:rid>")
def del_receipt(rid):
    db.delete_receipt(rid)
    return "", 204


@app.get("/uploads/<path:name>")
def uploads(name):
    resp = send_from_directory(db.UPLOAD_DIR, name)
    resp.headers["Cache-Control"] = "private, max-age=31536000, immutable"
    return resp


# ------------------------------------------------------------------ exportação
def _bundle(tid):
    trip = _trip_or_404(tid)
    return db.get_profile(), trip, db.list_receipts(tid)


@app.get("/api/trips/<int:tid>/export.xlsx")
def export_xlsx(tid):
    p, t, rs = _bundle(tid)
    return send_file(io.BytesIO(exporters.build_excel(p, t, rs)), mimetype=XLSX_MIME, as_attachment=True,
                     download_name=exporters.base_filename(t, rs, "xlsx"))


@app.get("/api/trips/<int:tid>/export.pdf")
def export_pdf(tid):
    p, t, rs = _bundle(tid)
    return send_file(io.BytesIO(exporters.build_pdf(p, t, rs)), mimetype="application/pdf",
                     as_attachment=request.args.get("inline") != "1",
                     download_name=exporters.base_filename(t, rs, "pdf"))


@app.post("/api/trips/<int:tid>/email")
def email(tid):
    p, t, rs = _bundle(tid)
    if not mailer.is_configured():
        return err("Envio por e-mail não está configurado neste servidor. Baixe os arquivos ou "
                   "configure o SMTP (veja o README).")
    body = request.get_json(force=True)
    to = []
    if body.get("recipient") and t.get("email_destinatario"):
        to.append(t["email_destinatario"])
    if body.get("me") and p.get("email"):
        to.append(p["email"])
    to += [e.strip() for e in (body.get("extra") or "").replace(";", ",").split(",") if "@" in e]
    to = list(dict.fromkeys(to))
    if not to:
        return err("Escolha ao menos um destinatário com e-mail válido.")
    products = body.get("products") or ["xlsx", "pdf"]
    att = []
    if "xlsx" in products:
        att.append((exporters.base_filename(t, rs, "xlsx"), exporters.build_excel(p, t, rs), XLSX_MIME))
    if "pdf" in products:
        att.append((exporters.base_filename(t, rs, "pdf"), exporters.build_pdf(p, t, rs), "application/pdf"))
    total = sum(r["valor"] for r in rs)
    text = (f"Olá,\n\nSegue a prestação de contas da viagem do projeto {t['projeto']}.\n\n"
            f"Solicitante: {p.get('nome', '')} (CPF {p.get('cpf', '')})\n"
            f"Motivo: {t.get('motivo') or '—'}\n"
            f"Comprovantes: {len(rs)}\nTotal: {exporters.brl(total)}\n\n"
            f"Dados bancários: Banco {p.get('banco', '')} · Ag. {p.get('agencia', '')} · "
            f"C/c {p.get('conta', '')}\n\nEnviado pelo Travelness.")
    try:
        mailer.send(to, f"Prestação de contas – {t['projeto']} – {p.get('nome', '')}", text, att,
                    reply_to=p.get("email") or None)
    except Exception as e:
        return err(f"Falha no envio: {e}", 502)
    return jsonify({"sent_to": to})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=False, threaded=True)
