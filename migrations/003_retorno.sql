-- Quando o bot avisou por último que o cliente está aguardando a equipe (evita repetir a cada mensagem)
ALTER TABLE conversas ADD COLUMN IF NOT EXISTS espera_avisada_em TIMESTAMPTZ;
