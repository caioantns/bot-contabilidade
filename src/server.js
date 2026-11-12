import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, exigir } from './config.js';
import { pool, query } from './db.js';
import * as meta from './whatsapp.js';
import * as evolution from './evolution.js';
import * as twilio from './twilio.js';
import { processarMensagem, enfileirar } from './atendimento.js';
import { definirStatus, registrarMensagem } from './conversas.js';
import { normalizarTelefone } from './telefone.js';
import { lerCsv, importarClientes } from './clientes.js';
import { listarEquipe, atualizarFuncionario } from './equipe.js';

exigir('DATABASE_URL', 'ANTHROPIC_API_KEY', 'ADMIN_TOKEN');

// ---------- Qual canal de WhatsApp está ativo ----------
const usaEvolution = config.canal === 'evolution';
const usaTwilio = config.canal === 'twilio';
const usaMeta = !usaEvolution && !usaTwilio;
const metaAtivo = usaMeta && Boolean(config.whatsapp.token && config.whatsapp.phoneNumberId && config.whatsapp.verifyToken);
const evolutionAtivo = usaEvolution && Boolean(config.evolution.url && config.evolution.apiKey && config.evolution.webhookToken);
const twilioAtivo = usaTwilio && Boolean(config.twilio.accountSid && config.twilio.authToken);
const enviarTexto = usaEvolution ? evolution.enviarTexto : usaTwilio ? twilio.enviarTexto : meta.enviarTexto;

if (usaEvolution && !evolutionAtivo) {
  console.warn('[server] Evolution API não configurada (EVOLUTION_URL, EVOLUTION_API_KEY, EVOLUTION_WEBHOOK_TOKEN). Use a página /teste.');
} else if (usaTwilio && !twilioAtivo) {
  console.warn('[server] Twilio não configurada (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN). Use a página /teste.');
} else if (usaMeta && !metaAtivo) {
  console.warn('[server] WhatsApp Cloud API não configurada. Use a página /teste.');
} else if (usaMeta && !config.whatsapp.appSecret) {
  console.warn('[server] WHATSAPP_APP_SECRET vazio: assinatura do webhook NÃO está sendo validada.');
}
console.log(`[server] canal: ${config.canal}`);

const app = express();
app.set('trust proxy', true); // atrás do proxy do Railway (https)
// Guardamos o corpo bruto para validar a assinatura da Meta
app.use(express.json({ limit: '2mb', verify: (req, _res, buf) => (req.rawBody = buf) }));
app.use(express.text({ limit: '5mb', type: ['text/csv', 'text/plain'] }));

const publico = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
app.get('/', (_req, res) => res.redirect('/teste'));
app.get('/teste', (_req, res) => res.sendFile(path.join(publico, 'teste.html')));
app.get('/health', async (_req, res) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false });
  }
});

// ---------- Webhook da Meta (WhatsApp Cloud API) ----------
app.get('/webhook', meta.verificarWebhook);

app.post('/webhook', (req, res) => {
  if (!metaAtivo) return res.sendStatus(503);
  if (!meta.assinaturaValida(req.rawBody, req.get('x-hub-signature-256'))) {
    return res.sendStatus(401);
  }
  // Responde 200 na hora; a Meta reenvia se demorarmos
  res.sendStatus(200);

  for (const msg of meta.extrairMensagens(req.body)) {
    meta.marcarComoLida(msg.id);
    enfileirar(normalizarTelefone(msg.waId), () => processarMensagem(msg, enviarTexto));
  }
});

// ---------- Webhook da Twilio ----------
app.post('/webhook/twilio', express.urlencoded({ extended: false }), (req, res) => {
  if (!twilioAtivo) return res.sendStatus(503);
  // A assinatura é calculada sobre a URL pública exata configurada no painel da Twilio
  const base = config.publicUrl || `${req.protocol}://${req.get('host')}`;
  if (!twilio.assinaturaTwilioValida(`${base}${req.originalUrl}`, req.body, req.get('x-twilio-signature'))) {
    console.warn('[twilio] assinatura inválida');
    return res.sendStatus(403);
  }
  // Responde vazio na hora; a resposta do bot vai pela API (pode levar alguns segundos)
  res.type('text/xml').send('<Response></Response>');

  const msg = twilio.extrairMensagemTwilio(req.body);
  if (msg) enfileirar(normalizarTelefone(msg.waId), () => processarMensagem(msg, enviarTexto));
});

// ---------- Webhook da Evolution API (QR code) ----------
app.post('/webhook/evolution/:token', (req, res) => {
  if (!evolutionAtivo) return res.sendStatus(503);
  if (req.params.token !== config.evolution.webhookToken) return res.sendStatus(401);
  res.sendStatus(200);

  for (const msg of evolution.extrairMensagensEvolution(req.body)) {
    evolution.marcarComoLida(msg);
    enfileirar(normalizarTelefone(msg.waId), () => processarMensagem(msg, enviarTexto));
  }
});

// ---------- Admin (provisório, até entrar o Chatwoot) ----------
function autenticarAdmin(req, res, next) {
  const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!config.adminToken || token !== config.adminToken) return res.sendStatus(401);
  next();
}

app.get('/admin/transferencias', autenticarAdmin, async (_req, res) => {
  const { rows } = await query(
    `SELECT t.id, t.setor, t.motivo, t.criado_em, t.aviso_enviado, f.nome AS funcionaria,
            c.telefone, c.nome_perfil, cl.nome AS cliente
       FROM transferencias t
       JOIN conversas c ON c.id = t.conversa_id
       LEFT JOIN clientes cl ON cl.id = c.cliente_id
       LEFT JOIN funcionarios f ON f.id = t.funcionario_id
      WHERE NOT t.resolvida
      ORDER BY t.criado_em`
  );
  res.json(rows);
});

// ---------- Equipe ----------
app.get('/admin/equipe', autenticarAdmin, async (_req, res) => {
  res.json(await listarEquipe({ apenasAtivos: false }));
});

app.put('/admin/equipe/:id', autenticarAdmin, async (req, res) => {
  const f = await atualizarFuncionario(Number(req.params.id), {
    telefone: req.body?.telefone,
    ativo: req.body?.ativo,
  });
  if (!f) return res.sendStatus(404);
  res.json(f);
});

app.get('/admin/leads', autenticarAdmin, async (_req, res) => {
  const { rows } = await query('SELECT * FROM leads ORDER BY criado_em DESC LIMIT 200');
  res.json(rows);
});

app.get('/admin/conversas/:telefone', autenticarAdmin, async (req, res) => {
  const { rows } = await query(
    `SELECT m.papel, m.conteudo, m.criado_em
       FROM mensagens m JOIN conversas c ON c.id = m.conversa_id
      WHERE c.telefone = $1 ORDER BY m.criado_em, m.id`,
    [normalizarTelefone(req.params.telefone)]
  );
  res.json(rows);
});

// Equipe responde pelo sistema (fica registrado no histórico e a IA enxerga depois)
app.post('/admin/conversas/:telefone/responder', autenticarAdmin, async (req, res) => {
  const texto = String(req.body?.texto || '').trim();
  if (!texto) return res.status(400).json({ erro: 'texto vazio' });
  const { rows } = await query('SELECT * FROM conversas WHERE telefone = $1', [normalizarTelefone(req.params.telefone)]);
  if (!rows[0]) return res.sendStatus(404);
  await enviarTexto(rows[0].wa_id, texto);
  await registrarMensagem(rows[0].id, 'humano', texto);
  res.json({ ok: true });
});

// Devolve a conversa para o bot e fecha as transferências abertas
app.post('/admin/conversas/:telefone/devolver', autenticarAdmin, async (req, res) => {
  const { rows } = await query('SELECT id FROM conversas WHERE telefone = $1', [normalizarTelefone(req.params.telefone)]);
  if (!rows[0]) return res.sendStatus(404);
  await definirStatus(rows[0].id, 'bot');
  await query('UPDATE transferencias SET resolvida = TRUE WHERE conversa_id = $1', [rows[0].id]);
  await registrarMensagem(rows[0].id, 'sistema', 'Conversa devolvida ao bot');
  res.json({ ok: true });
});

// ---------- Conexão do WhatsApp por QR code (Evolution) ----------
app.get('/admin/whatsapp/status', autenticarAdmin, async (_req, res) => {
  if (usaTwilio) return res.json({ canal: 'twilio', configurado: twilioAtivo, estado: twilioAtivo ? 'twilio' : 'twilio-pendente' });
  if (usaMeta) return res.json({ canal: 'meta', configurado: metaAtivo, estado: metaAtivo ? 'meta' : 'meta-pendente' });
  if (!evolutionAtivo) return res.json({ canal: config.canal, configurado: false });
  res.json({ canal: config.canal, configurado: true, estado: await evolution.estadoConexao() });
});

app.post('/admin/whatsapp/conectar', autenticarAdmin, async (req, res) => {
  if (!evolutionAtivo) return res.status(400).json({ erro: 'Evolution API não configurada no servidor' });
  const base = config.publicUrl || `${req.protocol}://${req.get('host')}`;
  const urlWebhook = `${base}/webhook/evolution/${config.evolution.webhookToken}`;
  res.json(await evolution.conectar(urlWebhook));
});

app.post('/admin/whatsapp/desconectar', autenticarAdmin, async (_req, res) => {
  if (!evolutionAtivo) return res.status(400).json({ erro: 'Evolution API não configurada no servidor' });
  await evolution.desconectar();
  res.json({ ok: true });
});

// Importa clientes enviando o CSV no corpo (Content-Type: text/csv)
app.post('/admin/clientes/importar', autenticarAdmin, async (req, res) => {
  const registros = lerCsv(typeof req.body === 'string' ? req.body : '');
  if (!registros.length) return res.status(400).json({ erro: 'CSV vazio ou sem cabeçalho' });
  res.json(await importarClientes(registros));
});

// ---------- Chat de teste pelo navegador (página /teste) ----------
app.post('/admin/teste/mensagem', autenticarAdmin, async (req, res) => {
  const texto = String(req.body?.texto || '').trim();
  const waId = normalizarTelefone(req.body?.telefone || '21900000000');
  if (!texto) return res.status(400).json({ erro: 'texto vazio' });

  const respostas = [];
  const avisos = [];
  // No chat de teste nada vai para o WhatsApp: respostas aparecem no painel e avisos à equipe também
  const enviar = async (destino, t) => (destino === waId ? respostas.push(t) : avisos.push({ para: destino, texto: t }));
  await enfileirar(waId, () =>
    processarMensagem(
      { id: `teste-${Date.now()}-${Math.random().toString(36).slice(2)}`, waId, nomePerfil: 'Teste', tipo: 'text', texto },
      enviar
    )
  );
  const { rows } = await query(
    `SELECT c.status, cl.nome AS cliente FROM conversas c LEFT JOIN clientes cl ON cl.id = c.cliente_id WHERE c.telefone = $1`,
    [waId]
  );
  res.json({ respostas, avisos, status: rows[0]?.status, cliente: rows[0]?.cliente ?? null });
});

app.post('/admin/teste/reset', autenticarAdmin, async (req, res) => {
  const waId = normalizarTelefone(req.body?.telefone || '21900000000');
  await query('DELETE FROM leads WHERE telefone = $1', [waId]);
  await query('DELETE FROM transferencias WHERE conversa_id IN (SELECT id FROM conversas WHERE telefone = $1)', [waId]);
  await query('DELETE FROM conversas WHERE telefone = $1', [waId]);
  res.json({ ok: true });
});

app.use((err, _req, res, _next) => {
  console.error('[server] erro:', err);
  res.status(500).json({ erro: 'erro interno' });
});

const server = app.listen(config.port, () => console.log(`[server] ouvindo na porta ${config.port}`));

process.on('SIGTERM', () => {
  server.close(() => pool.end());
});
