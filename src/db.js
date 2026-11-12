import pg from 'pg';
import { config } from './config.js';

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : false,
  max: 10,
});

// Sem isso, uma conexão ociosa derrubada pelo banco (restart, rede) derruba o processo inteiro
pool.on('error', (err) => console.error('[db] conexão perdida:', err.message));

export const query = (text, params) => pool.query(text, params);

// Descobre uma vez se o pgvector está disponível (coluna embedding existe)
let _temVetor;
export async function temVetor() {
  if (_temVetor === undefined) {
    const { rows } = await query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name = 'conhecimento' AND column_name = 'embedding'`
    );
    _temVetor = rows.length > 0;
  }
  return _temVetor;
}
