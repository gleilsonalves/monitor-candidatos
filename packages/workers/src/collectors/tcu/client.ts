import { fetchJson, RateLimiter } from "../../lib/httpClient.js";
import { logger } from "../../lib/logger.js";
import type { ResponsavelSancaoTcuDTO } from "./types.js";

const FONTE = "tcu_integridade";

export interface TcuCertidoesApiClientOptions {
  /** Delay em ms entre as duas chamadas (contas irregulares + inabilitados).
   * Default: 500ms (mesmo conservadorismo do client do Portal da
   * Transparência, mesmo sem indício de rate limit agressivo nesta API). */
  rateLimitMs?: number;
  /** Tentativas extras por requisição além da primeira. Default: 2. */
  retries?: number;
}

/**
 * Client HTTP para os webservices públicos REST do TCU em
 * `certidoes.apps.tcu.gov.br/api/publico/*`. Confirmado com requisições
 * reais (ver README desta pasta): `POST` com o filtro no corpo JSON, sem
 * nenhuma chave/autenticação, resposta `200` com array JSON.
 *
 * **Importante**: os endpoints NÃO paginam e NÃO exigem filtro — um `POST`
 * com corpo `{}` retorna o cadastro inteiro (confirmado: ~410KB só para
 * `responsaveis-inabilitados` sem filtro, em 2026-08-10). Por isso este
 * client **sempre** envia `cpf` no corpo; nunca chama sem filtro, para não
 * baixar o cadastro nacional inteiro a cada execução.
 *
 * Entity resolution: assim como o client do Portal da Transparência, busca
 * **só por CPF** (`cpf`, no corpo do POST) — nunca por nome
 * (`parteNome`), que a API também aceita mas que abriria a porta para
 * homônimo (seção 5 do documento de arquitetura). O CPF vem de fora deste
 * client (ver `collector.ts` e o README desta pasta).
 */
export class TcuCertidoesApiClient {
  private readonly rateLimiter: RateLimiter;
  private readonly retries: number;

  constructor(
    private readonly baseUrl: string,
    options: TcuCertidoesApiClientOptions = {}
  ) {
    this.rateLimiter = new RateLimiter(options.rateLimitMs ?? 500);
    this.retries = options.retries ?? 2;
  }

  /** `POST /responsaveis-contas-irregulares` — responsáveis com contas
   * julgadas irregulares pelo TCU (com ou sem inabilitação associada). */
  async buscarContasIrregularesPorCpf(cpf: string): Promise<ResponsavelSancaoTcuDTO[]> {
    return this.buscar("responsaveis-contas-irregulares", cpf);
  }

  /** `POST /responsaveis-inabilitados` — responsáveis inabilitados para o
   * exercício de função pública (sanção mais grave, com prazo definido em
   * `dataFinalSancao`). */
  async buscarInabilitadosPorCpf(cpf: string): Promise<ResponsavelSancaoTcuDTO[]> {
    return this.buscar("responsaveis-inabilitados", cpf);
  }

  private async buscar(recurso: string, cpf: string): Promise<ResponsavelSancaoTcuDTO[]> {
    const url = `${this.baseUrl}/${recurso}`;

    logger.info(FONTE, `consultando ${recurso}`);
    const resultado = await fetchJson<ResponsavelSancaoTcuDTO[]>(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cpf }),
      },
      { retries: this.retries, fonte: FONTE }
    );

    await this.rateLimiter.wait();
    return resultado ?? [];
  }
}
