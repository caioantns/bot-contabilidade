// Lê knowledge/*.md e recria a base de conhecimento no banco.
// Rode sempre que editar os arquivos (no Railway roda automaticamente a cada deploy).
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, temVetor } from '../src/db.js';
import { dividirMarkdown } from '../src/rag/trechos.js';
import { embeddingsAtivos, gerarEmbeddings, paraPgvector } from '../src/rag/embeddings.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'knowledge');

async function main() {
  const arquivos = (await readdir(dir)).filter((f) => f.endsWith('.md'));
  const trechos = [];
  for (const arq of arquivos) {
    trechos.push(...dividirMarkdown(await readFile(path.join(dir, arq), 'utf8'), arq));
  }

  let vetores = null;
  if (embeddingsAtivos() && (await temVetor())) {
    try {
      vetores = [];
      for (let i = 0; i < trechos.length; i += 64) {
        const lote = trechos.slice(i, i + 64).map((t) => `${t.titulo}\n${t.conteudo}`);
        vetores.push(...(await gerarEmbeddings(lote, 'document')));
      }
    } catch (err) {
      console.warn(`[ingest] embeddings falharam (${err.message}); salvando só para full-text.`);
      vetores = null;
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM conhecimento');
    for (const [i, t] of trechos.entries()) {
      if (vetores) {
        await client.query(
          'INSERT INTO conhecimento (fonte, titulo, conteudo, embedding) VALUES ($1, $2, $3, $4::vector)',
          [t.fonte, t.titulo, t.conteudo, paraPgvector(vetores[i])]
        );
      } else {
        await client.query('INSERT INTO conhecimento (fonte, titulo, conteudo) VALUES ($1, $2, $3)', [
          t.fonte,
          t.titulo,
          t.conteudo,
        ]);
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  console.log(
    `[ingest] ${trechos.length} trechos de ${arquivos.length} arquivo(s) (${vetores ? 'com embeddings' : 'full-text'})`
  );
}

main()
  .catch((err) => {
    console.error('[ingest] erro:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
