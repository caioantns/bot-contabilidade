-- Equipe do escritório: para quem o bot encaminha cada atendimento
CREATE TABLE IF NOT EXISTS funcionarios (
  id         SERIAL PRIMARY KEY,
  nome       TEXT NOT NULL UNIQUE,
  setor      TEXT NOT NULL,              -- fiscal, contabil, dp, legalizacao, comercial, financeiro
  telefone   TEXT,                       -- WhatsApp que recebe o aviso (55 + DDD + número)
  ativo      BOOLEAN NOT NULL DEFAULT TRUE
);

ALTER TABLE transferencias ADD COLUMN IF NOT EXISTS funcionario_id INTEGER REFERENCES funcionarios(id);
ALTER TABLE transferencias ADD COLUMN IF NOT EXISTS aviso_enviado BOOLEAN NOT NULL DEFAULT FALSE;

-- Equipe inicial (os telefones são preenchidos pelo painel /teste)
INSERT INTO funcionarios (nome, setor) VALUES
  ('Bianca Carvalho',    'fiscal'),
  ('Taíse Bastos',       'fiscal'),
  ('Rosângela Coutinho', 'contabil'),
  ('Letícia Mondaini',   'dp'),
  ('Crislaine Viana',    'legalizacao')
ON CONFLICT (nome) DO NOTHING;
