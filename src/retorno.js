// Como uma conversa transferida volta para o bot:
//  1) a funcionária manda "fim 12" para o número do bot;
//  2) o cliente digita "menu";
//  3) automaticamente, depois de X horas da transferência.
import { config } from './config.js';
import { query } from './db.js';
import { normalizarTelefone } from './telefone.js';
import { SETORES } from './equipe.js';

export function comandoFim(texto) {
  const m = String(texto || '').match(/^\s*(fim|finalizar|finalizado|encerrar|encerrado)\s*#?\s*(\d+)\s*[.!]?\s*$/i);
  return m ? Number(m[2]) : null;
}

export function pediuMenu(texto) {
  return /^\s*(menu|voltar|bot|in[ií]cio|reiniciar|recome[cç]ar)\s*[.!]?\s*$/i.test(String(texto || ''));
}

export async function funcionarioPorTelefone(telefone) {
  const { rows } = await query('SELECT * FROM funcionarios WHERE ativo AND telefone = $1 LIMIT 1', [normalizarTelefone(telefone)]);
  return rows[0] ?? null;
}

export async function devolverAoBot(conversaId) {
  await query(`UPDATE conversas SET status = 'bot', espera_avisada_em = NULL, atualizado_em = now() WHERE id = $1`, [conversaId]);
  await query('UPDATE transferencias SET resolvida = TRUE WHERE conversa_id = $1 AND NOT resolvida', [conversaId]);
  await query(`INSERT INTO mensagens (conversa_id, papel, conteudo) VALUES ($1, 'sistema', 'Conversa devolvida ao bot')`, [conversaId]);
}

// Última transferência em aberto da conversa, com o nome de quem está atendendo
export async function transferenciaAberta(conversaId) {
  const { rows } = await query(
    `SELECT t.id, t.setor, t.criado_em, f.nome AS funcionaria
       FROM transferencias t LEFT JOIN funcionarios f ON f.id = t.funcionario_id
      WHERE t.conversa_id = $1 AND NOT t.resolvida
      ORDER BY t.criado_em DESC LIMIT 1`,
    [conversaId]
  );
  return rows[0] ?? null;
}

export function expirou(transferencia, agora = Date.now()) {
  if (!transferencia) return true; // em modo humano sem transferência aberta: devolve
  const horas = config.retornoAutomaticoHoras;
  return horas > 0 && agora - new Date(transferencia.criado_em).getTime() > horas * 3600 * 1000;
}

/**
 * Funcionária mandou "fim 12". Fecha o atendimento e avisa o cliente.
 * Devolve o texto de confirmação para a funcionária, ou null se o código não existir.
 */
export async function finalizarPorComando(id, funcionaria, enviar) {
  const { rows } = await query(
    `SELECT t.id, t.resolvida, c.id AS conversa_id, c.wa_id, c.nome_perfil
       FROM transferencias t JOIN conversas c ON c.id = t.conversa_id WHERE t.id = $1`,
    [id]
  );
  const t = rows[0];
  if (!t) return `Não encontrei o atendimento *${id}*. Confira o código no aviso.`;
  if (t.resolvida) return `O atendimento *${id}* já estava finalizado.`;

  await devolverAoBot(t.conversa_id);
  const primeiroNome = funcionaria.nome.split(' ')[0];
  const textoCliente = `Seu atendimento com ${primeiroNome} foi finalizado. Se precisar de mais alguma coisa, é só me mandar mensagem por aqui 😊`;
  try {
    await enviar(t.wa_id, textoCliente);
    await query(`INSERT INTO mensagens (conversa_id, papel, conteudo) VALUES ($1, 'bot', $2)`, [t.conversa_id, textoCliente]);
  } catch (err) {
    console.error('[retorno] falha ao avisar o cliente:', err.message);
  }
  console.log(`[retorno] atendimento ${id} finalizado por ${funcionaria.nome}`);
  return `✅ Atendimento *${id}* finalizado${t.nome_perfil ? ` (${t.nome_perfil})` : ''}. O cliente voltou a ser atendido pelo bot.`;
}

export function textoEspera(transferencia) {
  const quem = transferencia?.funcionaria
    ? `com ${transferencia.funcionaria.split(' ')[0]}, do ${SETORES[transferencia.setor] ?? transferencia.setor}`
    : 'com a nossa equipe';
  return (
    `Seu atendimento está ${quem}, que vai falar com você em breve. ` +
    'Se quiser tratar de outro assunto comigo, é só digitar *menu*.'
  );
}

// Só repete o aviso de espera depois de 2 horas
export async function deveAvisarEspera(conversa, agora = Date.now()) {
  return !conversa.espera_avisada_em || agora - new Date(conversa.espera_avisada_em).getTime() > 2 * 3600 * 1000;
}

export async function marcarEsperaAvisada(conversaId) {
  await query('UPDATE conversas SET espera_avisada_em = now() WHERE id = $1', [conversaId]);
}
