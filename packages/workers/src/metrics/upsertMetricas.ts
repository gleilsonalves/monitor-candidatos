import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "../lib/logger.js";
import type { MetricaComputada } from "./types.js";

const FONTE = "compute_metricas";

/**
 * Upsert manual (leitura antes de escrever), o mesmo padrão já usado por
 * `Collector.upsertEvento` (src/collector.ts) — e pelo mesmo motivo: a
 * tabela `metrica` não tem constraint UNIQUE em `(candidato_id, chave)`,
 * só um índice não-único (`metrica_candidato_chave_idx`, ver
 * db/migrations/0001_core_schema.sql), então `.upsert()` nativo do
 * supabase-js não tem `onConflict` para usar.
 *
 * Diferente de `evento`/`raw_payload` (append-only), este job é recalculado
 * periodicamente e `metrica` representa o valor VIGENTE de cada chave — por
 * isso atualiza a linha existente (`valor` + `calculado_em`) em vez de
 * inserir uma nova a cada execução.
 */
export async function upsertMetrica(
  supabase: SupabaseClient,
  metrica: MetricaComputada
): Promise<"inserido" | "atualizado"> {
  const { data: existente, error: selectError } = await supabase
    .from("metrica")
    .select("id")
    .eq("candidato_id", metrica.candidato_id)
    .eq("chave", metrica.chave)
    .order("calculado_em", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (selectError) throw selectError;

  const agora = new Date().toISOString();

  if (existente) {
    const { error } = await supabase
      .from("metrica")
      .update({ valor: metrica.valor, periodo: metrica.periodo, calculado_em: agora })
      .eq("id", existente.id as string);
    if (error) throw error;
    return "atualizado";
  }

  const { error } = await supabase.from("metrica").insert({
    candidato_id: metrica.candidato_id,
    chave: metrica.chave,
    valor: metrica.valor,
    periodo: metrica.periodo,
    calculado_em: agora,
  });
  if (error) throw error;
  return "inserido";
}

/**
 * Grava uma lista de métricas computadas, uma de cada vez. Erro numa linha
 * não derruba as demais (mesmo princípio de `Collector.run()`): loga e
 * segue, para uma fonte de dado ruim não impedir o cálculo das outras.
 */
export async function upsertMetricas(
  supabase: SupabaseClient,
  metricas: MetricaComputada[]
): Promise<{ inseridas: number; atualizadas: number; erros: number }> {
  let inseridas = 0;
  let atualizadas = 0;
  let erros = 0;

  for (const metrica of metricas) {
    try {
      const status = await upsertMetrica(supabase, metrica);
      if (status === "inserido") inseridas++;
      else atualizadas++;
    } catch (err) {
      erros++;
      logger.error(FONTE, "erro ao gravar métrica — seguindo para a próxima", {
        candidato_id: metrica.candidato_id,
        chave: metrica.chave,
        erro: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { inseridas, atualizadas, erros };
}
