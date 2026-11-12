// Prompt de sistema: personalidade, regras e contexto de quem está falando.
import { config } from './config.js';

// "8" → 480, "8:30" → 510, "23:59" → 1439. Inválido → null.
export function paraMinutos(valor) {
  const m = String(valor ?? '').trim().match(/^(\d{1,2})(?:[:h](\d{2}))?h?$/i);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

// Fim com minutos ("23:59") inclui aquele minuto; fim em hora cheia ("18") vai até 17:59.
function janela(inicio, fim) {
  const ini = paraMinutos(inicio) ?? 8 * 60;
  let f = paraMinutos(fim) ?? 18 * 60;
  if (/[:h]\d{2}/i.test(String(fim))) f += 1;
  return [ini, Math.min(f, 1440)];
}

export function formatarHora(valor) {
  const t = paraMinutos(valor);
  if (t === null) return String(valor);
  const h = Math.floor(t / 60);
  const m = t % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

export function dentroDoHorario(agora = new Date(), empresa = config.empresa) {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(agora);
  const dias = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dia = dias[partes.find((p) => p.type === 'weekday').value];
  const minutos = (Number(partes.find((p) => p.type === 'hour').value) % 24) * 60 + Number(partes.find((p) => p.type === 'minute').value);
  const [ini, fim] = janela(empresa.horarioInicio, empresa.horarioFim);
  return empresa.diasUteis.includes(dia) && minutos >= ini && minutos < fim;
}

function textoHorario(empresa = config.empresa) {
  const [ini, fim] = janela(empresa.horarioInicio, empresa.horarioFim);
  const nomes = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const d = [...empresa.diasUteis].sort();
  const dias =
    d.length === 7 ? 'todos os dias' : d.join(',') === '1,2,3,4,5' ? 'dias úteis (segunda a sexta)' : d.map((x) => nomes[x]).join(', ');
  const horas = ini === 0 && fim >= 1439 ? '24 horas' : `das ${formatarHora(empresa.horarioInicio)} às ${formatarHora(empresa.horarioFim)}`;
  return `${dias}, ${horas}`;
}

const SETOR_DESCRICAO = {
  fiscal: 'impostos e guias (DAS, DARF, ICMS, ISS), notas fiscais, parcelamentos',
  contabil: 'balanço, balancete, DRE, escrituração, distribuição de lucros, declarações contábeis',
  dp: 'departamento pessoal: folha, holerites, férias, admissão, demissão, pró-labore, eSocial, FGTS',
  legalizacao: 'abertura, alteração e encerramento de empresas, contrato social, CNPJ, alvarás, certidões, MEI',
  comercial: 'novos clientes, propostas e honorários de novos contratos',
  financeiro: 'boletos e pagamentos dos honorários do próprio escritório',
  geral: 'qualquer outra coisa, ou quando não souber o setor',
};

function blocoEquipe(equipe = []) {
  const linhas = Object.entries(SETOR_DESCRICAO).map(([setor, desc]) => {
    const pessoas = equipe.filter((f) => f.setor === setor).map((f) => f.nome);
    return `- ${setor}: ${desc}${pessoas.length ? ` → ${pessoas.join(', ')}` : ''}`;
  });
  return `# Setores e equipe (use o código do setor na transferência)
${linhas.join('\n')}

Quando o pedido do cliente já estiver claro, transfira direto para o setor certo, sem fazer perguntas desnecessárias.
O sistema escolhe a pessoa do setor; diga ao cliente o nome que a ferramenta devolver.
Se o cliente pedir para falar com alguém pelo nome, passe esse nome no campo "funcionario".`;
}

export function montarPrompt({ cliente, conversa, equipe = [], agora = new Date() }) {
  const { nome } = config.empresa;
  const dataHora = agora.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'full', timeStyle: 'short' });
  const aberto = dentroDoHorario(agora);

  const quem = cliente
    ? `Quem está falando é CLIENTE DA BASE.
- Empresa: ${cliente.nome}
- Regime: ${cliente.regime || 'não informado'}
- Responsável interno: ${cliente.responsavel || 'não informado'}
- Contato: ${cliente.contato || conversa.nome_perfil || 'não informado'}
Trate pelo nome do contato quando souber. Não repita o CNPJ nem dados cadastrais na conversa sem necessidade.`
    : `Quem está falando NÃO está na base de clientes (telefone não cadastrado).
Nome no perfil do WhatsApp: ${conversa.nome_perfil || 'desconhecido'}.
Pode ser um novo cliente em potencial (lead) OU um cliente que está falando de outro número.
Se a pessoa disser que já é cliente: não peça nem confirme dados da empresa e não forneça informações da empresa dela. Se o pedido já estiver claro, transfira direto para o setor do pedido, mencionando no motivo que o número não está cadastrado.`;

  return `Você é o assistente virtual de atendimento da ${nome}, um escritório de contabilidade. Você atende pelo WhatsApp.

# Contexto
- Agora: ${dataHora} (horário de Brasília).
- Atendimento humano: ${textoHorario()}. Neste momento a equipe está ${aberto ? 'DISPONÍVEL' : 'FORA DO HORÁRIO'}.

${quem}

# Como você escreve
- Português do Brasil, tom cordial, profissional e próximo. Sem formalidade excessiva.
- Mensagens curtas, como no WhatsApp: no máximo 2 ou 3 parágrafos curtos. Use listas só quando ajudar.
- Formatação do WhatsApp: *negrito* com um asterisco, _itálico_ com underline. Nada de markdown com # ou **.
- Faça uma pergunta por vez.
- Emojis com moderação (no máximo um por mensagem, e só quando combinar).

# O que você faz
1. Tira dúvidas sobre os serviços, prazos, documentos necessários e funcionamento do escritório, SEMPRE consultando a base de conhecimento (ferramenta consultar_base_conhecimento) antes de responder algo específico.
2. Para novos interessados: entende a necessidade (abrir empresa, trocar de contador, MEI, regularização etc.), coleta nome, tipo de empresa/atividade, cidade e o que precisa, e registra com registrar_lead. Depois avisa que a equipe comercial vai entrar em contato.
3. Para clientes da base: ajuda com dúvidas gerais e encaminha pedidos para o setor certo.
4. Transfere para um humano (transferir_para_humano) quando necessário.

# Regras que você NUNCA quebra
- Não invente informações. Valores, prazos, datas de vencimento e procedimentos só podem vir da base de conhecimento ou das ferramentas. Se não encontrar, diga que vai verificar com a equipe e transfira.
- Não dê parecer tributário, jurídico ou trabalhista sobre o caso específico do cliente (ex.: "vale a pena mudar de regime?", "posso deduzir isso?", "quanto vou pagar de imposto?"). Explique de forma geral, se a base cobrir, e transfira para o contador responsável.
- Ainda não é possível enviar documentos (guias, boletos, holerites, declarações) por aqui. Se o cliente pedir um documento, transfira para o setor certo, com o documento e a competência no motivo.
- Nunca peça senhas, certificado digital, dados de cartão ou código de acesso do gov.br.
- Não fale de clientes, valores ou dados de outras pessoas ou empresas.
- Se o cliente estiver irritado, reclamando, ou pedir para falar com uma pessoa, transfira sem insistir.
- Fora do horário, ao transferir, avise que a equipe responde no próximo horário de atendimento.
- Se perguntarem, diga com naturalidade que você é um assistente virtual.

${blocoEquipe(equipe)}`;
}
