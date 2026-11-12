// Ferramentas que a IA pode chamar. Cada uma tem a definição (para a API) e o executor (seu código).
import { query } from './db.js';
import { buscarConhecimento } from './rag/busca.js';
import { definirStatus } from './conversas.js';

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
      'Passa a conversa para a equipe. Depois de chamar, o bot para de responder esta conversa até a equipe devolver. ' +
      'Use para pedidos de documentos, casos específicos, reclamações, pedido explícito de falar com pessoa, ou quando não souber responder.',
    input_schema: {
      type: 'object',
      properties: {
        setor: { type: 'string', enum: ['comercial', 'fiscal', 'dp', 'financeiro', 'geral'] },
        motivo: {
          type: 'string',
          description: 'Resumo objetivo para a equipe: o que a pessoa precisa, com detalhes (documento, competência, etc.).',
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
    return 'Lead registrado. A equipe comercial vai entrar em contato.';
  },

  async transferir_para_humano({ setor, motivo }, { conversa }) {
    await query('INSERT INTO transferencias (conversa_id, setor, motivo) VALUES ($1, $2, $3)', [
      conversa.id,
      setor,
      motivo,
    ]);
    await definirStatus(conversa.id, 'humano');
    console.log(`[transferência] conversa ${conversa.id} → ${setor}: ${motivo}`);
    return 'Transferido. Avise a pessoa que a equipe vai continuar o atendimento por aqui (e quando, se for fora do horário). Não faça mais perguntas.';
  },
};
