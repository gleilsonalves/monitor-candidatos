/**
 * Trunca texto oficial estruturado (ex: ementa de proposição) para uso como
 * `resumo` sem chamada a LLM. Aceitável nesta fase porque é dado oficial
 * estruturado, não matéria jornalística protegida por direito autoral
 * (ver seção 4 do documento de arquitetura).
 */
export function truncate(text: string, maxLen: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen - 1).trimEnd()}…`;
}
