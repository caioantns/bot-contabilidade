// Loop da IA com tool use: o modelo pede ferramentas, nosso código executa, devolvemos o resultado.
import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';
import { montarPrompt } from './prompt.js';
import { definicoes, executores } from './ferramentas.js';
import { listarEquipe } from './equipe.js';

const MAX_RODADAS = 6;
let client;

export async function responder({ conversa, cliente, mensagens, enviar }) {
  client ??= new Anthropic({ apiKey: config.anthropicApiKey });
  const equipe = await listarEquipe().catch(() => []);
  const system = montarPrompt({ cliente, conversa, equipe });
  const ctx = { conversa, cliente, enviar };
  const msgs = [...mensagens];

  let tentativasVazias = 0;
  for (let rodada = 0; rodada < MAX_RODADAS; rodada++) {
    const resp = await client.messages.create({
      model: config.anthropicModel,
      max_tokens: 4096,
      system,
      tools: definicoes,
      messages: msgs,
    });

    if (resp.stop_reason !== 'tool_use') {
      const texto = textoDe(resp);
      if (texto) return texto;

      // Resposta sem texto: registra o motivo e tenta mais uma vez pedindo explicitamente uma resposta
      console.warn(
        `[agente] resposta vazia (stop_reason=${resp.stop_reason}, blocos=${resp.content.map((b) => b.type).join(',') || 'nenhum'}, ` +
          `saída=${resp.usage?.output_tokens} tokens)`
      );
      if (tentativasVazias++ >= 1) break;
      const lembrete =
        '[Mensagem do sistema, não do cliente] Sua última resposta veio vazia. Responda agora ao cliente, em texto, ' +
        'à última mensagem dele. Se for um pedido para a equipe, use transferir_para_humano.';
      // Blocos de texto vazios não podem voltar para a API
      const conteudoUtil = resp.content.filter((b) => !(b.type === 'text' && !b.text.trim()));
      if (conteudoUtil.length) {
        msgs.push({ role: 'assistant', content: conteudoUtil });
        msgs.push({ role: 'user', content: lembrete });
      } else {
        acrescentarAoUltimoUsuario(msgs, lembrete);
      }
      continue;
    }

    // Executa todas as ferramentas pedidas nesta rodada
    msgs.push({ role: 'assistant', content: resp.content });
    const resultados = [];
    for (const bloco of resp.content.filter((b) => b.type === 'tool_use')) {
      const executor = executores[bloco.name];
      let conteudo;
      let is_error = false;
      try {
        if (!executor) throw new Error(`Ferramenta desconhecida: ${bloco.name}`);
        conteudo = await executor(bloco.input, ctx);
      } catch (err) {
        console.error(`[agente] erro em ${bloco.name}:`, err);
        conteudo = `Erro ao executar: ${err.message}`;
        is_error = true;
      }
      resultados.push({ type: 'tool_result', tool_use_id: bloco.id, content: String(conteudo), is_error });
    }
    msgs.push({ role: 'user', content: resultados });
  }

  return 'Desculpe, tive um problema para responder agora. Pode me mandar sua mensagem de novo, por favor?';
}

function acrescentarAoUltimoUsuario(msgs, texto) {
  const ultima = msgs[msgs.length - 1];
  if (ultima?.role !== 'user') return msgs.push({ role: 'user', content: texto });
  if (typeof ultima.content === 'string') ultima.content += `\n\n${texto}`;
  else ultima.content = [...ultima.content, { type: 'text', text: texto }];
}

function textoDe(resp) {
  return resp.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}
