// Ferramentas que a IA pode chamar. Cada uma tem a definição (para a API) e o executor (seu código).
import { query } from './db.js';
import { buscarConhecimento } from './rag/busca.js';
import { definirStatus } from './conversas.js';
import { SETORES, listarEquipe, escolherFuncionario, atendimentosAbertos, textoAviso } from './equipe.js';

export const definicoes = [
  {
    name: 'consultar_base_conhecimento',
    description:
      'Busca na base de conhecimento do escritório (serviços, honorários, prazos, documentos necessários, FAQ). ' +
      'Use antes de responder qualquer pergunta específica sobre o escritório ou procedimentos.',
    input_schema: {
      type: 'object',
      properties: {
        pergunta: { type: 'string', description: 'O que procurar, em linguagem natural.' },
      },
      required: ['pergunta'],
    },
  },
  {
    name: 'registrar_lead',
    description:
      'Registra um novo interessado nos serviços. Use quando tiver ao menos o nome e a necessidade da pessoa. ' +
      'Pode chamar de novo para completar dados.',
    input_schema: {
      type: 'object',
      properties: {
        nome: { type: 'string' },
        tipo_empresa: {
          type: 'string',
          description: 'Ex.: MEI, Simples Nacional, Lucro Presumido, ainda não tem empresa, não sabe.',
        },
        necessidade: { type: 'string', description: 'Ex.: abrir empresa, trocar de contador, regularizar MEI.' },
        cidade: { type: 'string' },
        observacoes: { type: 'string', description: 'Atividade, faturamento aproximado, nº de funcionários, urgência…' },
      },
      required: ['nome', 'necessidade'],
    },
  },
  {
    name: 'transferir_para_humano',
    description:
      'Passa a conversa para a pessoa certa da equipe e avisa essa pessoa. ' +
      'Use para pedidos de documentos, casos específicos, reclamações, pedido explícito de falar com alguém, ou quando não souber responder. ' +
      'O resultado diz o nome de quem vai atender: informe esse nome ao cliente.',
    input_schema: {
      type: 'object',
      properties: {
        setor: { type: 'string', enum: Object.keys(SETORES) },
        motivo: {
          type: 'string',
          description: 'Resumo objetivo para a funcionária: o que a pessoa precisa, com detalhes (documento, competência, etc.).',
        },
        funcionario: {
          type: 'string',
          description: 'Só se o cliente pediu para falar com alguém pelo nome (ex.: "Bianca"). Senão, deixe vazio.',
        },
      },
      required: ['setor', 'motivo'],
    },
  },
];

export const executores = {
  async consultar_base_conhecimento({ pergunta }) {
    const trechos = await buscarConhecimento(pergunta, 4);
    if (!trechos.length) {
      return 'Nada encontrado na base de conhecimento. Não invente: diga que vai verificar com a equipe ou transfira.';
    }
    return trechos.map((t) => `### ${t.titulo}\n${t.conteudo}`).join('\n\n');
  },

  async registrar_lead(input, { conversa }) {
    // Um lead por conversa: atualiza se já existir
    const existente = await query('SELECT id FROM leads WHERE conversa_id = $1', [conversa.id]);
    if (existente.rows[0]) {
      await query(
        `UPDATE leads SET
            nome = COALESCE($2, nome), tipo_empresa = COALESCE($3, tipo_empresa),
            necessidade = COALESCE($4, necessidade), cidade = COALESCE($5, cidade),
            observacoes = COALESCE($6, observacoes)
          WHERE id = $1`,
        [existente.rows[0].id, input.nome, input.tipo_empresa, input.necessidade, input.cidade, input.observacoes]
      );
      return 'Lead atualizado.';
    }
    await query(
      `INSERT INTO leads (conversa_id, telefone, nome, tipo_empresa, necessidade, cidade, observacoes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [conversa.id, conversa.telefone, input.nome, input.tipo_empresa, input.necessidade, input.cidade, input.observacoes]
    );
    return 'Lead registrado. Agora transfira para o setor certo (legalizacao para abrir empresa/MEI; geral para os demais).';
  },

  async transferir_para_humano({ setor, motivo, funcionario: nomePedido }, { conversa, cliente, enviar }) {
    const equipe = await listarEquipe();
    const escolhida = escolherFuncionario({
      equipe,
      setor,
      nomePedido,
      responsavelCliente: cliente?.responsavel,
      abertosPorId: await atendimentosAbertos(),
    });
    const setorFinal = escolhida?.setor ?? setor;

    const { rows } = await query(
      'INSERT INTO transferencias (conversa_id, setor, motivo, funcionario_id) VALUES ($1, $2, $3, $4) RETURNING id',
      [conversa.id, setorFinal, motivo, escolhida?.id ?? null]
    );
    await definirStatus(conversa.id, 'humano');

    // Avisa a funcionária no WhatsApp dela (se o telefone estiver cadastrado)
    let avisada = false;
    if (escolhida?.telefone && enviar) {
      try {
        await enviar(
          escolhida.telefone,
          textoAviso({ funcionario: escolhida, setor: setorFinal, motivo, conversa, cliente, transferenciaId: rows[0].id })
        );
        await query('UPDATE transferencias SET aviso_enviado = TRUE WHERE id = $1', [rows[0].id]);
        avisada = true;
      } catch (err) {
        console.error(`[transferência] falha ao avisar ${escolhida.nome}:`, err.message);
      }
    }
    console.log(
      `[transferência] conversa ${conversa.id} → ${SETORES[setorFinal] ?? setorFinal}` +
        `${escolhida ? ` / ${escolhida.nome}${avisada ? ' (avisada)' : ' (sem aviso: telefone não cadastrado)'}` : ''}`
    );

    const area = SETORES[setorFinal] ?? setorFinal;
    if (escolhida) {
      return (
        `Transferido para ${escolhida.nome} (${area}). Diga ao cliente que ${escolhida.nome.split(' ')[0]}, do ${area}, ` +
        'vai continuar o atendimento e entrar em contato (se for fora do horário, no próximo horário de atendimento). Não faça mais perguntas nesta resposta.'
      );
    }
    return `Transferido para a equipe (${area}). Avise que a equipe vai continuar o atendimento (e quando, se for fora do horário). Não faça mais perguntas nesta resposta.`;
  },
};
