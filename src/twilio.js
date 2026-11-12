// Integração com o WhatsApp da Twilio (Sandbox para testes ou número aprovado).
// Docs: https://www.twilio.com/docs/whatsapp
import crypto from 'node:crypto';
import { config } from './config.js';

const tw = config.twilio;

// ---------- Segurança: assinatura X-Twilio-Signature ----------
// HMAC-SHA1 (base64) de: URL completa + cada parâmetro POST (ordenado por nome) concatenado como nome+valor
export function assinaturaTwilioValida(url, params, assinatura, authToken = tw.authToken) {
  if (!authToken || !assinatura) return false;
  const dados = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + (params[k] ?? ''), url);
  const esperado = crypto.createHmac('sha1', authToken).update(Buffer.from(dados, 'utf8')).digest('base64');
  const a = Buffer.from(esperado);
  const b = Buffer.from(String(assinatura));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- Recebimento ----------
const TIPOS = { text: 'text', image: 'image', audio: 'audio', video: 'video', document: 'document', location: 'location', sticker: 'sticker' };

export function extrairMensagemTwilio(p) {
  if (!p?.From || !p?.MessageSid) return null;
  const tipo = TIPOS[p.MessageType] ?? (Number(p.NumMedia) > 0 ? 'document' : 'text');
  return {
    id: p.MessageSid,
    // Respondemos exatamente para o número que escreveu (sem "whatsapp:" e sem "+")
    waId: String(p.From).replace(/^whatsapp:/, '').replace(/\D/g, ''),
    nomePerfil: p.ProfileName || null,
    tipo: p.ButtonText ? 'button' : tipo,
    texto: p.ButtonText || p.Body || '',
  };
}

// ---------- Envio ----------
export function dividirTexto(texto, limite = 1500) {
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

// Twilio limita mensagens de WhatsApp a 1600 caracteres
export async function enviarTexto(waId, texto) {
  const de = tw.from.startsWith('whatsapp:') ? tw.from : `whatsapp:${tw.from}`;
  for (const parte of dividirTexto(texto)) {
    const res = await fetch(`${tw.apiBase}/2010-04-01/Accounts/${tw.accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${tw.accountSid}:${tw.authToken}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ From: de, To: `whatsapp:+${waId}`, Body: parte }),
    });
    if (!res.ok) throw new Error(`Twilio ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}
