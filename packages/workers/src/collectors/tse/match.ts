/**
 * Helpers de entity resolution do coletor do TSE (seção 5, passo 2 do
 * documento de arquitetura — "match forte": nome normalizado + UF + partido,
 * confiança ~0.9). Ficam isolados aqui para deixar `collector.ts` focado no
 * fluxo de fetch/normalize.
 */

const PREPOSICOES = new Set(["DE", "DA", "DO", "DAS", "DOS", "E"]);

/**
 * Normaliza um nome para comparação: remove acentos, maiúsculas, remove
 * preposições isoladas ("de", "da", "do", ...) e colapsa espaços. Não usa
 * fuzzy matching (Levenshtein/Jaro-Winkler) de propósito — isso é o passo 3
 * da cascata (seção 5), não o passo 2. Aqui a comparação final é sempre
 * igualdade estrita entre strings normalizadas.
 */
export function normalizarNome(nome: string): string {
  const semAcento = nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

  const palavras = semAcento
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((p) => p.length > 0 && !PREPOSICOES.has(p));

  return palavras.join(" ");
}

/** Normaliza sigla de partido para comparação (maiúsculas, sem espaços nas bordas). */
export function normalizarSigla(sigla: string): string {
  return sigla.trim().toUpperCase();
}

/** Região do TSE para uma UF — usada para montar a URL pública do DivulgaCand. */
const REGIAO_POR_UF: Record<string, string> = {
  AC: "NORTE",
  AM: "NORTE",
  AP: "NORTE",
  PA: "NORTE",
  RO: "NORTE",
  RR: "NORTE",
  TO: "NORTE",
  AL: "NORDESTE",
  BA: "NORDESTE",
  CE: "NORDESTE",
  MA: "NORDESTE",
  PB: "NORDESTE",
  PE: "NORDESTE",
  PI: "NORDESTE",
  RN: "NORDESTE",
  SE: "NORDESTE",
  DF: "CENTROOESTE",
  GO: "CENTROOESTE",
  MT: "CENTROOESTE",
  MS: "CENTROOESTE",
  ES: "SUDESTE",
  MG: "SUDESTE",
  RJ: "SUDESTE",
  SP: "SUDESTE",
  PR: "SUL",
  RS: "SUL",
  SC: "SUL",
};

export function regiaoParaUf(uf: string): string | null {
  return REGIAO_POR_UF[uf.toUpperCase()] ?? null;
}
