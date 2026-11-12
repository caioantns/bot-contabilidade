// Importação de clientes (usada pelo script de terminal e pela rota /admin/clientes/importar).
import { pool } from './db.js';
import { normalizarTelefone } from './telefone.js';

// CSV separado por ; ou , com cabeçalho na 1ª linha:
//   nome;cnpj;regime;responsavel;email;telefone;contato
export function lerCsv(texto) {
  const linhas = String(texto).replace(/^﻿/, '').replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim());
  if (!linhas.length) return [];
  const sep = linhas[0].includes(';') ? ';' : ',';
  const cab = linhas[0].split(sep).map((c) => c.trim().toLowerCase());
  return linhas.slice(1).map((l) => {
    const cols = l.split(sep).map((c) => c.trim().replace(/^"|"$/g, ''));
    return Object.fromEntries(cab.map((c, i) => [c, cols[i] ?? '']));
  });
}

export async function importarClientes(registros) {
  let empresas = 0;
  let telefones = 0;
  for (const r of registros) {
    if (!r.nome) continue;
    const cnpj = (r.cnpj || '').replace(/\D/g, '') || null;
    const { rows } = await pool.query(
      `INSERT INTO clientes (nome, cnpj, regime, responsavel, email)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (cnpj) DO UPDATE SET
         nome = EXCLUDED.nome, regime = EXCLUDED.regime,
         responsavel = EXCLUDED.responsavel, email = EXCLUDED.email
       RETURNING id, (xmax = 0) AS novo`,
      [r.nome, cnpj, r.regime || null, r.responsavel || null, r.email || null]
    );
    if (rows[0].novo) empresas++;

    const tel = normalizarTelefone(r.telefone);
    if (tel) {
      await pool.query(
        `INSERT INTO cliente_telefones (cliente_id, telefone, contato) VALUES ($1, $2, $3)
         ON CONFLICT (telefone) DO UPDATE SET cliente_id = EXCLUDED.cliente_id, contato = EXCLUDED.contato`,
        [rows[0].id, tel, r.contato || null]
      );
      telefones++;
    }
  }
  return { empresas, telefones };
}
