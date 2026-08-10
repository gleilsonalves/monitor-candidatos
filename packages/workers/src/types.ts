/**
 * Tipos espelhando o schema em db/migrations/0001_core_schema.sql
 * (mesma fonte de verdade usada por packages/api/src/types.ts).
 */

export type TipoEvento =
  | "proposicao"
  | "voto"
  | "processo"
  | "sancao"
  | "despesa"
  | "nomeacao"
  | "post"
  | "anuncio";

export type CategoriaEvento = "realizacao" | "controversia" | "neutro";

/**
 * Só é permitido (e obrigatório) quando tipo = 'processo'; para qualquer outro
 * tipo tem que ser null — reforçado por CHECK constraint no banco. Nunca colapsar
 * esses estados: "réu" e "condenado" são coisas diferentes (seção 1 do documento
 * de arquitetura).
 */
export type EstagioJuridico =
  | "denuncia"
  | "investigacao_aberta"
  | "acao_recebida"
  | "condenacao_1a_instancia"
  | "condenacao_colegiado"
  | "transito_julgado"
  | "arquivado"
  | "absolvido";

/**
 * Formato que todo `normalize()` de coletor precisa produzir. `hash_conteudo`
 * é responsabilidade do coletor calcular de forma estável (ver lib/hash.ts) —
 * é o que garante o dedup automático via `evento.hash_conteudo UNIQUE`.
 */
export interface NormalizedEventoInput {
  candidato_id: string;
  tipo: TipoEvento;
  categoria: CategoriaEvento;
  estagio_juridico: EstagioJuridico | null;
  tema: string[];
  titulo: string;
  resumo: string | null;
  data_evento: string; // YYYY-MM-DD
  fonte_nome: string;
  fonte_url: string;
  fonte_confianca: 1 | 2 | 3;
  hash_conteudo: string;
}

/** Contadores de observabilidade retornados por Collector.run() (seção 7 do documento). */
export interface CollectorStats {
  fonte: string;
  buscados: number;
  raw_inseridos: number;
  raw_duplicados: number;
  eventos_inseridos: number;
  eventos_atualizados: number;
  eventos_pulados: number;
  erros: number;
}
