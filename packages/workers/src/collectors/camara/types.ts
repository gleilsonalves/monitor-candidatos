/** Item de `dados[]` em GET /proposicoes?idDeputadoAutor={id}. */
export interface ProposicaoResumo {
  id: number;
  uri: string;
  siglaTipo: string;
  codTipo: number;
  numero: number;
  ano: number;
  ementa: string;
  /** Presente no endpoint de listagem por autor. Formato "YYYY-MM-DDTHH:mm". */
  dataApresentacao?: string;
}

export interface ApiLink {
  rel: string;
  href: string;
}

export interface ProposicoesResponse {
  dados: ProposicaoResumo[];
  links: ApiLink[];
}
