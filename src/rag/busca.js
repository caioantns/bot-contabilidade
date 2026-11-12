// Busca na base de conhecimento: vetorial (se disponível) ou full-text em português.
import { query, temVetor } from '../db.js';
import { embeddingsAtivos, gerarEmbeddings, paraPgvector } from './embeddings.js';

export async function buscarConhecimento(pergunta, limite = 4) {
  if (embeddingsAtivos() && (await temVetor())) {
    try {
      const [vetor] = await gerarEmbeddings([pergunta], 'query');
      const { rows } = await query(
        `SELECT titulo, conteudo, 1 - (embedding <=> $1::vector) AS score
           FROM conhecimento
          WHERE embedding IS NOT NULL
          ORDER BY embedding <=> $1::vector
          LIMIT $2`,
        [paraPgvector(vetor), limite]
      );
      const relevantes = rows.filter((r) => r.score > 0.3);
      if (relevantes.length) return relevantes;
    } catch (err) {
      console.warn('[busca] vetorial falhou, usando full-text:', err.message);
    }
  }
  return buscaTexto(pergunta, limite);
}

// Termos ligados por OU: acha trechos mesmo quando nem toda palavra aparece
export function montarTsquery(pergunta) {
  const termos = String(pergunta)
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);
  return [...new Set(termos)].join(' | ');
}

async function buscaTexto(pergunta, limite) {
  const tsq = montarTsquery(pergunta);
  if (!tsq) return [];
  const { rows } = await query(
    `SELECT titulo, conteudo, ts_rank(tsv, q) AS score
       FROM conhecimento, to_tsquery('portuguese', $1) q
      WHERE tsv @@ q
      ORDER BY score DESC
      LIMIT $2`,
    [tsq, limite]
  );
  return rows;
}
