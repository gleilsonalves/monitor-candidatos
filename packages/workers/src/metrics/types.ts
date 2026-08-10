/**
 * Tipos da camada de metrificação (job `compute:metricas`). Espelha o schema
 * de `metrica` em db/migrations/0001_core_schema.sql. Ver README.md deste
 * diretório para a explicação de cada decisão de modelagem.
 */

/**
 * Contagem de eventos de um tipo/categoria específicos, já agregada por
 * candidato. Só existe uma entrada aqui para candidatos que têm PELO MENOS
 * 1 evento — nunca incluir candidatos com contagem 0 (ver regra 1 do README:
 * ausência de dado não vira métrica default).
 */
export interface EventoContagemPorCandidato {
  candidato_id: string;
  contagem: number;
}

/**
 * Uma linha pronta para upsert em `metrica`. `periodo` fica `null` nesta
 * fase (ver README — decisão sobre janela temporal "vigente" sem range
 * definido).
 */
export interface MetricaComputada {
  candidato_id: string;
  chave: string;
  valor: number;
  periodo: string | null;
}

/** Estatísticas de observabilidade de uma execução, no espírito de CollectorStats (src/collector.ts). */
export interface MetricasStats {
  chave_base: string;
  candidatos_com_dado: number;
  metricas_inseridas: number;
  metricas_atualizadas: number;
  erros: number;
}
