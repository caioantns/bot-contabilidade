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

  for (let rodada = 0; rodada < MAX_RODADAS; rodada++) {
    const resp = await client.messages.create({
      model: config.anthropicModel,
      max_tokens: 1024,
      system,
      tools: definicoes,
      messages: msgs,
    });

    if (resp.stop_reason !== 'tool_use') {
      const texto = resp.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      return texto || 'Desculpe, não consegui entender. Pode reformular?';
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

  return 'Vou pedir para alguém da equipe continuar seu atendimento, tudo bem? Já já te respondem por aqui.';
}
