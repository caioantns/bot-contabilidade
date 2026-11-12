// Orquestra o atendimento de uma mensagem recebida.
import { config } from './config.js';
import { obterConversa, registrarMensagem, historico } from './conversas.js';
import { responder } from './agente.js';
import { mascararTelefone } from './telefone.js';
import {
  comandoFim,
  pediuMenu,
  funcionarioPorTelefone,
  finalizarPorComando,
  transferenciaAberta,
  expirou,
  devolverAoBot,
  deveAvisarEspera,
  marcarEsperaAvisada,
  textoEspera,
} from './retorno.js';

const TIPOS_SUPORTADOS = new Set(['text', 'button', 'interactive']);

// Fila por telefone: mensagens do mesmo cliente são processadas em ordem, uma por vez
const filas = new Map();
export function enfileirar(chave, tarefa) {
  const anterior = filas.get(chave) ?? Promise.resolve();
  const atual = anterior.then(tarefa).catch((err) => console.error('[atendimento] erro:', err));
  filas.set(chave, atual);
  atual.finally(() => {
    if (filas.get(chave) === atual) filas.delete(chave);
  });
  return atual;
}

/**
 * @param msg     { id, waId, nomePerfil, tipo, texto }
 * @param enviar  async (waId, texto) => void   (WhatsApp em produção, console no chat de teste)
 */
export async function processarMensagem(msg, enviar) {
  const tag = `[${mascararTelefone(msg.waId)}]`;

  // Funcionária encerrando um atendimento: "fim 12"
  const idFim = comandoFim(msg.texto);
  if (idFim) {
    const funcionaria = await funcionarioPorTelefone(msg.waId);
    if (funcionaria) {
      await enviar(msg.waId, await finalizarPorComando(idFim, funcionaria, enviar));
      return;
    }
  }

  const { conversa, cliente } = await obterConversa(msg);

  const conteudo = msg.texto || `[${msg.tipo} sem texto]`;
  const nova = await registrarMensagem(conversa.id, 'cliente', conteudo, msg.id);
  if (!nova) return; // duplicada

  // Conversa está com a equipe
  if (conversa.status === 'humano') {
    const transferencia = await transferenciaAberta(conversa.id);
    if (pediuMenu(msg.texto) || expirou(transferencia)) {
      await devolverAoBot(conversa.id);
      console.log(`${tag} conversa voltou para o bot (${pediuMenu(msg.texto) ? 'cliente pediu menu' : 'tempo esgotado'})`);
    } else {
      if (await deveAvisarEspera(conversa)) {
        const espera = textoEspera(transferencia);
        await registrarMensagem(conversa.id, 'bot', espera);
        await enviar(msg.waId, espera);
        await marcarEsperaAvisada(conversa.id);
      }
      console.log(`${tag} conversa com a equipe, bot aguardando`);
      return;
    }
  }

  if (!TIPOS_SUPORTADOS.has(msg.tipo) && !msg.texto) {
    const aviso =
      'Por enquanto eu consigo ler apenas mensagens de texto 🙂 Pode me escrever o que precisa? ' +
      'Se for enviar um documento para a equipe, me avise que eu chamo alguém.';
    await registrarMensagem(conversa.id, 'bot', aviso);
    await enviar(msg.waId, aviso);
    return;
  }

  const mensagens = await historico(conversa.id, config.historicoMax);
  const inicio = Date.now();
  let resposta;
  try {
    resposta = await responder({ conversa, cliente, mensagens, enviar });
  } catch (err) {
    console.error(`${tag} falha na IA:`, err);
    resposta =
      'Desculpe, tive um problema técnico agora. Já registrei aqui e alguém da equipe vai te responder em breve.';
  }
  console.log(`${tag} respondido em ${Date.now() - inicio}ms`);

  await registrarMensagem(conversa.id, 'bot', resposta);
  await enviar(msg.waId, resposta);
}
