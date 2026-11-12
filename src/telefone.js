// O WhatsApp às vezes manda números brasileiros SEM o 9 extra do celular
// (ex.: 552199998888 em vez de 5521999998888). Pra buscar no banco,
// normalizamos sempre para 55 + DDD + 9 dígitos. Pra RESPONDER, usamos o wa_id original.

export function normalizarTelefone(entrada) {
  let d = String(entrada || '').replace(/\D/g, '');
  if (!d) return '';

  // Sem código do país (ex.: 21999998888 ou 2199998888)
  if (d.length === 10 || d.length === 11) d = '55' + d;

  if (d.startsWith('55') && d.length === 12) {
    const ddd = d.slice(2, 4);
    const numero = d.slice(4);
    // Celulares começam com 6-9; fixos (2-5) não ganham o 9
    if (/^[6-9]/.test(numero)) d = `55${ddd}9${numero}`;
  }
  return d;
}

export function mascararTelefone(t) {
  const d = normalizarTelefone(t);
  return d.length >= 4 ? `***${d.slice(-4)}` : '***';
}
