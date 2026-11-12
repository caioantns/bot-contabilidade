// Integração com a Evolution API (WhatsApp por QR code).
// Docs: https://docs.evolutionfoundation.com.br/
import { config } from './config.js';

const evo = config.evolution;

async function chamar(metodo, caminho, corpo) {
  const res = await fetch(`${evo.url.replace(/\/$/, '')}${caminho}`, {
    method: metodo,
    headers: { apikey: evo.apiKey, 'Content-Type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const texto = await res.text();
  let json;
  try {
    json = texto ? JSON.parse(texto) : {};
  } catch {
    json = { bruto: texto };
  }
  if (!res.ok) {
    const erro = new Error(`Evolution API ${res.status} em ${caminho}: ${texto.slice(0, 300)}`);
    erro.status = res.status;
    throw erro;
  }
  return json;
}

// ---------- Recebimento ----------

const MAX_IDADE_MS = 2 * 60 * 1000; // ignora mensagens antigas reenviadas ao reconectar

function textoDaMensagem(m = {}) {
  return (
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    m.documentMessage?.caption ??
    m.documentWithCaptionMessage?.message?.documentMessage?.caption ??
    m.buttonsResponseMessage?.selectedDisplayText ??
    m.listResponseMessage?.title ??
    m.templateButtonReplyMessage?.selectedDisplayText ??
    ''
  );
}

function tipoDaMensagem(m = {}) {
  if (m.conversation !== undefined || m.extendedTextMessage) return 'text';
  if (m.buttonsResponseMessage || m.listResponseMessage || m.templateButtonReplyMessage) return 'interactive';
  if (m.audioMessage) return 'audio';
  if (m.imageMessage) return 'image';
  if (m.videoMessage) return 'video';
  if (m.documentMessage || m.documentWithCaptionMessage) return 'document';
  if (m.stickerMessage) return 'sticker';
  if (m.locationMessage) return 'location';
  if (m.contactMessage) return 'contacts';
  return 'desconhecido';
}

// Contas com "LID" (privacidade nova do WhatsApp) às vezes chegam sem o número no remoteJid.
// Procuramos o JID de telefone em todos os campos onde a Evolution costuma colocá-lo.
function escolherJid(key = {}, data = {}) {
  const candidatos = [key.remoteJid, key.remoteJidAlt, key.senderPn, data.senderPn, key.participantAlt].filter(Boolean);
  return candidatos.find((j) => j.endsWith('@s.whatsapp.net')) ?? key.remoteJid ?? null;
}

export function extrairMensagensEvolution(body, agora = Date.now()) {
  const evento = String(body?.event || '').toLowerCase().replace(/_/g, '.');
  if (evento !== 'messages.upsert') return [];

  const itens = Array.isArray(body.data) ? body.data : body.data?.messages ?? [body.data];
  const saida = [];
  for (const data of itens) {
    const key = data?.key;
    if (!key || key.fromMe) continue;

    const remoteJid = key.remoteJid || '';
    if (remoteJid.endsWith('@g.us') || remoteJid.endsWith('@broadcast') || remoteJid.endsWith('@newsletter')) continue;

    const ts = Number(data.messageTimestamp) * 1000;
    if (ts && agora - ts > MAX_IDADE_MS) continue;

    const jid = escolherJid(key, data);
    if (!jid) continue;

    saida.push({
      id: key.id,
      // Telefone em dígitos quando disponível; se só houver LID, guardamos o JID completo para responder
      waId: jid.endsWith('@s.whatsapp.net') ? jid.split('@')[0] : jid,
      remoteJid,
      nomePerfil: data.pushName ?? null,
      tipo: tipoDaMensagem(data.message),
      texto: textoDaMensagem(data.message),
      timestamp: ts || agora,
    });
  }
  return saida;
}

// ---------- Envio ----------

export async function enviarTexto(waId, texto) {
  await chamar('POST', `/message/sendText/${encodeURIComponent(evo.instance)}`, {
    number: waId,
    text: texto,
    delay: 1200, // mostra "digitando..." por um instante
  });
}

export async function marcarComoLida(msg) {
  try {
    await chamar('POST', `/chat/markMessageAsRead/${encodeURIComponent(evo.instance)}`, {
      readMessages: [{ remoteJid: msg.remoteJid, fromMe: false, id: msg.id }],
    });
  } catch {
    /* não é crítico */
  }
}

// ---------- Conexão (QR code) ----------

export async function estadoConexao() {
  try {
    const r = await chamar('GET', `/instance/connectionState/${encodeURIComponent(evo.instance)}`);
    return r?.instance?.state ?? r?.state ?? 'desconhecido';
  } catch (err) {
    if (err.status === 404) return 'inexistente';
    throw err;
  }
}

const configWebhook = (url) => ({
  enabled: true,
  url,
  byEvents: false,
  base64: false,
  events: ['MESSAGES_UPSERT'],
});

const ignorar404 = (err) => {
  if (err.status !== 404) throw err;
};

// Conecta o WhatsApp. Se já estiver conectado, só garante o webhook.
// Se não estiver, APAGA a instância e cria outra do zero: na Evolution v2.3.7, chamar /instance/connect
// com uma tentativa já aberta cria um segundo socket que corrompe o pareamento
// ("Não foi possível conectar o dispositivo" no celular).
export async function conectar(urlWebhook) {
  const estado = await estadoConexao();

  if (estado === 'open') {
    await chamar('POST', `/webhook/set/${encodeURIComponent(evo.instance)}`, { webhook: configWebhook(urlWebhook) });
    return { estado, qr: null };
  }

  if (estado !== 'inexistente') {
    await chamar('DELETE', `/instance/logout/${encodeURIComponent(evo.instance)}`).catch(() => {});
    await chamar('DELETE', `/instance/delete/${encodeURIComponent(evo.instance)}`).catch(ignorar404);
    await new Promise((r) => setTimeout(r, 1500)); // dá tempo da Evolution fechar o socket antigo
  }

  const criada = await chamar('POST', '/instance/create', {
    instanceName: evo.instance,
    integration: 'WHATSAPP-BAILEYS',
    qrcode: true,
    webhook: configWebhook(urlWebhook),
  });
  return { estado: 'connecting', qr: criada?.qrcode?.base64 ?? null, pareamento: criada?.qrcode?.pairingCode ?? null };
}

export async function desconectar() {
  await chamar('DELETE', `/instance/logout/${encodeURIComponent(evo.instance)}`);
}
