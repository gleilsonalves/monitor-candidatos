// Tipos espelham o modelo de dados descrito em projeto-monitor-candidatos.md
// (seção 4). Mantidos deliberadamente permissivos onde o backend ainda não
// tem contrato fechado — o pipeline real está sendo construído em paralelo.

export type Cargo =
  | "Presidente"
  | "Vice-Presidente"
  | "Governador"
  | "Senador"
  | "Deputado Federal"
  | string;

export interface Pagina<T> {
  itens: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface Candidato {
  id: string;
  nome_civil: string;
  nome_urna: string;
  partido_atual: string | null;
  uf: string | null;
  cargo_pretendido: Cargo | null;
  foto_url: string | null;
}

export interface PerfilSocial {
  candidato_id: string;
  plataforma: "youtube" | "bluesky" | "instagram" | "x" | string;
  handle: string;
  url: string;
  verificado: boolean;
  seguidores: number | null;
  coletado_em: string | null;
}

export interface CandidatoDetalhe extends Candidato {
  perfis_sociais?: PerfilSocial[];
}

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

// Regra inegociável (seção 1 e 9): estágios estritamente separados.
// "réu" != "condenado" != "condenação com trânsito em julgado".
export type EstagioJuridico =
  | "denuncia"
  | "investigacao_aberta"
  | "acao_recebida"
  | "condenacao_1a_instancia"
  | "condenacao_colegiado"
  | "transito_julgado"
  | "arquivado"
  | "absolvido";

export interface Evento {
  id: string;
  candidato_id: string;
  tipo: TipoEvento;
  categoria: CategoriaEvento | null;
  estagio_juridico: EstagioJuridico | null; // obrigatório só quando tipo === 'processo'
  tema: string[] | null;
  titulo: string;
  resumo: string | null;
  data_evento: string; // ISO date
  fonte_nome: string;
  fonte_url: string;
  fonte_confianca: 1 | 2 | 3 | null;
  revisado_humano?: boolean;
}

export interface EventosPaginados {
  itens: Evento[];
  total: number;
  pagina: number;
  por_pagina: number;
}

export interface Metrica {
  candidato_id: string;
  chave: string; // ex: 'projetos_aprovados', 'presenca_pct'
  valor: number; // normalizado 0-100
  periodo?: string | null;
  calculado_em?: string | null;
}

export interface Dimensao {
  chave: string;
  nome: string;
  descricao: string;
  fonte: string;
}
