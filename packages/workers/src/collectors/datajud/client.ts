import { fetchJson, RateLimiter } from "../../lib/httpClient.js";
import { logger } from "../../lib/logger.js";
import type { DatajudProcesso, DatajudSearchResponse } from "./types.js";

const FONTE = "datajud_processos";

/**
 * Aliases de tribunal confirmados contra a página oficial de endpoints
 * (https://datajud-wiki.cnj.jus.br/api-publica/endpoints/, consultada em
 * 2026-08-10). Cada alias vira `api_publica_{alias}` na URL. Validamos o
 * `--tribunal` da CLI contra esta lista para falhar cedo com uma mensagem
 * clara, em vez de deixar a API devolver um 404 genérico por um alias
 * digitado errado.
 */
export const TRIBUNAIS_VALIDOS: readonly string[] = [
  // Superiores
  "tst",
  "tse",
  "stj",
  "stm",
  // Justiça Federal (TRF1-6)
  "trf1",
  "trf2",
  "trf3",
  "trf4",
  "trf5",
  "trf6",
  // Justiça Estadual (TJ) — 27 UFs
  "tjac",
  "tjal",
  "tjam",
  "tjap",
  "tjba",
  "tjce",
  "tjdft",
  "tjes",
  "tjgo",
  "tjma",
  "tjmg",
  "tjms",
  "tjmt",
  "tjpa",
  "tjpb",
  "tjpe",
  "tjpi",
  "tjpr",
  "tjrj",
  "tjrn",
  "tjro",
  "tjrr",
  "tjrs",
  "tjsc",
  "tjse",
  "tjsp",
  "tjto",
  // Justiça do Trabalho (TRT1-24)
  "trt1",
  "trt2",
  "trt3",
  "trt4",
  "trt5",
  "trt6",
  "trt7",
  "trt8",
  "trt9",
  "trt10",
  "trt11",
  "trt12",
  "trt13",
  "trt14",
  "trt15",
  "trt16",
  "trt17",
  "trt18",
  "trt19",
  "trt20",
  "trt21",
  "trt22",
  "trt23",
  "trt24",
  // Justiça Eleitoral (TRE) — 27 UFs
  "tre-ac",
  "tre-al",
  "tre-am",
  "tre-ap",
  "tre-ba",
  "tre-ce",
  "tre-dft",
  "tre-es",
  "tre-go",
  "tre-ma",
  "tre-mg",
  "tre-ms",
  "tre-mt",
  "tre-pa",
  "tre-pb",
  "tre-pe",
  "tre-pi",
  "tre-pr",
  "tre-rj",
  "tre-rn",
  "tre-ro",
  "tre-rr",
  "tre-rs",
  "tre-sc",
  "tre-se",
  "tre-sp",
  "tre-to",
  // Justiça Militar
  "tjmmg",
  "tjmrs",
  "tjmsp",
];

/** Só dígitos: a numeração única CNJ (Resolução 65/2008) tem 20 dígitos.
 * Aceita entrada formatada ("0000832-35.2018.4.01.3202") ou só dígitos. */
export function normalizarNumeroProcesso(numero: string): string {
  return numero.replace(/\D/g, "");
}

export function numeroProcessoValido(numero: string): boolean {
  return /^\d{20}$/.test(normalizarNumeroProcesso(numero));
}

export interface DatajudApiClientOptions {
  /** Delay em ms entre requisições. Default: 500ms — conservador, já que
   * este coletor faz no máximo 1 requisição por execução (busca por um
   * numeroProcesso já conhecido, não paginação de listagem). */
  rateLimitMs?: number;
  /** Tentativas extras por requisição além da primeira. Default: 2. */
  retries?: number;
}

/**
 * Cliente HTTP para `api-publica.datajud.cnj.jus.br` — API pública do CNJ
 * sobre um cluster Elasticsearch (Elastic Cloud, confirmado pelos headers
 * `X-Found-Handling-*` numa resposta 401 real). Endpoint e formato
 * confirmados contra o exemplo oficial "Ex. 1 — Pesquisar pelo número de
 * processo" (https://datajud-wiki.cnj.jus.br/api-publica/exemplos/exemplo1,
 * consultado em 2026-08-10) e contra uma requisição real sem chave feita no
 * mesmo dia (ver README desta pasta).
 *
 * Busca **exclusivamente por `numeroProcesso`** — nunca por nome ou CPF de
 * parte, porque a API não tem esse campo (ver nota grande em types.ts e a
 * seção "Entity resolution" do README). O `numeroProcesso` em si, sendo a
 * numeração única nacional (1 processo = 1 número, sem ambiguidade
 * possível), é o único critério de busca desta API que já é, por
 * construção, uma correspondência exata — não há "quase certo" aqui.
 */
export class DatajudApiClient {
  private readonly rateLimiter: RateLimiter;
  private readonly retries: number;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    options: DatajudApiClientOptions = {}
  ) {
    this.rateLimiter = new RateLimiter(options.rateLimitMs ?? 500);
    this.retries = options.retries ?? 2;
  }

  /**
   * `POST /{tribunalAlias}/_search` com `{"query":{"match":{"numeroProcesso":"..."}}}`.
   * Retorna `null` se a busca não encontrar nenhum documento (número
   * inexistente, ainda não indexado, ou tribunal errado) — o chamador nunca
   * deve inventar um processo a partir de uma resposta vazia.
   */
  async buscarPorNumeroProcesso(
    numeroProcesso: string,
    tribunalAlias: string
  ): Promise<DatajudProcesso | null> {
    if (!numeroProcessoValido(numeroProcesso)) {
      throw new Error(
        `numeroProcesso inválido: "${numeroProcesso}" — esperado 20 dígitos (numeração única CNJ, ` +
          "Resolução 65/2008), formatado ou não."
      );
    }
    if (!TRIBUNAIS_VALIDOS.includes(tribunalAlias)) {
      throw new Error(
        `tribunal "${tribunalAlias}" não reconhecido. Aliases válidos confirmados contra ` +
          "https://datajud-wiki.cnj.jus.br/api-publica/endpoints/: " +
          `${TRIBUNAIS_VALIDOS.slice(0, 5).join(", ")}, ... (${TRIBUNAIS_VALIDOS.length} no total).`
      );
    }

    const numero = normalizarNumeroProcesso(numeroProcesso);
    const url = `${this.baseUrl}/api_publica_${tribunalAlias}/_search`;

    logger.info(FONTE, "consultando processo por numeroProcesso", { tribunalAlias });
    await this.rateLimiter.wait();

    const resposta = await fetchJson<DatajudSearchResponse>(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `ApiKey ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: { match: { numeroProcesso: numero } } }),
      },
      { retries: this.retries, fonte: FONTE }
    );

    const hit = resposta.hits?.hits?.[0];
    return hit?._source ?? null;
  }
}
