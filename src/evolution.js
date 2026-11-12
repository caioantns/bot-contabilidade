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

// Na v2.3.7, responder pelo número (PN) a um contato que usa LID deixa a mensagem pendente e
// pode derrubar a sessão. Contorno relatado pela comunidade: responder pelo JID @lid do contato.
// https://github.com/evolution-foundation/evolution-api/issues/2626
const destinoPorWaId = new Map();

function acharLid(key = {}, data = {}) {
  const candidatos = [key.remoteJid, key.remoteJidAlt, key.senderLid, data.senderLid, key.participant, key.participantAlt];
  return candidatos.find((j) => typeof j === 'string' && j.endsWith('@lid')) ?? null;
}

export function destinoDeEnvio(waId) {
  return destinoPorWaId.get(String(waId)) ?? String(waId);
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

    const waId = jid.endsWith('@s.whatsapp.net') ? jid.split('@')[0] : jid;
    const lid = acharLid(key, data);
    if (lid) destinoPorWaId.set(waId, lid);
    else if (key.addressingMode === 'lid') {
      // Diagnóstico: mostra só os NOMES dos campos, sem conteúdo
      console.warn(`[evolution] contato em modo LID sem JID @lid no payload. Campos da key: ${Object.keys(key).join(', ')}`);
    }

    saida.push({
      id: key.id,
      // Telefone em dígitos quando disponível; se só houver LID, guardamos o JID completo para responder
      waId,
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

// Envio mínimo: sem "digitando..." e sem confirmação de leitura, que são chamadas extras
// ao WhatsApp e coincidiam com as quedas de sessão na v2.3.7.
export async function enviarTexto(waId, texto) {
  const destino = destinoDeEnvio(waId);
  try {
    await chamar('POST', `/message/sendText/${encodeURIComponent(evo.instance)}`, { number: destino, text: texto });
  } catch (err) {
    // Se o envio pelo LID falhar, tenta pelo número
    if (destino === String(waId)) throw err;
    console.warn(`[evolution] envio pelo LID falhou (${err.message}); tentando pelo número`);
    await chamar('POST', `/message/sendText/${encodeURIComponent(evo.instance)}`, { number: String(waId), text: texto });
  }
}

export async function marcarComoLida() {
  /* desativado de propósito (ver comentário acima) */
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
    // Comportamento mais "quieto" possível: menos tráfego com o WhatsApp, menos chance de queda
    groupsIgnore: true,
    alwaysOnline: false,
    readMessages: false,
    readStatus: false,
    syncFullHistory: false,
    rejectCall: false,
    webhook: configWebhook(urlWebhook),
  });
  return { estado: 'connecting', qr: criada?.qrcode?.base64 ?? null, pareamento: criada?.qrcode?.pairingCode ?? null };
}

export async function desconectar() {
  // Se já estiver desconectada, a Evolution responde 400/404: não é erro para nós
  await chamar('DELETE', `/instance/logout/${encodeURIComponent(evo.instance)}`).catch((err) => {
    if (err.status !== 400 && err.status !== 404) throw err;
  });
}
