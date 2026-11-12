// Integração com a WhatsApp Cloud API (Meta): validar webhook, extrair mensagens, enviar respostas.
import crypto from 'node:crypto';
import { config } from './config.js';
import { normalizarTelefone } from './telefone.js';

const wa = config.whatsapp;
const graphUrl = () => `https://graph.facebook.com/${wa.graphVersion}/${wa.phoneNumberId}/messages`;

// GET /webhook — a Meta chama uma vez para confirmar que o endpoint é seu
export function verificarWebhook(req, res) {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  if (mode === 'subscribe' && token && token === wa.verifyToken) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
}

// Confere o header X-Hub-Signature-256 (HMAC do corpo com o App Secret)
export function assinaturaValida(rawBody, header) {
  if (!wa.appSecret) return true; // sem segredo configurado (só em desenvolvimento)
  if (!header || !rawBody) return false;
  const esperado = 'sha256=' + crypto.createHmac('sha256', wa.appSecret).update(rawBody).digest('hex');
  const a = Buffer.from(esperado);
  const b = Buffer.from(header);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Transforma o payload do webhook numa lista simples de mensagens recebidas
export function extrairMensagens(body) {
  const saida = [];
  for (const entry of body?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      const contatos = value.contacts ?? [];
      for (const msg of value.messages ?? []) {
        const contato = contatos.find((c) => c.wa_id === msg.from) ?? contatos[0];
        saida.push({
          id: msg.id,
          waId: msg.from,
          nomePerfil: contato?.profile?.name ?? null,
          tipo: msg.type,
          texto: textoDaMensagem(msg),
          timestamp: Number(msg.timestamp) * 1000,
        });
      }
    }
  }
  return saida;
}

function textoDaMensagem(msg) {
  switch (msg.type) {
    case 'text':
      return msg.text?.body ?? '';
    case 'button':
      return msg.button?.text ?? '';
    case 'interactive':
      return msg.interactive?.button_reply?.title ?? msg.interactive?.list_reply?.title ?? '';
    case 'image':
    case 'document':
    case 'video':
      // Legenda, se houver. O arquivo em si fica pra próxima etapa.
      return msg[msg.type]?.caption ?? '';
    default:
      return '';
  }
}

async function chamarGraph(payload) {
  const res = await fetch(graphUrl(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${wa.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
  });
  if (!res.ok) {
    const erro = await res.text();
    throw new Error(`WhatsApp API ${res.status}: ${erro}`);
  }
  return res.json();
}

// A Meta entrega números brasileiros às vezes SEM o 9 (ex.: 552199998888). Respondendo assim, o envio
// falha no modo de teste ("recipient not in allowed list"). Com o 9 funciona sempre.
export const destinatario = (waId) => (String(waId).startsWith('55') ? normalizarTelefone(waId) : String(waId));

// WhatsApp limita texto a 4096 caracteres; quebramos em partes se precisar
export async function enviarTexto(waId, texto) {
  for (const parte of dividirTexto(texto, 4000)) {
    await chamarGraph({ to: destinatario(waId), type: 'text', text: { body: parte, preview_url: false } });
  }
}

export async function marcarComoLida(messageId) {
  try {
    await chamarGraph({ status: 'read', message_id: messageId });
  } catch {
    /* não é crítico */
  }
}

// Envio de documento por link (usado na etapa de documentos)
export async function enviarDocumento(waId, { link, nomeArquivo, legenda }) {
  return chamarGraph({
    to: destinatario(waId),
    type: 'document',
    document: { link, filename: nomeArquivo, caption: legenda },
  });
}

export function dividirTexto(texto, limite) {
  if (texto.length <= limite) return [texto];
  const partes = [];
  let resto = texto;
  while (resto.length > limite) {
    let corte = resto.lastIndexOf('\n', limite);
    if (corte < limite * 0.5) corte = resto.lastIndexOf(' ', limite);
    if (corte <= 0) corte = limite;
    partes.push(resto.slice(0, corte).trim());
    resto = resto.slice(corte).trim();
  }
  if (resto) partes.push(resto);
  return partes;
}
