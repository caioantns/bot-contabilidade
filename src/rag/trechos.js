// Quebra um arquivo Markdown em trechos por seção (## ou ###).
// Cada trecho leva o título do documento + da seção, pra a busca ter contexto.

export function dividirMarkdown(md, fonte) {
  const linhas = md.replace(/\r\n/g, '\n').split('\n');
  let tituloDoc = fonte.replace(/\.md$/i, '');
  const trechos = [];
  let atual = null;

  const fechar = () => {
    if (atual && atual.linhas.join('\n').trim()) {
      trechos.push({ fonte, titulo: atual.titulo, conteudo: atual.linhas.join('\n').trim() });
    }
  };

  for (const linha of linhas) {
    const h1 = linha.match(/^#\s+(.+)/);
    const hSecao = linha.match(/^#{2,3}\s+(.+)/);
    if (h1) {
      tituloDoc = h1[1].trim();
      continue;
    }
    if (hSecao) {
      fechar();
      atual = { titulo: `${tituloDoc} — ${hSecao[1].trim()}`, linhas: [] };
      continue;
    }
    // Comentários HTML (instruções pro Caio/escritório) não entram na base
    if (/^\s*<!--.*-->\s*$/.test(linha)) continue;
    if (!atual) atual = { titulo: tituloDoc, linhas: [] };
    atual.linhas.push(linha);
  }
  fechar();
  return trechos;
}
