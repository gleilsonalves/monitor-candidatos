/**
 * Tipos dos webservices públicos REST do TCU expostos em
 * `certidoes.apps.tcu.gov.br/api/publico/*`. Confirmados por requisições
 * reais feitas em 2026-08-10 (ver README.md desta pasta para a evidência
 * completa — payloads de resposta reais, incluindo casos reais de
 * responsáveis com contas irregulares e inabilitados). Não há OpenAPI/Swagger
 * publicado para estes endpoints (diferente do Portal da Transparência); os
 * campos abaixo refletem só o que foi observado nas respostas reais.
 *
 * Os dois registros usados por este coletor (contas irregulares e
 * inabilitados) compartilham quase o mesmo formato de linha — por isso um
 * único DTO comum (`ResponsavelSancaoTcuDTO`) cobre ambos; os campos que só
 * aparecem em um dos dois (`dataAcordao`, `dataFinalSancao`,
 * `numeroAcordaoFormatado`) são opcionais.
 */

/**
 * Uma linha de resposta de `POST /responsaveis-contas-irregulares` ou
 * `POST /responsaveis-inabilitados`. `tipoRegistro` distingue CPF (pessoa
 * física) de CNPJ (pessoa jurídica) — os dois cadastros do TCU misturam os
 * dois tipos numa mesma lista, então este coletor sempre filtra por
 * `tipoRegistro === 'CPF'` antes de gerar um evento (nunca atribui uma
 * sanção de empresa a um candidato).
 */
export interface ResponsavelSancaoTcuDTO {
  numeroProcessoFormatado?: string;
  nome?: string;
  /** Observado como "CPF" ou "CNPJ". */
  tipoRegistro?: string;
  /** CPF/CNPJ formatado com máscara (ex: "670.341.443-20"). A API aceita o
   * filtro de busca tanto com quanto sem máscara (confirmado empiricamente —
   * ver README); a resposta sempre vem mascarada. */
  numeroRegistro?: string;
  municipio?: string;
  uf?: string;
  /** Só observado em `responsaveis-inabilitados`. Formato "DD/MM/AAAA". */
  numeroAcordaoFormatado?: string | null;
  /** Só observado em `responsaveis-inabilitados`. Formato "DD/MM/AAAA". */
  dataAcordao?: string;
  /** Presente nos dois registros. Formato "DD/MM/AAAA". Usado como
   * `data_evento` — é a data em que a decisão se tornou definitiva. */
  dataTransitoEmJulgado?: string;
  /** Só observado em `responsaveis-inabilitados` — data final do período de
   * inabilitação. Formato "DD/MM/AAAA". */
  dataFinalSancao?: string;
  /** Link público para a jurisprudência completa do processo — usado como
   * `fonte_url`. */
  linkDeliberacoesProcesso?: string;
  /** Link público de acompanhamento processual (TVP). Não usado como
   * `fonte_url` principal (menos estável/legível que `linkDeliberacoesProcesso`),
   * mas incluído no `resumo` quando presente. */
  linkAcompanhamentoProcesso?: string;
  codigoProcesso?: number;
  seProcessoGestao?: string;
}

/** Discriminante do registro de origem — os dois cadastros do TCU usados por
 * este coletor (ver README para por que só estes dois e não o endpoint
 * genérico de acórdãos). */
export type RegistroTcu = "CONTAS_IRREGULARES" | "INABILITADOS";

export interface RegistroTcuBruto {
  registro: RegistroTcu;
  dado: ResponsavelSancaoTcuDTO;
}
