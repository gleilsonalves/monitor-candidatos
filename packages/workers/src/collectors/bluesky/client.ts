import { fetchJson, RateLimiter } from "../../lib/httpClient.js";
import { logger } from "../../lib/logger.js";
import type { BlueskyGetAuthorFeedResponse, BlueskyFeedViewPost, BlueskyProfile } from "./types.js";

const FONTE = "bluesky_posts";

/** Trava de segurança contra paginação infinita em caso de resposta malformada
 * (mesmo papel que MAX_PAGINAS no client da Câmara). */
const MAX_PAGINAS = 50;

export interface BlueskyApiClientOptions {
  /** Delay em ms entre páginas consecutivas. Default: 300ms. */
  rateLimitMs?: number;
  /** Tentativas extras por requisição além da primeira. Default: 2. */
  retries?: number;
  /** Itens por página (máximo aceito pela API: 100). Default: 100. */
  itensPorPagina?: number;
}

/**
 * Cliente HTTP para o endpoint público do AT Protocol
 * (`public.api.bsky.app/xrpc`). API pública, sem chave, sem autenticação —
 * confirmado contra os lexicons oficiais (app.bsky.actor.getProfile,
 * app.bsky.feed.getAuthorFeed) e contra chamadas reais em 10/08/2026. Ver
 * README.md desta pasta para os detalhes da validação.
 */
export class BlueskyApiClient {
  private readonly rateLimiter: RateLimiter;
  private readonly retries: number;
  private readonly itensPorPagina: number;

  constructor(
    private readonly baseUrl: string,
    options: BlueskyApiClientOptions = {}
  ) {
    this.rateLimiter = new RateLimiter(options.rateLimitMs ?? 300);
    this.retries = options.retries ?? 2;
    this.itensPorPagina = Math.min(options.itensPorPagina ?? 100, 100);
  }

  /**
   * Busca o perfil público de um handle (ou DID). Usado em prepare() para
   * confirmar que o handle informado existe e resolver o `did` estável do
   * candidato (necessário em normalize() para distinguir posts próprios de
   * reposts de terceiros — ver collector.ts).
   */
  async getProfile(actor: string): Promise<BlueskyProfile> {
    const url = `${this.baseUrl}/app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`;
    return fetchJson<BlueskyProfile>(url, undefined, { retries: this.retries, fonte: FONTE });
  }

  /**
   * Busca os posts recentes de autoria de um actor (handle ou DID), paginando
   * via `cursor` até a API não devolver mais nenhum (ou até a trava de
   * segurança MAX_PAGINAS). O parâmetro `filter` não é passado — o default da
   * API (`posts_with_replies`) já cobre tanto posts originais quanto
   * respostas do próprio actor (ambos são fala própria dele); reposts de
   * terceiros aparecem no feed mas são descartados em normalize(), não aqui,
   * porque a decisão de "é ou não é fala própria" depende do `did` resolvido
   * do candidato (que só o collector conhece).
   */
  async getAuthorFeed(actor: string): Promise<BlueskyFeedViewPost[]> {
    const todos: BlueskyFeedViewPost[] = [];
    let cursor: string | undefined;
    let pagina = 1;

    do {
      if (pagina > MAX_PAGINAS) {
        logger.warn(FONTE, `limite de ${MAX_PAGINAS} páginas atingido — interrompendo paginação`, {
          actor,
        });
        break;
      }

      logger.info(FONTE, `buscando página ${pagina}`, { actor });
      const params = new URLSearchParams({
        actor,
        limit: String(this.itensPorPagina),
      });
      if (cursor) params.set("cursor", cursor);

      const resposta = await fetchJson<BlueskyGetAuthorFeedResponse>(
        `${this.baseUrl}/app.bsky.feed.getAuthorFeed?${params.toString()}`,
        undefined,
        { retries: this.retries, fonte: FONTE }
      );
      todos.push(...resposta.feed);

      cursor = resposta.cursor;
      pagina++;

      if (cursor) await this.rateLimiter.wait();
    } while (cursor);

    return todos;
  }
}
