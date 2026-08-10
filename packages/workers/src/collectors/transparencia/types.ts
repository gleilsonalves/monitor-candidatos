/**
 * Tipos da API "api-de-dados" do Portal da Transparência (CGU) — endpoints
 * CEIS e CNEP. Confirmados contra o schema OpenAPI real publicado em
 * https://api.portaldatransparencia.gov.br/v3/api-docs (consultado em
 * 2026-08-10; ver README.md desta pasta para a discussão completa).
 *
 * Os dois cadastros compartilham o mesmo formato de registro quase inteiro
 * (CNEP só acrescenta `valorMulta`), por isso os tipos abaixo modelam um
 * `RegistroSancaoBase` comum e cada cadastro estende com o que é específico.
 */

/** `GET /api-de-dados/ceis` e `/cnep` — nomeSancionado é usado só como filtro
 * OPCIONAL de busca textual pela própria API; este coletor nunca o usa como
 * critério de entity resolution (ver README — nunca fazemos fuzzy match por
 * nome para eventos de categoria 'controversia'). */
export interface PessoaDTO {
  id?: number;
  cpfFormatado?: string;
  cnpjFormatado?: string;
  numeroInscricaoSocial?: string;
  nome?: string;
  razaoSocialReceita?: string;
  nomeFantasiaReceita?: string;
  /** Observado nos dados reais como "FISICA" ou "JURIDICA". */
  tipo?: string;
}

export interface SancionadoDTO {
  nome?: string;
  /** CPF ou CNPJ formatado (com máscara), conforme o tipo do sancionado. */
  codigoFormatado?: string;
}

export interface TipoSancaoDTO {
  descricaoResumida?: string;
  descricaoPortal?: string;
}

export interface FonteSancaoDTO {
  nomeExibicao?: string;
  telefoneContato?: string;
  enderecoContato?: string;
}

export interface OrgaoSancionadorDTO {
  nome?: string;
  siglaUf?: string;
  poder?: string;
  esfera?: string;
}

export interface CodigoDescricaoDTO {
  codigo?: string;
  descricao?: string;
}

interface RegistroSancaoBase {
  id: number;
  dataReferencia?: string;
  /** Formato observado na documentação de parâmetros de busca: "DD/MM/AAAA".
   * O schema OpenAPI só declara `type: string` (sem exemplo), então o parser
   * em `collector.ts` trata os dois formatos plausíveis (DD/MM/AAAA e
   * AAAA-MM-DD) e nunca "adivinha" — se não reconhecer o formato, o evento é
   * pulado (normalize() retorna null) em vez de gravar uma data errada. */
  dataInicioSancao?: string;
  dataFimSancao?: string;
  dataPublicacaoSancao?: string;
  dataTransitadoJulgado?: string;
  dataOrigemInformacao?: string;
  tipoSancao?: TipoSancaoDTO;
  fonteSancao?: FonteSancaoDTO;
  fundamentacao?: CodigoDescricaoDTO[];
  orgaoSancionador?: OrgaoSancionadorDTO;
  sancionado?: SancionadoDTO;
  pessoa?: PessoaDTO;
  textoPublicacao?: string;
  linkPublicacao?: string;
  detalhamentoPublicacao?: string;
  numeroProcesso?: string;
  abrangenciaDefinidaDecisaoJudicial?: string;
  informacoesAdicionaisDoOrgaoSancionador?: string;
}

/** Registro de `GET /api-de-dados/ceis` — Cadastro de Empresas Inidôneas e
 * Suspensas. Apesar do nome ("Empresas"), a própria API confirma pessoas
 * físicas via `pessoa.tipo === 'FISICA'` e `pessoa.cpfFormatado` — ver
 * README para a citação exata da documentação. */
export type CeisRegistro = RegistroSancaoBase;

/** Registro de `GET /api-de-dados/cnep` — Cadastro Nacional de Empresas
 * Punidas (Lei Anticorrupção, 12.846/2013). Mesma estrutura do CEIS, mais
 * `valorMulta`. */
export interface CnepRegistro extends RegistroSancaoBase {
  valorMulta?: string;
}

/** Discriminante usado pelo coletor para saber de qual cadastro cada
 * registro bruto veio (fetchAll() concatena os dois). */
export type CadastroSancao = "CEIS" | "CNEP";

export interface RegistroSancaoBruto {
  cadastro: CadastroSancao;
  registro: CeisRegistro | CnepRegistro;
}

/** Corpo de erro real observado numa chamada sem `chave-api-dados` (ver
 * README, seção "Validação sem API key"):
 * `{"Erro na API":"Chave de API não informada! ..."}` — HTTP 401. */
export interface TransparenciaApiErro {
  "Erro na API"?: string;
}
