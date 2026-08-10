import { fetchJson, RateLimiter } from "../../lib/httpClient.js";
import type {
  TseCandidatoDetalhe,
  TseCandidatoListagemResponse,
  TseCandidatoResumo,
  TseCargo,
  TseEleicaoOrdinaria,
} from "./types.js";

const FONTE = "tse_candidatura";

export interface TseApiClientOptions {
  /** Delay em ms entre requisições consecutivas. Default: 400ms (mais conservador que a Câmara). */
  rateLimitMs?: number;
  /** Tentativas extras por requisição além da primeira. Default: 2. */
  retries?: number;
}

/**
 * Cliente para a API REST pública do DivulgaCand
 * (`divulgacandcontas.tse.jus.br/divulga/rest/v1`) — a mesma API que
 * alimenta o site oficial de consulta de candidaturas. Não exige chave.
 *
 * Essa API não tem documentação pública formal (não é a mesma coisa que o
 * portal `dadosabertos.tse.jus.br`, que distribui os mesmos dados em CSVs
 * zipados por eleição). Os endpoints abaixo foram descobertos inspecionando
 * as chamadas de rede feitas pelo próprio site do TSE ao navegar por ele
 * (ver README.md desta pasta para o passo a passo e para por que a API REST
 * foi preferida em vez de baixar/parsear os CSVs).
 */
export class TseApiClient {
  private readonly rateLimiter: RateLimiter;
  private readonly retries: number;

  constructor(
    private readonly baseUrl: string,
    options: TseApiClientOptions = {}
  ) {
    this.rateLimiter = new RateLimiter(options.rateLimitMs ?? 400);
    this.retries = options.retries ?? 2;
  }

  /**
   * Lista as eleições ordinárias conhecidas pelo TSE (uma por ano/abrangência).
   * Usado para resolver o `idEleicao` (um ID interno opaco, ex: 20322002026)
   * a partir só do ano — não é previsível/derivável, precisa vir da API.
   */
  async listarEleicoesOrdinarias(): Promise<TseEleicaoOrdinaria[]> {
    const resultado = await fetchJson<TseEleicaoOrdinaria[]>(
      `${this.baseUrl}/eleicao/ordinarias`,
      undefined,
      { retries: this.retries, fonte: FONTE }
    );
    await this.rateLimiter.wait();
    return resultado;
  }

  /**
   * Lista os cargos válidos para uma eleição (Presidente, Governador, Deputado
   * Federal, ...) com seus códigos numéricos. Usado para mapear
   * `candidato.cargo_pretendido` (texto livre) para o `cargo` numérico exigido
   * pelos outros endpoints, sem precisar cravar códigos manualmente no código.
   */
  async listarCargos(ano: number, idEleicao: number): Promise<TseCargo[]> {
    const resultado = await fetchJson<TseCargo[]>(
      `${this.baseUrl}/candidatura/cargos?ano=${ano}&idEleicao=${idEleicao}`,
      undefined,
      { retries: this.retries, fonte: FONTE }
    );
    await this.rateLimiter.wait();
    return resultado;
  }

  /**
   * Lista as candidaturas de uma UF + cargo numa eleição. Não inclui bens
   * declarados (só o endpoint de detalhe traz isso) — usado só para achar o
   * candidato certo por nome antes de buscar o detalhe completo.
   */
  async listarCandidatos(
    ano: number,
    uf: string,
    idEleicao: number,
    cargoCodigo: number
  ): Promise<TseCandidatoResumo[]> {
    const resposta = await fetchJson<TseCandidatoListagemResponse>(
      `${this.baseUrl}/candidatura/listar/${ano}/${uf}/${idEleicao}/${cargoCodigo}/candidatos`,
      undefined,
      { retries: this.retries, fonte: FONTE }
    );
    await this.rateLimiter.wait();
    return resposta.candidatos ?? [];
  }

  /**
   * Busca o detalhe completo de uma candidatura (situação, coligação/federação,
   * bens declarados, ...). `idCandidato` é o SQ_CANDIDATO retornado por
   * `listarCandidatos`.
   */
  async buscarCandidato(
    ano: number,
    uf: string,
    idEleicao: number,
    idCandidato: number
  ): Promise<TseCandidatoDetalhe> {
    const detalhe = await fetchJson<TseCandidatoDetalhe>(
      `${this.baseUrl}/candidatura/buscar/${ano}/${uf}/${idEleicao}/candidato/${idCandidato}`,
      undefined,
      { retries: this.retries, fonte: FONTE }
    );
    await this.rateLimiter.wait();
    return detalhe;
  }
}
