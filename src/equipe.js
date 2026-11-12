// Equipe do escritório e regra de quem recebe cada atendimento.
import { query } from './db.js';
import { normalizarTelefone } from './telefone.js';

export const SETORES = {
  fiscal: 'Fiscal',
  contabil: 'Contábil',
  dp: 'Departamento Pessoal',
  legalizacao: 'Legalização',
  financeiro: 'Financeiro',
  geral: 'Atendimento',
};

export async function listarEquipe({ apenasAtivos = true } = {}) {
  const { rows } = await query(
    `SELECT id, nome, setor, telefone, ativo FROM funcionarios ${apenasAtivos ? 'WHERE ativo' : ''} ORDER BY setor, nome`
  );
  return rows;
}

// Compara nomes ignorando acentos e maiúsculas ("taise" acha "Taíse Bastos")
export const semAcento = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

export function acharPorNome(equipe, nome) {
  const alvo = semAcento(nome);
  if (!alvo) return null;
  return (
    equipe.find((f) => semAcento(f.nome) === alvo) ??
    equipe.find((f) => semAcento(f.nome).split(' ')[0] === alvo.split(' ')[0]) ??
    null
  );
}

/**
 * Escolhe quem atende:
 * 1) a pessoa que o cliente pediu pelo nome (se existir na equipe);
 * 2) o responsável cadastrado do cliente, se for do setor;
 * 3) quem do setor tem menos atendimentos em aberto (divide entre Bianca e Taíse, por exemplo).
 * Devolve null se o setor não tiver ninguém cadastrado.
 */
export function escolherFuncionario({ equipe, setor, nomePedido, responsavelCliente, abertosPorId = {} }) {
  const pedida = acharPorNome(equipe, nomePedido);
  if (pedida) return pedida;

  const doSetor = equipe.filter((f) => f.setor === setor);
  if (!doSetor.length) return null;

  const responsavel = acharPorNome(doSetor, responsavelCliente);
  if (responsavel) return responsavel;

  return [...doSetor].sort((a, b) => (abertosPorId[a.id] ?? 0) - (abertosPorId[b.id] ?? 0) || a.id - b.id)[0];
}

export async function atendimentosAbertos() {
  const { rows } = await query(
    `SELECT funcionario_id, count(*)::int AS n FROM transferencias
      WHERE NOT resolvida AND funcionario_id IS NOT NULL GROUP BY funcionario_id`
  );
  return Object.fromEntries(rows.map((r) => [r.funcionario_id, r.n]));
}

export async function atualizarFuncionario(id, { telefone, ativo }) {
  const tel = telefone === undefined ? undefined : normalizarTelefone(telefone) || null;
  const { rows } = await query(
    `UPDATE funcionarios SET
        telefone = CASE WHEN $2::boolean THEN $3 ELSE telefone END,
        ativo = COALESCE($4, ativo)
      WHERE id = $1 RETURNING *`,
    [id, tel !== undefined, tel ?? null, typeof ativo === 'boolean' ? ativo : null]
  );
  return rows[0] ?? null;
}

// Texto do aviso que a funcionária recebe no WhatsApp dela
export function textoAviso({ funcionario, setor, motivo, conversa, cliente, transferenciaId }) {
  const quem = cliente
    ? `${cliente.contato || conversa.nome_perfil || 'Cliente'} — ${cliente.nome}`
    : `${conversa.nome_perfil || 'Novo contato'} (ainda não é cliente)`;
  return [
    `🔔 *Novo atendimento para você, ${funcionario.nome.split(' ')[0]}*`,
    `Setor: ${SETORES[setor] ?? setor}`,
    `Quem: ${quem}`,
    `WhatsApp: +${conversa.telefone}`,
    '',
    `*Pedido:* ${motivo}`,
    '',
    'O bot já avisou que você vai continuar o atendimento.',
    ...(transferenciaId ? ['', `Quando terminar, responda aqui: *fim ${transferenciaId}*`, '(o cliente volta a ser atendido pelo bot)'] : []),
  ].join('\n');
}
