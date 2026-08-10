import type { SupabaseClient } from "@supabase/supabase-js";
import { computeMinMaxScore } from "./minMaxScore.js";
import type { EventoContagemPorCandidato, MetricaComputada } from "./types.js";

/** Prefixo de dimensão — precisa casar exatamente com `DIMENSOES` em packages/api/src/lib/dimensoes.ts. */
export const CHAVE_BASE_PRODUCAO_LEGISLATIVA = "producao_legislativa";

const PAGE_SIZE = 1000;

/**
 * Busca todos os eventos `tipo='proposicao'` (única fonte real disponível
 * hoje — coletadas pela Câmara, ver `src/collectors/camara`) e agrega a
 * contagem por `candidato_id`. Pagina em lotes de `PAGE_SIZE` para não
 * depender do limite default de linhas do PostgREST caso o volume cresça.
 *
 * Não filtra por `categoria` explicitamente porque hoje todo evento
 * `tipo='proposicao'` é gravado com `categoria='realizacao'` pelo coletor da
 * Câmara (produção legislativa é sempre "realização", nunca "controvérsia"
 * nem "neutro") — mas o filtro por `tipo` já é suficiente e deixa claro que
 * esta dimensão é sobre PRODUÇÃO, não sobre juízo de valor da proposição.
 */
export async function fetchContagemProposicoesPorCandidato(
  supabase: SupabaseClient
): Promise<EventoContagemPorCandidato[]> {
  const contagemPorCandidato = new Map<string, number>();

  let offset = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("evento")
      .select("candidato_id")
      .eq("tipo", "proposicao")
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    for (const row of data as { candidato_id: string }[]) {
      contagemPorCandidato.set(
        row.candidato_id,
        (contagemPorCandidato.get(row.candidato_id) ?? 0) + 1
      );
    }

    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return [...contagemPorCandidato.entries()].map(([candidato_id, contagem]) => ({
    candidato_id,
    contagem,
  }));
}

/**
 * Monta as métricas de produção legislativa a partir das contagens já
 * agregadas:
 *
 * - `producao_legislativa.total_proposicoes` — contagem bruta, NÃO
 *   normalizada. É um dado auxiliar de transparência/auditoria (para quem
 *   quiser ver de onde veio o score), não entra direto em nenhum cálculo de
 *   score no frontend.
 * - `producao_legislativa.score` — a mesma contagem normalizada 0-100 por
 *   min-max dentro do conjunto de candidatos com >=1 proposição
 *   (`computeMinMaxScore`, ver minMaxScore.ts). É esta chave que corresponde
 *   à dimensão `producao_legislativa` exposta por `GET /dimensoes`
 *   (packages/api/src/lib/dimensoes.ts).
 *
 * Só candidatos com pelo menos 1 proposição aparecem no resultado — nunca
 * gravamos um valor default (nem 0) para quem não tem dado. Ver README.md
 * deste diretório e seção 1/9 do documento de arquitetura.
 */
export function buildMetricasProducaoLegislativa(
  contagens: EventoContagemPorCandidato[]
): MetricaComputada[] {
  const totalBruto: MetricaComputada[] = contagens.map((c) => ({
    candidato_id: c.candidato_id,
    chave: `${CHAVE_BASE_PRODUCAO_LEGISLATIVA}.total_proposicoes`,
    valor: c.contagem,
    periodo: null,
  }));

  const score = computeMinMaxScore(contagens, CHAVE_BASE_PRODUCAO_LEGISLATIVA);

  return [...totalBruto, ...score];
}
