/**
 * Tipos manuais espelhando o schema em db/migrations/0001_core_schema.sql.
 * Definidos à mão (sem `generate_typescript_types`) conforme pedido do escopo da API.
 */

export type Origem = "tse" | "imprensa" | "social";

export type Plataforma =
  | "youtube"
  | "bluesky"
  | "instagram"
  | "x"
  | "threads"
  | "facebook";

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
 * Só é preenchido quando tipo = 'processo'. Nunca colapsar esses estados —
 * "réu" e "condenado" são coisas diferentes (ver seção 1 do documento de arquitetura).
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

export interface Candidato {
  id: string;
  nome_civil: string;
  nome_urna: string;
  cpf_hash: string | null;
  id_tse: string | null;
  id_camara: number | null;
  id_senado: number | null;
  partido_atual: string | null;
  uf: string | null;
  cargo_pretendido: string | null;
  foto_url: string | null;
  created_at: string;
  updated_at: string;
}

/** Subconjunto de colunas retornado por GET /candidatos (listagem). */
export type CandidatoResumo = Pick<
  Candidato,
  | "id"
  | "nome_civil"
  | "nome_urna"
  | "partido_atual"
  | "uf"
  | "cargo_pretendido"
  | "foto_url"
>;

export interface CandidatoAlias {
  id: string;
  candidato_id: string;
  alias: string;
  origem: Origem;
  confianca: number;
  created_at: string;
}

export interface PerfilSocial {
  id: string;
  candidato_id: string;
  plataforma: Plataforma;
  handle: string;
  url: string;
  verificado: boolean;
  seguidores: number | null;
  coletado_em: string | null;
}

export interface Evento {
  id: string;
  candidato_id: string;
  tipo: TipoEvento;
  categoria: CategoriaEvento;
  estagio_juridico: EstagioJuridico | null;
  tema: string[];
  titulo: string;
  resumo: string | null;
  data_evento: string;
  fonte_nome: string;
  fonte_url: string;
  fonte_confianca: 1 | 2 | 3;
  payload_raw_id: string | null;
  hash_conteudo: string;
  revisado_humano: boolean;
  created_at: string;
}

export interface Metrica {
  id: string;
  candidato_id: string;
  chave: string;
  valor: number;
  periodo: string | null;
  calculado_em: string;
}

/** Perfil completo retornado por GET /candidatos/:id */
export interface CandidatoPerfilCompleto extends Candidato {
  perfis_sociais: PerfilSocial[];
}

export interface ApiErrorBody {
  error: string;
}

export interface PaginatedResult<T> {
  data: T[];
  limit: number;
  offset: number;
  total: number | null;
}
