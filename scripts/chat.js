// Chat de teste no terminal: conversa com o bot sem precisar do WhatsApp.
// Usa o mesmo fluxo de produção (banco, IA, ferramentas), só troca o envio pelo console.
//
//   npm run chat                     → simula um número novo (lead)
//   npm run chat -- 21999990001      → simula um telefone (use um da base pra testar cliente)
//
// Comandos: /reset (apaga a conversa), /devolver (tira do modo humano), /sair
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { pool, query } from '../src/db.js';
import { processarMensagem } from '../src/atendimento.js';
import { normalizarTelefone } from '../src/telefone.js';

const waId = normalizarTelefone(process.argv[2] || '21900000000');
const rl = readline.createInterface({ input, output });
let contador = 0;

const enviar = async (_waId, texto) => console.log(`\n\x1b[36mbot:\x1b[0m ${texto}\n`);

console.log(`Chat de teste — simulando o telefone ${waId}. Comandos: /reset /devolver /sair\n`);

while (true) {
  const texto = (await rl.question('\x1b[33mvocê:\x1b[0m ')).trim();
  if (!texto) continue;
  if (texto === '/sair') break;
  if (texto === '/reset') {
    await query('DELETE FROM leads WHERE telefone = $1', [waId]);
    await query('DELETE FROM transferencias WHERE conversa_id IN (SELECT id FROM conversas WHERE telefone = $1)', [waId]);
    await query('DELETE FROM conversas WHERE telefone = $1', [waId]);
    console.log('(conversa apagada)\n');
    continue;
  }
  if (texto === '/devolver') {
    await query(`UPDATE conversas SET status = 'bot' WHERE telefone = $1`, [waId]);
    console.log('(conversa devolvida ao bot)\n');
    continue;
  }

  await processarMensagem(
    { id: `teste-${Date.now()}-${contador++}`, waId, nomePerfil: 'Teste', tipo: 'text', texto },
    enviar
  );
  const { rows } = await query('SELECT status FROM conversas WHERE telefone = $1', [waId]);
  if (rows[0]?.status === 'humano') console.log('(conversa transferida para humano — o bot não responde mais até /devolver)\n');
}

rl.close();
await pool.end();
