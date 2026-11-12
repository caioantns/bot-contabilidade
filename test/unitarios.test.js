import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.WHATSAPP_APP_SECRET = 'segredo-teste';

const { normalizarTelefone } = await import('../src/telefone.js');
const { dividirMarkdown } = await import('../src/rag/trechos.js');
const { montarTsquery } = await import('../src/rag/busca.js');
const { extrairMensagens, assinaturaValida, dividirTexto } = await import('../src/whatsapp.js');
const { lerCsv } = await import('../scripts/importar-clientes.js');
const { dentroDoHorario } = await import('../src/prompt.js');

test('normaliza telefones brasileiros', () => {
  assert.equal(normalizarTelefone('5521999998888'), '5521999998888');
  assert.equal(normalizarTelefone('552199998888'), '5521999998888'); // WhatsApp sem o 9
  assert.equal(normalizarTelefone('(21) 99999-8888'), '5521999998888');
  assert.equal(normalizarTelefone('2133334444'), '552133334444'); // fixo não ganha 9
  assert.equal(normalizarTelefone(''), '');
});

test('divide markdown por seções e ignora comentários', () => {
  const md = '# FAQ\n<!-- nota interna -->\n## Pergunta A\nResposta A\n## Pergunta B\nResposta B';
  const t = dividirMarkdown(md, 'faq.md');
  assert.equal(t.length, 2);
  assert.equal(t[0].titulo, 'FAQ — Pergunta A');
  assert.equal(t[1].conteudo, 'Resposta B');
  assert.ok(!t.some((x) => x.conteudo.includes('nota interna')));
});

test('monta tsquery segura com OU', () => {
  assert.equal(montarTsquery('Quando vence o DAS?!'), 'quando | vence | das');
  assert.equal(montarTsquery("'; DROP TABLE x; --"), 'drop | table');
  assert.equal(montarTsquery('a b'), '');
});

test('extrai mensagens do webhook', () => {
  const body = {
    entry: [{ changes: [{ value: {
      contacts: [{ wa_id: '552199998888', profile: { name: 'Carlos' } }],
      messages: [{ id: 'wamid.1', from: '552199998888', timestamp: '1700000000', type: 'text', text: { body: 'Oi' } }],
    } }] }],
  };
  const [m] = extrairMensagens(body);
  assert.equal(m.texto, 'Oi');
  assert.equal(m.nomePerfil, 'Carlos');
  assert.equal(m.waId, '552199998888');
  // Notificações de status (sem messages) não geram nada
  assert.equal(extrairMensagens({ entry: [{ changes: [{ value: { statuses: [{}] } }] }] }).length, 0);
});

test('valida assinatura da Meta', () => {
  const corpo = Buffer.from('{"a":1}');
  const assinatura = 'sha256=' + crypto.createHmac('sha256', 'segredo-teste').update(corpo).digest('hex');
  assert.equal(assinaturaValida(corpo, assinatura), true);
  assert.equal(assinaturaValida(corpo, 'sha256=errado'), false);
  assert.equal(assinaturaValida(corpo, undefined), false);
});

test('divide textos longos para o WhatsApp', () => {
  const longo = 'palavra '.repeat(1200);
  const partes = dividirTexto(longo, 4000);
  assert.ok(partes.length >= 2);
  assert.ok(partes.every((p) => p.length <= 4000));
});

test('lê CSV com ponto e vírgula', () => {
  const r = lerCsv('nome;cnpj;telefone\nPadaria;12.345;(21) 99999-0001\n');
  assert.deepEqual(r, [{ nome: 'Padaria', cnpj: '12.345', telefone: '(21) 99999-0001' }]);
});

test('horário de atendimento (Brasília)', () => {
  assert.equal(dentroDoHorario(new Date('2026-11-10T13:00:00Z')), true); // terça 10h
  assert.equal(dentroDoHorario(new Date('2026-11-10T23:00:00Z')), false); // terça 20h
  assert.equal(dentroDoHorario(new Date('2026-11-08T13:00:00Z')), false); // domingo
});

const { extrairMensagensEvolution } = await import('../src/evolution.js');

test('extrai mensagens da Evolution API', () => {
  const agora = 1_700_000_000_000;
  const base = (key, message, extra = {}) => ({
    event: 'messages.upsert',
    instance: 'contabilidade',
    data: { key, pushName: 'Carlos', message, messageTimestamp: agora / 1000, ...extra },
  });

  const [m] = extrairMensagensEvolution(base({ remoteJid: '552199990001@s.whatsapp.net', fromMe: false, id: 'A1' }, { conversation: 'Oi' }), agora);
  assert.equal(m.waId, '552199990001');
  assert.equal(m.texto, 'Oi');
  assert.equal(m.tipo, 'text');

  const [m2] = extrairMensagensEvolution(base({ remoteJid: '1@s.whatsapp.net', id: 'A2' }, { extendedTextMessage: { text: 'link' } }), agora);
  assert.equal(m2.texto, 'link');

  // LID: usa o número de remoteJidAlt
  const [m3] = extrairMensagensEvolution(base({ remoteJid: '123456@lid', remoteJidAlt: '5521988880003@s.whatsapp.net', id: 'A3' }, { conversation: 'x' }), agora);
  assert.equal(m3.waId, '5521988880003');

  // Ignorados: enviadas por nós, grupos, status, antigas, outros eventos
  assert.equal(extrairMensagensEvolution(base({ remoteJid: '1@s.whatsapp.net', fromMe: true, id: 'B' }, { conversation: 'x' }), agora).length, 0);
  assert.equal(extrairMensagensEvolution(base({ remoteJid: '1@g.us', id: 'C' }, { conversation: 'x' }), agora).length, 0);
  assert.equal(extrairMensagensEvolution(base({ remoteJid: 'status@broadcast', id: 'D' }, { conversation: 'x' }), agora).length, 0);
  assert.equal(extrairMensagensEvolution(base({ remoteJid: '1@s.whatsapp.net', id: 'E' }, { conversation: 'x' }, { messageTimestamp: agora / 1000 - 600 }), agora).length, 0);
  assert.equal(extrairMensagensEvolution({ event: 'connection.update', data: {} }, agora).length, 0);

  const [audio] = extrairMensagensEvolution(base({ remoteJid: '1@s.whatsapp.net', id: 'F' }, { audioMessage: {} }), agora);
  assert.equal(audio.tipo, 'audio');
  assert.equal(audio.texto, '');
});
