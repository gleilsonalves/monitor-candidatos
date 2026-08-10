import type { EventoContagemPorCandidato, MetricaComputada } from "./types.js";

/**
 * Normalização min-max documentada e auditável (seção 6 do documento de
 * arquitetura: "o backend entrega apenas as métricas normalizadas [...] com
 * o método de normalização documentado e visível").
 *
 * Fórmula, aplicada dentro do conjunto de candidatos recebido em `contagens`:
 *
 *   score = (valor - min) / (max - min) * 100
 *
 * Quem tem a maior contagem no conjunto fica em 100, quem tem a menor fica
 * em 0, os demais interpolam linearmente entre os dois.
 *
 * **Pré-condição que quem chama esta função precisa garantir**: `contagens`
 * já deve conter só candidatos com PELO MENOS 1 evento na dimensão. Esta
 * função nunca deve receber (nem inventar) uma contagem 0 para um candidato
 * sem dado — isso violaria a regra central deste job: ausência de dado não é
 * prova de mérito nem de conduta irregular, então não vira métrica (nem 0,
 * nem qualquer outro valor default). Ver README.md deste diretório.
 *
 * Caso especial — empate total (`max === min`): não há variação nenhuma
 * dentro do conjunto observado para normalizar (inclui o caso trivial de um
 * único candidato com dado). Em vez de zerar todo mundo — o que pareceria
 * "pior do grupo" sem nenhum motivo real — atribuímos 100 a todos: dentro do
 * conjunto que tem dado, ninguém está atrás de ninguém. É uma convenção
 * arbitrária como qualquer outra seria neste caso-limite, mas documentada
 * aqui explicitamente para ser auditável.
 */
export function computeMinMaxScore(
  contagens: EventoContagemPorCandidato[],
  chaveBase: string
): MetricaComputada[] {
  if (contagens.length === 0) return [];

  const valores = contagens.map((c) => c.contagem);
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  const empate = max === min;

  return contagens.map((c) => {
    const score = empate ? 100 : ((c.contagem - min) / (max - min)) * 100;
    return {
      candidato_id: c.candidato_id,
      chave: `${chaveBase}.score`,
      // 2 casas decimais — suficiente para uma escala 0-100 e evita ruído
      // de ponto flutuante gravado no banco.
      valor: Math.round(score * 100) / 100,
      periodo: null,
    };
  });
}
