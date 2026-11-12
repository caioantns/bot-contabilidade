# Bot de atendimento — Contabilidade

Atendimento via WhatsApp com IA (Claude): tira dúvidas pela base de conhecimento do escritório, identifica clientes da base pelo telefone, qualifica novos interessados (leads) e transfere para a equipe quando precisa.

```
WhatsApp ──► /webhook ──► identifica telefone ──► IA (Claude + ferramentas) ──► resposta
                              │                         ├─ consultar_base_conhecimento  (knowledge/*.md)
                         clientes (Postgres)            ├─ registrar_lead
                                                        └─ transferir_para_humano  → bot fica quieto até a equipe devolver
```

## Estrutura

| Caminho | O que é |
|---|---|
| `src/server.js` | Express: webhook do WhatsApp + rotas `/admin` |
| `src/atendimento.js` | Fluxo de cada mensagem (deduplicação, modo humano, fila por telefone) |
| `src/agente.js` | Loop da IA com tool use |
| `src/prompt.js` | Personalidade, regras e contexto (cliente/lead, horário) — **o arquivo que você mais vai ajustar** |
| `src/ferramentas.js` | Ferramentas que a IA pode usar — é aqui que entram as próximas (documentos, pendências…) |
| `src/rag/` | Busca na base: vetorial (pgvector + Voyage) ou full-text do Postgres |
| `knowledge/*.md` | Base de conhecimento. Cada `##` vira um trecho pesquisável |
| `scripts/` | migrate, ingest, importar clientes, chat de teste no terminal |

## 1. Rodar local

Precisa de Node 20+ e um Postgres (local, Docker, ou o do Railway pela URL pública com `DATABASE_SSL=true`).

```bash
npm install
cp .env.example .env          # preencha DATABASE_URL e ANTHROPIC_API_KEY
npm run migrate
npm run ingest
npm run importar-clientes -- dados/clientes-exemplo.csv
npm run chat                  # conversa como um número novo (lead)
npm run chat -- 21999990001   # conversa como o Carlos, da Padaria (cliente da base)
```

No chat: `/reset` apaga a conversa, `/devolver` tira do modo humano, `/sair` fecha.

Testes: `npm test`.

## Painel web (`/teste`)

Abra `https://SEU-BOT.up.railway.app/teste` e cole o `ADMIN_TOKEN` (fica nas variáveis do serviço no Railway). Ali dá para:
- **Simular conversas** no navegador (como lead ou como cliente da base);
- **Conectar o WhatsApp por QR code** (canal `evolution`);
- **Importar clientes** colando o CSV.

## 2a. WhatsApp por QR code (Evolution API) — usado para testes

O bot fala com uma [Evolution API](https://docs.evolutionfoundation.com.br/) hospedada no Railway (projeto separado). Variáveis: `CANAL=evolution`, `EVOLUTION_URL`, `EVOLUTION_API_KEY` (igual ao `AUTHENTICATION_API_KEY` da Evolution), `EVOLUTION_INSTANCE`, `EVOLUTION_WEBHOOK_TOKEN`.

No painel `/teste` → **Conectar / mostrar QR** → no celular: *WhatsApp → Aparelhos conectados → Conectar um aparelho*. O bot cria a instância e configura o webhook sozinho.

> Conexão não oficial: use só em número de teste. O bot responde a **qualquer** conversa individual que chegar nesse número (grupos são ignorados).

## 2b. WhatsApp Cloud API oficial (Meta) — `CANAL=meta`

1. Em [developers.facebook.com](https://developers.facebook.com), crie um app do tipo **Business** e adicione o produto **WhatsApp**.
2. Em *WhatsApp > Configuração da API*: copie o **token temporário** (`WHATSAPP_TOKEN`) e o **Phone number ID** (`WHATSAPP_PHONE_NUMBER_ID`). Adicione seu celular em "Para" (até 5 números de teste).
3. Em *Configurações do app > Básico*, copie a **Chave secreta do app** (`WHATSAPP_APP_SECRET`).
4. Depois do deploy (passo 3), em *WhatsApp > Configuração > Webhook*:
   - URL de callback: `https://SEU-APP.up.railway.app/webhook`
   - Token de verificação: o mesmo valor de `WHATSAPP_VERIFY_TOKEN`
   - Assine o campo **messages**.
5. Mande um "oi" do seu celular para o número de teste.

> O token temporário expira em 24h. Para algo estável, crie um **usuário do sistema** no Business Manager e gere um token permanente com as permissões `whatsapp_business_messaging` e `whatsapp_business_management`.

## 3. Deploy no Railway

1. Suba o projeto para um repositório no GitHub e crie um projeto no Railway a partir dele.
2. Adicione um **Postgres** ao projeto (se quiser busca vetorial, use o template com **pgvector**; sem ele o bot usa full-text e funciona bem).
3. Nas variáveis do serviço: `DATABASE_URL=${{Postgres.DATABASE_URL}}` e o resto do `.env.example`.
4. Gere um domínio público (Settings > Networking).
5. O `npm start` roda migrate + ingest + servidor. Ou seja: **editou um `.md` em `knowledge/`, fez push, a base atualiza sozinha.**
6. Importar clientes no banco do Railway: `railway run npm run importar-clientes -- caminho/clientes.csv`.

## 4. Operação (provisório, até entrar o Chatwoot)

Todas as rotas exigem o header `Authorization: Bearer <ADMIN_TOKEN>`.

| Rota | Para quê |
|---|---|
| `GET /admin/transferencias` | Conversas esperando atendimento humano |
| `GET /admin/leads` | Leads registrados |
| `GET /admin/conversas/:telefone` | Histórico de uma conversa |
| `POST /admin/conversas/:telefone/responder` `{ "texto": "..." }` | Responder como equipe (fica no histórico) |
| `POST /admin/conversas/:telefone/devolver` | Devolver a conversa para o bot |

## 5. Ajustando o atendimento

- **Base de conhecimento:** os arquivos em `knowledge/` são **exemplos**. Substitua pelo conteúdo real da contabilidade. Escreva cada pergunta/assunto como uma seção `##` com resposta completa. Comentários `<!-- -->` não entram na base.
- **Regras e tom:** `src/prompt.js`.
- **Clientes:** CSV com `nome;cnpj;regime;responsavel;email;telefone;contato` (uma linha por telefone).

## Próximas etapas

1. **Envio de documentos**: ferramentas `listar_documentos` e `enviar_documento`, com verificação extra de identidade antes de enviar (a função `enviarDocumento` já está em `src/whatsapp.js`).
2. **Chatwoot** como caixa de entrada da equipe, no lugar das rotas `/admin`.
3. **Áudio**: transcrever mensagens de voz.
4. **Mensagens proativas** (avisos de vencimento) com templates aprovados pela Meta.
5. **Número oficial** e verificação da empresa no Business Manager.
