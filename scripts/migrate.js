// Aplica as migrations (idempotentes) e tenta ativar o pgvector.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

async function main() {
  const arquivos = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  for (const arq of arquivos) {
    await pool.query(await readFile(path.join(dir, arq), 'utf8'));
    console.log(`[migrate] ${arq} ok`);
  }

  // pgvector é opcional: se a imagem do Postgres não tiver a extensão, seguimos com full-text.
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    await pool.query('ALTER TABLE conhecimento ADD COLUMN IF NOT EXISTS embedding vector(1024)');
    console.log('[migrate] pgvector ativo');
  } catch (err) {
    console.warn(`[migrate] pgvector indisponível (${err.message}). Busca vai usar full-text.`);
  }
}

main()
  .catch((err) => {
    console.error('[migrate] erro:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
