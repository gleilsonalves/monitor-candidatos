/**
 * Tipos da API REST pública do TSE — DivulgaCand
 * (`divulgacandcontas.tse.jus.br/divulga/rest/v1`). Esta API não é
 * documentada publicamente em formato OpenAPI/Swagger; os campos abaixo
 * foram levantados inspecionando as respostas reais dos endpoints usados
 * pelo próprio site oficial (ver `README.md` desta pasta para os endpoints
 * e a forma como foram descobertos). Só os campos que o collector
 * efetivamente consome estão tipados; a API retorna dezenas de outros
 * campos (`null` na maior parte dos casos) que não interessam aqui.
 */

/** Item de `GET /eleicao/ordinarias` — usado para resolver o `idEleicao` a partir do ano. */
export interface TseEleicaoOrdinaria {
  id: number;
  ano: number;
  nomeEleicao: string | null;
  /** "F" = Eleição Geral Federal (o que este collector busca), "M" = municipal. */
  tipoAbrangencia: string | null;
  dataEleicao: string | null;
}

/** Item de `GET /candidatura/cargos?ano={ano}&idEleicao={idEleicao}`. */
export interface TseCargo {
  codigo: number;
  nome: string | null;
}

export interface TsePartido {
  numero: number | null;
  sigla: string | null;
  nome: string | null;
}

/** Item de `candidatos[]` em `GET /candidatura/listar/{ano}/{uf}/{idEleicao}/{cargo}/candidatos`. */
export interface TseCandidatoResumo {
  /** SQ_CANDIDATO — identificador único da candidatura numa eleição. Vira `candidato.id_tse`. */
  id: number;
  nomeUrna: string;
  numero: number | null;
  nomeCompleto: string | null;
  descricaoSituacao: string | null;
  descricaoTotalizacao: string | null;
  nomeColigacao: string | null;
  ufCandidatura: string | null;
  cargo: TseCargo | null;
  partido: TsePartido | null;
}

/** Resposta de `GET /candidatura/listar/...`. */
export interface TseCandidatoListagemResponse {
  unidadeEleitoral: { sigla: string | null; nome: string | null } | null;
  cargo: TseCargo | null;
  candidatos: TseCandidatoResumo[] | null;
}

/** Item de `bens[]` em `GET /candidatura/buscar/...` (só presente no detalhe, não na listagem). */
export interface TseBemCandidato {
  ordem: number;
  descricao: string | null;
  descricaoDeTipoDeBem: string | null;
  valor: number | null;
  dataUltimaAtualizacao: string | null;
}

/**
 * Resposta de `GET /candidatura/buscar/{ano}/{uf}/{idEleicao}/candidato/{idCandidato}`
 * — o detalhe completo de uma candidatura, incluindo bens declarados.
 * "YYYY-MM-DD HH:mm" no formato de `dataUltimaAtualizacao`.
 */
export interface TseCandidatoDetalhe extends TseCandidatoResumo {
  dataUltimaAtualizacao: string | null;
  bens: TseBemCandidato[] | null;
  totalDeBens: number | null;
}

/**
 * Linha de `candidato` relevante para a resolução de entidade do TSE (seção 5,
 * passo 2 do documento de arquitetura — match forte por nome+UF+partido).
 */
export interface TseCandidatoAlvo {
  id: string;
  nome_urna: string;
  uf: string;
  partido_atual: string;
  cargo_pretendido: string;
  id_tse: string | null;
  /** Código de cargo do TSE resolvido a partir de `cargo_pretendido` (ver `resolverCargos`). */
  cargoCodigo: number;
}

/**
 * Cada candidatura resolvida gera até dois registros brutos: um para o
 * registro de candidatura em si, outro para os bens declarados (se houver).
 * Ambos carregam o mesmo `TseCandidatoDetalhe` — já buscado uma única vez
 * por `GET /candidatura/buscar/...` — porque a API expõe os dois fatos numa
 * única resposta; `normalize()` decide qual evento produzir a partir de
 * `kind`.
 */
export interface TseRawEvento {
  kind: "candidatura" | "bens";
  candidatoId: string;
  ano: number;
  uf: string;
  idEleicao: number;
  detalhe: TseCandidatoDetalhe;
}
