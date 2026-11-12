// Importa clientes de um CSV. Uso:
//   npm run importar-clientes -- dados/clientes.csv
//
// Colunas esperadas (cabeçalho na 1ª linha, nomes sem acento):
//   nome;cnpj;regime;responsavel;email;telefone;contato
// Uma empresa com vários telefones = várias linhas com o mesmo CNPJ.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { pool } from '../src/db.js';
import { lerCsv, importarClientes } from '../src/clientes.js';

export { lerCsv };

async function main() {
  const arquivo = process.argv[2];
  if (!arquivo) throw new Error('Informe o caminho do CSV. Ex.: npm run importar-clientes -- dados/clientes.csv');
  const { empresas, telefones } = await importarClientes(lerCsv(await readFile(arquivo, 'utf8')));
  console.log(`[importar] ${empresas} empresa(s) nova(s), ${telefones} telefone(s) vinculados`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((err) => {
      console.error('[importar] erro:', err.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
