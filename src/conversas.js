// Persistência de conversas, mensagens e identificação do cliente.
import { query } from './db.js';
import { normalizarTelefone } from './telefone.js';

export async function buscarClientePorTelefone(telefone) {
  const { rows } = await query(
    `SELECT c.id, c.nome, c.cnpj, c.regime, c.responsavel, ct.contato
       FROM cliente_telefones ct
       JOIN clientes c ON c.id = ct.cliente_id
      WHERE ct.telefone = $1 AND c.ativo`,
    [normalizarTelefone(telefone)]
  );
  return rows[0] ?? null;
}

// Cria ou atualiza a conversa do telefone e já vincula ao cliente, se for da base
export async function obterConversa({ waId, nomePerfil }) {
  const telefone = normalizarTelefone(waId);
  const cliente = await buscarClientePorTelefone(telefone);
  const { rows } = await query(
    `INSERT INTO conversas (telefone, wa_id, nome_perfil, cliente_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (telefone) DO UPDATE
        SET wa_id = EXCLUDED.wa_id,
            nome_perfil = COALESCE(EXCLUDED.nome_perfil, conversas.nome_perfil),
            cliente_id = EXCLUDED.cliente_id,
            atualizado_em = now()
     RETURNING *`,
    [telefone, waId, nomePerfil, cliente?.id ?? null]
  );
  return { conversa: rows[0], cliente };
}

// Retorna false se a mensagem já foi registrada (a Meta reenvia webhooks)
export async function registrarMensagem(conversaId, papel, conteudo, waMessageId = null) {
  const { rowCount } = await query(
    `INSERT INTO mensagens (conversa_id, papel, conteudo, wa_message_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (wa_message_id) DO NOTHING`,
    [conversaId, papel, conteudo, waMessageId]
  );
  return rowCount > 0;
}

// Histórico no formato da API do Claude (só cliente ↔ bot/humano)
export async function historico(conversaId, limite) {
  const { rows } = await query(
    `SELECT papel, conteudo FROM (
        SELECT papel, conteudo, criado_em, id FROM mensagens
         WHERE conversa_id = $1 AND papel IN ('cliente','bot','humano')
         ORDER BY criado_em DESC, id DESC
         LIMIT $2
     ) t ORDER BY criado_em, id`,
    [conversaId, limite]
  );

  // A API exige alternância user/assistant começando por user: juntamos mensagens seguidas do mesmo lado
  const msgs = [];
  for (const r of rows) {
    const role = r.papel === 'cliente' ? 'user' : 'assistant';
    const texto = r.papel === 'humano' ? `[Atendente humano]: ${r.conteudo}` : r.conteudo;
    const ultima = msgs[msgs.length - 1];
    if (ultima?.role === role) ultima.content += `\n${texto}`;
    else msgs.push({ role, content: texto });
  }
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  return msgs;
}

export async function definirStatus(conversaId, status) {
  await query('UPDATE conversas SET status = $2, atualizado_em = now() WHERE id = $1', [conversaId, status]);
}
