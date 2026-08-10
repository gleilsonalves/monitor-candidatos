import { fetchJson, RateLimiter } from "../../lib/httpClient.js";
import { logger } from "../../lib/logger.js";
import type { CeisRegistro, CnepRegistro } from "./types.js";

const FONTE = "transparencia_sancoes";

/** Trava de segurança contra paginação infinita em caso de resposta malformada. */
const MAX_PAGINAS = 200;

export interface PortalTransparenciaApiClientOptions {
  /** Delay em ms entre páginas consecutivas. Default: 500ms (mais conservador
   * que o da Câmara — a API do Portal da Transparência é mais restritiva com
   * rate limit por chave). */
  rateLimitMs?: number;
  /** Tentativas extras por requisição além da primeira. Default: 2. */
  retries?: number;
}

/**
 * Cliente HTTP para `api.portaldatransparencia.gov.br/api-de-dados`
 * (endpoints CEIS e CNEP). Exige a header `chave-api-dados` em toda
 * requisição — sem ela a API responde `401 Unauthorized` com um corpo
 * `{"Erro na API": "Chave de API não informada! ..."}` (confirmado com uma
 * chamada real sem chave em 2026-08-10, ver README desta pasta).
 *
 * Entity resolution: **nunca** busca por nome (`nomeSancionado`) — só por
 * CPF (`codigoSancionado`), que é o único critério determinístico. O nome é
 * suportado pela API, mas usá-lo aqui abriria a porta para o pior tipo de
 * erro deste sistema (atribuir uma sanção a um homônimo). Ver README, seção
 * "Entity resolution" e seção 5 do documento de arquitetura.
 */
export class PortalTransparenciaApiClient {
  private readonly rateLimiter: RateLimiter;
  private readonly retries: number;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    options: PortalTransparenciaApiClientOptions = {}
  ) {
    this.rateLimiter = new RateLimiter(options.rateLimitMs ?? 500);
    this.retries = options.retries ?? 2;
  }

  async buscarCeisPorCpf(cpf: string): Promise<CeisRegistro[]> {
    return this.listarPorCpf<CeisRegistro>("ceis", cpf);
  }

  async buscarCnepPorCpf(cpf: string): Promise<CnepRegistro[]> {
    return this.listarPorCpf<CnepRegistro>("cnep", cpf);
  }

  /**
   * Pagina `GET /api-de-dados/{cadastro}?codigoSancionado={cpf}&pagina={n}`
   * até a API retornar uma página vazia. O tamanho de página não é
   * documentado no OpenAPI (`pagina` é o único parâmetro de paginação), então
   * paramos por "página vazia" em vez de assumir um tamanho fixo.
   */
  private async listarPorCpf<T>(cadastro: "ceis" | "cnep", cpf: string): Promise<T[]> {
    const todos: T[] = [];
    let pagina = 1;

    while (pagina <= MAX_PAGINAS) {
      const url =
        `${this.baseUrl}/${cadastro}?codigoSancionado=${encodeURIComponent(cpf)}` +
        `&pagina=${pagina}`;

      logger.info(FONTE, `buscando página ${pagina}`, { cadastro });
      const resultado = await fetchJson<T[]>(
        url,
        { headers: { "chave-api-dados": this.apiKey } },
        { retries: this.retries, fonte: FONTE }
      );

      if (!resultado || resultado.length === 0) break;
      todos.push(...resultado);

      if (resultado.length === 0) break;
      pagina++;
      await this.rateLimiter.wait();
    }

    if (pagina > MAX_PAGINAS) {
      logger.warn(FONTE, `limite de ${MAX_PAGINAS} páginas atingido — interrompendo paginação`, {
        cadastro,
      });
    }

    return todos;
  }
}
