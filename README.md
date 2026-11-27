# Travelness

Prestação de contas de viagens a partir de fotos de cupons fiscais.

Você fotografa o cupom, o app lê **valor, data, CNPJ, estabelecimento e chave de acesso**,
classifica em **alimentação / combustível / transporte / outros** e entrega dois produtos:

1. **Planilha Excel** no layout de prestação de contas (seções A/B/C, fechamento, dados
   bancários e campos de assinatura) + uma aba tabular com um cupom por linha.
2. **PDF** com capa, resumo por categoria, índice e **todas as páginas de cada
   comprovante** — recibo de app traz trajeto, pagamento e tributos em folhas
   separadas, e a prestação de contas precisa do documento inteiro.

## 👉 Usar agora

**<https://nucleo-de-dados-fgv-projetos.github.io/travelness/>**

Abra no celular e toque em *Adicionar à tela de início*. Vira um app com ícone próprio,
funciona offline e **os cupons ficam no seu aparelho** — nada é enviado para servidor nenhum.

---

## As duas versões

O mesmo código roda de dois jeitos, a partir das mesmas fontes em `src/`:

| | **App estático** (`docs/`) | **Servidor** (Flask) |
|---|---|---|
| Onde roda | navegador do celular | sua máquina / rede local |
| Onde ficam os dados | IndexedDB, no aparelho | SQLite, em `data/` |
| OCR | PaddleOCR no aparelho (Tesseract.js de reserva) | PaddleOCR (Tesseract de reserva) |
| Planilha e PDF | gerados no navegador | gerados no servidor |
| E-mail | programa de e-mail do aparelho (sem servidor) | o mesmo, ou SMTP direto |
| Instalação | nenhuma (1º uso baixa ~31 MB de modelos, depois funciona offline) | Python (+ Tesseract opcional) |

Os dois são independentes. Se você usar só o app estático, nunca precisa ligar o servidor —
só perde o OCR rápido e o envio direto por SMTP. O e-mail funciona sem servidor, pelo programa
de e-mail do próprio aparelho (veja *Enviar por e-mail*, abaixo).

**Os dois juntos:** em *Ajustes*, informe o endereço do servidor (ex.: `http://192.168.0.12:5000`).
Quando ele estiver no ar, o app manda o OCR para lá e volta a ler no aparelho sozinho se o
servidor não responder.

---

## Publicando no GitHub Pages

Já está pronto para isso. Em **Settings → Pages → Source**, escolha **main / `/docs`**.
O app fica em `https://<usuário>.github.io/<repo>/`.

Tudo em `docs/` usa caminhos relativos justamente para funcionar nesse subdiretório.
Para republicar depois de mexer na interface:

```bash
./build.sh && git add docs static && git commit -m "atualiza app" && git push
```

---

## Rodando o servidor (opcional)

```bash
pip install -r requirements.txt
sudo apt-get install -y tesseract-ocr tesseract-ocr-por poppler-utils
python app.py          # http://localhost:5000
```

Para o app do GitHub Pages poder falar com ele, o servidor precisa aceitar aquela origem:

```bash
ALLOWED_ORIGINS=https://nucleo-de-dados-fgv-projetos.github.io python app.py
```

### E-mail por SMTP (opcional)

Só é preciso se você quiser que o servidor envie sozinho, sem abrir o programa de e-mail.
Copie `.env.example` para `.env`, preencha e exporte:

```bash
set -a; source .env; set +a; python app.py
```

No Gmail use uma **senha de app**, não a senha da conta.

---

## Enviar por e-mail

Exportar → **Preparar e-mail**. Informe o destinatário (já vem preenchido com o da viagem), confira
o assunto e a mensagem e envie. Não precisa de servidor nem de configuração.

Um site não consegue enviar e-mail sozinho nem anexar arquivo num link `mailto:`, então o envio usa
o e-mail do próprio aparelho, e o último clique em *Enviar* é seu:

| Onde | O que acontece |
|---|---|
| **Celular** | abre o menu de compartilhar; escolha Gmail, Outlook etc. Planilha, PDF e texto já vão preenchidos. O menu não aceita destinatário, então o endereço fica copiado para colar em *Para* |
| **Computador** | baixa um rascunho `.eml` com destinatário, assunto, texto e anexos. Ao abrir o arquivo, ele aparece pronto no Outlook (clássico), Thunderbird e similares. Alguns programas (como o Mail do Mac e o novo Outlook) abrem o `.eml` como mensagem recebida |
| **Gmail na web** | botão *baixar anexos e abrir rascunho*: baixa os arquivos e abre um rascunho só com o texto; anexe os arquivos na mão |

**Texto da mensagem.** Sai da descrição da viagem (projeto, período, motivo, centro de custo),
dos totais por categoria, do adiantamento e dos seus dados. Dá para ajustar antes de enviar. Em
*Modelo do texto* você muda o padrão das próximas viagens (fica guardado no aparelho). Marcadores:
`{projeto}` `{motivo}` `{periodo}` `{data_inicio}` `{data_fim}` `{centro_custo}` `{qtd}`
`{categorias}` `{total}` `{adiantamento}` `{saldo}` `{acerto}` `{anexos}` `{solicitante}` `{cpf}`
`{email}` `{banco}` `{agencia}` `{conta}`. Linha cujos marcadores ficarem vazios (sem motivo, sem
adiantamento…) some sozinha. Nome e dados bancários entram no texto por padrão (o CPF fica de fora, mas
existe o marcador `{cpf}`): apague essas linhas no modelo se não quiser enviá-los.

---

## Estrutura

```
src/                  fontes do front-end (as duas versões saem daqui)
  ui.jsx                interface React
  mailkit.js            texto do e-mail, rascunho .eml e envio pelo aparelho
  backend.server.js     conversa com o Flask
  backend.local.js      IndexedDB + OCR + exportadores, tudo no navegador
  store.js              persistência IndexedDB
  ocr-parse.js          extração dos campos (porte fiel de ocr.py)
  ocr-engine.js         rotas de OCR: servidor → PaddleOCR → Tesseract.js
  paddle-ocr.js         PaddleOCR (PP-OCRv6) via onnxruntime-web
  pdf-read.js           texto e páginas de PDF (pdf.js, carregado sob demanda)
  xlsx.js  pdf.js       geradores no navegador
docs/                 app estático publicado (gerado por build.sh)
static/ templates/    versão servidor
docs/models/           modelos ONNX do PaddleOCR (usados pelo app e pelo servidor)
app.py db.py ocr.py paddle_ocr.py exporters.py mailer.py    backend Flask
build.sh build-docs.mjs                        compilação
```

`src/ocr-parse.js` é um porte linha a linha de `ocr.py`. Existe um teste de paridade: os dois
devem extrair exatamente os mesmos campos do mesmo texto — se você mexer em um, mexa no outro.

### Compilando

```bash
./build.sh            # gera static/app.js e docs/index.html
DEV=1 ./build.sh      # sem minificar, com sourcemap
```

Precisa de Node só para compilar. Os arquivos gerados estão commitados, então quem só quer
usar o app não precisa de nada.

---

## Como o OCR decide

**Leitura do texto.** Fotos passam pelo **PaddleOCR (PP-OCRv6 small)**, uma rede treinada
para texto em foto — inclinado, amassado, com sombra. Num teste com 11 cupons fotografados
ele acertou o valor em 10 (o 11º tinha o total cortado na foto e foi marcado "a conferir");
o Tesseract acertou 3. No celular ele roda com onnxruntime-web; os modelos ficam em
`docs/models/` e o service worker os guarda no primeiro uso. Se o Paddle não carregar
(navegador antigo, sem internet na primeira vez), o app cai para o Tesseract.js sozinho.
PDF com camada de texto (Uber, 99) não passa por OCR: o texto é lido direto do arquivo.


| Campo | Como é obtido |
|---|---|
| Valor | linhas com `TOTAL`, `VALOR A PAGAR`, `VALOR TOTAL`…, por prioridade. Ignora tributos, troco, subtotal e desconto. Formas de pagamento (dinheiro, cartão, PIX) só entram se nada melhor existir |
| Data/hora | prioriza linhas com `EMISSÃO`/`DATA`; aceita `dd/mm/aaaa` e `12 de jul de 2026`; descarta datas impossíveis |
| CNPJ | validado por dígito verificador; se faltar, extraído da chave de acesso |
| Chave de acesso | 44 dígitos com modelo 55/65/59 |
| Categoria | dicionário ponderado de termos (posto, litros, Uber, taxímetro, restaurante…) com desempate |
| Descrição | refeição pela hora (café/almoço/lanche/jantar), app de transporte pelo nome, "Abastecimento" para combustível |

| Categoria | `alimentacao`, `combustivel`, `transporte`, `estacionamento`, `outros` — estacionamento cobre recibo e cupom fiscal (Estapar, zona azul, valet, garagem) |

Cada cupom recebe uma **confiança de 0 a 1**. Abaixo de 0,75, faltando valor/data, com o total
sem rótulo ("maior valor do cupom") ou com o valor do total cortado, ele
ganha o selo laranja **"a conferir"**, com filtro próprio e aviso na exportação.

**Toda leitura passa por conferência humana.** Depois de cada envio o app abre a fila de
conferência mostrando a foto ao lado dos campos extraídos. Isso não é excesso de zelo: medimos
que o Tesseract às vezes lê `13,50` como `13,56` — troca um dígito nos centavos — e relata
confiança alta ao fazer isso. Testamos limiar global, nitidez prévia, confiança média do
motor e dupla leitura com layouts diferentes; nenhum desses sinais separa de forma confiável
o acerto do erro. Num documento financeiro, valor errado passando calado é pior do que um
toque a mais, então a confirmação é o caminho normal — com "Conferir o resto depois" para
quem está com pressa.

Duplicatas são bloqueadas por três critérios: imagem idêntica (SHA-256), chave de acesso
repetida ou mesmo CNPJ + data + valor.

---

## Limites conhecidos

- **A câmera só liga em HTTPS.** No GitHub Pages isso já é verdade. Se você servir pelo Flask
  em rede local (`http://192.168…`), o botão "Fotografar" abre a galeria em vez da câmera —
  use um túnel (`cloudflared`, `ngrok`) se precisar da câmera por ali.
- **Os dados do app estático vivem no navegador.** Limpar os dados do site apaga os cupons.
  Exporte a planilha e o PDF ao fim de cada viagem; é para isso que eles existem.
- **O servidor não tem autenticação.** Para uso pessoal na rede local tudo bem; antes de expor
  na internet, ponha um proxy com login na frente.
- **iOS tem cota de armazenamento menor** e pode descartar os dados de sites pouco usados.
  Instalar na tela de início reduz bastante esse risco.

---

## API do servidor

| Método | Rota | O quê |
|---|---|---|
| `GET` | `/api/health` | diz se o OCR e o e-mail estão disponíveis |
| `POST` | `/api/ocr` | lê um cupom e devolve os campos, sem gravar (usado pelo app estático) |
| `POST` | `/api/send` | recebe arquivos prontos e envia por e-mail (usado pelo app estático) |
| `GET/PUT` | `/api/profile` | dados do usuário |
| `GET/POST` | `/api/trips` | listar / criar viagem |
| `GET/PUT/DELETE` | `/api/trips/<id>` | viagem + cupons |
| `POST` | `/api/trips/<id>/receipts` | upload (multipart) ou lançamento manual (JSON) |
| `PUT/DELETE` | `/api/receipts/<id>` | editar / excluir cupom |
| `GET` | `/api/trips/<id>/export.xlsx` · `.pdf` | os dois produtos |

As três primeiras aceitam CORS, limitado por `ALLOWED_ORIGINS`.
