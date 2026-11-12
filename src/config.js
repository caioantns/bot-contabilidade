// Lê e valida as variáveis de ambiente num lugar só.
const env = process.env;

export const config = {
  port: Number(env.PORT || 3000),

  databaseUrl: env.DATABASE_URL,
  databaseSsl: env.DATABASE_SSL === 'true',

  anthropicApiKey: env.ANTHROPIC_API_KEY,
  anthropicModel: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',

  voyageApiKey: env.VOYAGE_API_KEY || '',
  voyageModel: env.VOYAGE_MODEL || 'voyage-3.5',

  // Canal do WhatsApp: 'twilio', 'meta' (WhatsApp Cloud API oficial) ou 'evolution' (QR code)
  canal: (env.CANAL || 'evolution').toLowerCase(),

  // URL pública do bot (o Railway preenche RAILWAY_PUBLIC_DOMAIN sozinho)
  publicUrl: env.PUBLIC_URL || (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : ''),

  evolution: {
    url: env.EVOLUTION_URL || '',
    apiKey: env.EVOLUTION_API_KEY || '',
    instance: env.EVOLUTION_INSTANCE || 'contabilidade',
    // Segredo na URL do webhook (a Evolution não assina as requisições)
    webhookToken: env.EVOLUTION_WEBHOOK_TOKEN || '',
  },

  twilio: {
    accountSid: env.TWILIO_ACCOUNT_SID || '',
    authToken: env.TWILIO_AUTH_TOKEN || '',
    // Número do Sandbox da Twilio (troque se usar um número próprio aprovado)
    from: env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886',
    apiBase: env.TWILIO_API_BASE || 'https://api.twilio.com',
  },

  whatsapp: {
    token: env.WHATSAPP_TOKEN,
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
    verifyToken: env.WHATSAPP_VERIFY_TOKEN,
    appSecret: env.WHATSAPP_APP_SECRET || '',
    graphVersion: env.GRAPH_API_VERSION || 'v23.0',
  },

  empresa: {
    nome: env.EMPRESA_NOME || 'Contabilidade',
    // Aceita "8", "08", "8:30", "00:00", "23:59" ou "24"
    horarioInicio: (env.HORARIO_INICIO ?? '8').trim(),
    horarioFim: (env.HORARIO_FIM ?? '18').trim(),
    diasUteis: (env.DIAS_UTEIS || '1,2,3,4,5').split(',').map(Number),
  },

  adminToken: env.ADMIN_TOKEN || '',

  // Depois de quantas horas uma conversa transferida volta sozinha para o bot (0 = nunca)
  retornoAutomaticoHoras: Number(env.RETORNO_AUTOMATICO_HORAS ?? 12),

  // Quantas mensagens anteriores a IA recebe como contexto
  historicoMax: 20,
};

export function exigir(...nomes) {
  const faltando = nomes.filter((n) => !env[n]);
  if (faltando.length) {
    throw new Error(`Variáveis de ambiente faltando: ${faltando.join(', ')} (veja .env.example)`);
  }
}
