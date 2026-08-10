import { fetchJson, RateLimiter } from "../../lib/httpClient.js";
import { logger } from "../../lib/logger.js";
import type { ProposicaoResumo, ProposicoesResponse } from "./types.js";

const FONTE = "camara_proposicoes";

/** Trava de segurança contra paginação infinita em caso de resposta malformada. */
const MAX_PAGINAS = 500;

export interface CamaraApiClientOptions {
  /** Delay em ms entre páginas consecutivas. Default: 300ms. */
  rateLimitMs?: number;
  /** Tentativas extras por requisição além da primeira. Default: 2. */
  retries?: number;
  /** Itens por página (máximo aceito pela API: 100). Default: 100. */
  itensPorPagina?: number;
}

/**
 * Cliente HTTP para `dadosabertos.camara.leg.br/api/v2`. API pública, sem
 * necessidade de chave. Encapsula paginação, retry e rate limit — a lógica
 * de negócio (normalização, resolução de entidade) fica no collector.
 */
export class CamaraApiClient {
  private readonly rateLimiter: RateLimiter;
  private readonly retries: number;
  private readonly itensPorPagina: number;

  constructor(
    private readonly baseUrl: string,
    options: CamaraApiClientOptions = {}
  ) {
    this.rateLimiter = new RateLimiter(options.rateLimitMs ?? 300);
    this.retries = options.retries ?? 2;
    this.itensPorPagina = options.itensPorPagina ?? 100;
  }

  /**
   * Busca todas as proposições de autoria de um deputado, paginando via o
   * link `rel=next` retornado pela API até não haver mais próxima página.
   */
  async listarProposicoesPorAutor(idDeputadoAutor: number): Promise<ProposicaoResumo[]> {
    const todas: ProposicaoResumo[] = [];
    let url: string | undefined =
      `${this.baseUrl}/proposicoes?idDeputadoAutor=${idDeputadoAutor}` +
      `&itens=${this.itensPorPagina}&ordem=DESC&ordenarPor=id`;

    let pagina = 1;
    while (url) {
      if (pagina > MAX_PAGINAS) {
        logger.warn(FONTE, `limite de ${MAX_PAGINAS} páginas atingido — interrompendo paginação`, {
          idDeputadoAutor,
        });
        break;
      }

      logger.info(FONTE, `buscando página ${pagina}`, { idDeputadoAutor });
      const resposta: ProposicoesResponse = await fetchJson<ProposicoesResponse>(
        url,
        undefined,
        { retries: this.retries, fonte: FONTE }
      );
      todas.push(...resposta.dados);

      const proximo = resposta.links?.find((link) => link.rel === "next");
      url = proximo?.href;
      pagina++;

      if (url) await this.rateLimiter.wait();
    }

    return todas;
  }
}
