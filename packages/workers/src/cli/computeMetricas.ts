import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../lib/env.js";
import { createWorkerSupabaseClient } from "../lib/supabaseClient.js";
import { logger } from "../lib/logger.js";
import {
  buildMetricasProducaoLegislativa,
  fetchContagemProposicoesPorCandidato,
  upsertMetricas,
} from "../metrics/index.js";

const FONTE = "compute_metricas";

// Fallback público usado só pelo modo --dry-run (leitura, nunca escrita) quando
// SUPABASE_URL/SUPABASE_ANON_KEY não estão definidas no ambiente. São os mesmos
// valores já commitados em texto plano em .env.example (raiz do monorepo),
// packages/api/.env.example e apps/web/.env — a chave é "publishable"/anon, não
// service_role, então não há segredo aqui (mesmo espírito do fallback público de
// CAMARA_API_BASE em lib/env.ts).
const DEFAULT_SUPABASE_URL = "https://mjojuycrkxidpkzyzuuz.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY = "sb_publishable_9PabKbd-ylAiU1ikBoVUrQ_jwx2cYJW";

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");

  if (dryRun) {
    const supabaseUrl = process.env.SUPABASE_URL ?? DEFAULT_SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY ?? DEFAULT_SUPABASE_ANON_KEY;

    logger.info(
      FONTE,
      "[dry-run] lendo eventos reais do banco com a chave anon/pública — " +
        "não grava em `metrica`, não requer SUPABASE_SERVICE_ROLE_KEY"
    );

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const contagens = await fetchContagemProposicoesPorCandidato(supabase);
    const metricas = buildMetricasProducaoLegislativa(contagens);

    console.log(
      JSON.stringify(
        {
          modo: "dry-run",
          chave_base: "producao_legislativa",
          candidatos_com_dado: contagens.length,
          contagens_por_candidato: contagens,
          metricas_que_seriam_gravadas: metricas,
          aviso:
            "nenhuma linha foi escrita em `metrica`. Candidatos sem proposição " +
            "coletada não aparecem aqui de propósito (ver README.md em src/metrics/, Regra 1).",
        },
        null,
        2
      )
    );
    return;
  }

  const env = loadEnv();
  const supabase = createWorkerSupabaseClient(env);

  logger.info(FONTE, "calculando métricas de produção legislativa a partir de `evento`...");
  const contagens = await fetchContagemProposicoesPorCandidato(supabase);
  const metricas = buildMetricasProducaoLegislativa(contagens);
  logger.info(
    FONTE,
    `${contagens.length} candidato(s) com ao menos 1 proposição — ${metricas.length} linha(s) de métrica a gravar`
  );

  const resultado = await upsertMetricas(supabase, metricas);

  const stats = {
    chave_base: "producao_legislativa",
    candidatos_com_dado: contagens.length,
    metricas_inseridas: resultado.inseridas,
    metricas_atualizadas: resultado.atualizadas,
    erros: resultado.erros,
  };
  logger.info(FONTE, "execução concluída", stats);
  console.log(JSON.stringify(stats, null, 2));
}

main().catch((err) => {
  logger.error(FONTE, err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
