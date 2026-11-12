-- Clientes da contabilidade (importados da planilha)
CREATE TABLE IF NOT EXISTS clientes (
  id            SERIAL PRIMARY KEY,
  nome          TEXT NOT NULL,              -- razão social / nome fantasia
  cnpj          TEXT UNIQUE,
  regime        TEXT,                       -- MEI, Simples, Presumido, Real
  responsavel   TEXT,                       -- contador/analista responsável
  email         TEXT,
  ativo         BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Telefones autorizados a falar em nome de cada cliente (uma empresa pode ter vários)
CREATE TABLE IF NOT EXISTS cliente_telefones (
  id          SERIAL PRIMARY KEY,
  cliente_id  INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  telefone    TEXT NOT NULL UNIQUE,         -- normalizado: 55 + DDD + 9 dígitos
  contato     TEXT                          -- nome da pessoa
);

-- Uma conversa por telefone. status: 'bot' (IA responde) ou 'humano' (equipe assumiu)
CREATE TABLE IF NOT EXISTS conversas (
  id              SERIAL PRIMARY KEY,
  telefone        TEXT NOT NULL UNIQUE,     -- normalizado
  wa_id           TEXT NOT NULL,            -- como a Meta enviou (usado pra responder)
  nome_perfil     TEXT,
  cliente_id      INTEGER REFERENCES clientes(id),
  status          TEXT NOT NULL DEFAULT 'bot' CHECK (status IN ('bot','humano')),
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mensagens (
  id            SERIAL PRIMARY KEY,
  conversa_id   INTEGER NOT NULL REFERENCES conversas(id) ON DELETE CASCADE,
  papel         TEXT NOT NULL CHECK (papel IN ('cliente','bot','humano','sistema')),
  conteudo      TEXT NOT NULL,
  wa_message_id TEXT UNIQUE,                -- evita processar a mesma mensagem duas vezes
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mensagens_conversa ON mensagens (conversa_id, criado_em);

-- Base de conhecimento (gerada a partir de knowledge/*.md)
CREATE TABLE IF NOT EXISTS conhecimento (
  id         SERIAL PRIMARY KEY,
  fonte      TEXT NOT NULL,                 -- arquivo de origem
  titulo     TEXT NOT NULL,
  conteudo   TEXT NOT NULL,
  tsv        tsvector GENERATED ALWAYS AS (
               to_tsvector('portuguese', coalesce(titulo,'') || ' ' || coalesce(conteudo,''))
             ) STORED
);
CREATE INDEX IF NOT EXISTS idx_conhecimento_tsv ON conhecimento USING GIN (tsv);

-- Leads (novos clientes interessados)
CREATE TABLE IF NOT EXISTS leads (
  id             SERIAL PRIMARY KEY,
  conversa_id    INTEGER REFERENCES conversas(id),
  telefone       TEXT NOT NULL,
  nome           TEXT,
  tipo_empresa   TEXT,                      -- MEI, Simples, ainda não tem empresa...
  necessidade    TEXT,                      -- abrir empresa, trocar de contador...
  cidade         TEXT,
  observacoes    TEXT,
  status         TEXT NOT NULL DEFAULT 'novo',
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Pedidos de atendimento humano
CREATE TABLE IF NOT EXISTS transferencias (
  id            SERIAL PRIMARY KEY,
  conversa_id   INTEGER NOT NULL REFERENCES conversas(id),
  setor         TEXT,                       -- comercial, fiscal, dp, financeiro, geral
  motivo        TEXT NOT NULL,
  resolvida     BOOLEAN NOT NULL DEFAULT FALSE,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);
