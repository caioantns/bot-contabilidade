// Embeddings via Voyage AI (opcional). Sem VOYAGE_API_KEY, tudo usa full-text do Postgres.
import { config } from '../config.js';

export const embeddingsAtivos = () => Boolean(config.voyageApiKey);

export async function gerarEmbeddings(textos, tipo = 'document') {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.voyageApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: textos, model: config.voyageModel, input_type: tipo }),
  });
  if (!res.ok) throw new Error(`Voyage ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

// pgvector aceita o vetor como texto '[0.1,0.2,...]'
export const paraPgvector = (v) => `[${v.join(',')}]`;
