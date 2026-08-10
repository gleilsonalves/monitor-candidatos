import { fetchJson, RateLimiter } from "../../lib/httpClient.js";
import { logger } from "../../lib/logger.js";
import type { MetaAdArchiveItem, MetaAdsArchiveResponse } from "./types.js";

const FONTE = "meta_ads";

/** Trava de segurança contra paginação infinita em caso de resposta malformada. */
const MAX_PAGINAS = 200;

/** Campos pedidos ao endpoint — só os usados por normalize() (seção "Modelagem"
 * do README desta pasta). Pedir menos campos do que o necessário faz a API
 * omitir dado que precisamos; pedir mais do que o necessário desperdiça a
 * cota de rate limit sem motivo. */
const CAMPOS = [
  "id",
  "page_id",
  "page_name",
  "ad_creation_time",
  "ad_delivery_start_time",
  "ad_delivery_stop_time",
  "ad_snapshot_url",
  "ad_creative_bodies",
  "ad_creative_link_captions",
  "ad_creative_link_titles",
  "bylines",
  "currency",
  "spend",
  "impressions",
  "publisher_platforms",
].join(",");

export interface MetaAdsApiClientOptions {
  /** Delay em ms entre páginas consecutivas. Default: 1000ms (mais
   * conservador que Câmara/Transparência — a Graph API tem rate limit
   * dinâmico por app e por token, mais restritivo com apps recém-aprovados). */
  rateLimitMs?: number;
  /** Tentativas extras por requisição além da primeira. Default: 2. */
  retries?: number;
  /** Itens por página. Default: 100. */
  limite?: number;
}

/**
 * Cliente HTTP para `graph.facebook.com/<versão>/ads_archive` (Meta Ad
 * Library API). Endpoint confirmado contra a documentação oficial e contra
 * requisições reais sem `access_token` — ver README.md desta pasta, seção
 * "Endpoint exato e validação sem token", para o detalhe completo (incluindo
 * os corpos de erro reais observados em 2026-08-10).
 *
 * Exige um `access_token` de app Meta com acesso aprovado a anúncios
 * políticos (processo de verificação de identidade do desenvolvedor — ver
 * README, seção "Como conseguir o token"). Este client não tem esse token;
 * ele só constrói a URL/parâmetros corretos e propaga o erro da API (que sem
 * token vem como 400/500 com corpo de erro OAuth, nunca 404 — prova de que a
 * rota está certa).
 *
 * Entity resolution: busca **exclusivamente por `search_page_ids`** (ID da
 * página do Facebook do candidato, fornecido pelo operador via CLI — nunca
 * inferido). Este client **não** implementa busca por `search_terms` (nome
 * livre) — ver README, seção "Entity resolution", para a justificativa.
 */
export class MetaAdsApiClient {
  private readonly rateLimiter: RateLimiter;
  private readonly retries: number;
  private readonly limite: number;

  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: string,
    options: MetaAdsApiClientOptions = {}
  ) {
    this.rateLimiter = new RateLimiter(options.rateLimitMs ?? 1000);
    this.retries = options.retries ?? 2;
    this.limite = options.limite ?? 100;
  }

  /**
   * Busca todos os anúncios políticos/de interesse público arquivados para
   * uma página do Facebook específica (`search_page_ids`), paginando via
   * `paging.next` até não haver mais próxima página.
   *
   * Parâmetros fixos, exigidos pela API para esta categoria de anúncio
   * (documentação oficial, ver README):
   *   - `ad_type=POLITICAL_AND_ISSUE_ADS`
   *   - `ad_reached_countries=["BR"]` (obrigatório em toda chamada ao
   *     endpoint, não só para anúncios políticos)
   *   - `ad_active_status=ALL` (inclui anúncios já encerrados, não só ativos
   *     — um anúncio de campanha que já parou de veicular ainda é um fato
   *     relevante de "investimento em propaganda")
   */
  async buscarAnunciosPorPageId(pageId: string): Promise<MetaAdArchiveItem[]> {
    const todos: MetaAdArchiveItem[] = [];

    const params = new URLSearchParams({
      ad_type: "POLITICAL_AND_ISSUE_ADS",
      ad_reached_countries: JSON.stringify(["BR"]),
      search_page_ids: JSON.stringify([pageId]),
      ad_active_status: "ALL",
      fields: CAMPOS,
      limit: String(this.limite),
      access_token: this.accessToken,
    });

    let url: string | undefined = `${this.baseUrl}/ads_archive?${params.toString()}`;
    let pagina = 1;

    while (url) {
      if (pagina > MAX_PAGINAS) {
        logger.warn(FONTE, `limite de ${MAX_PAGINAS} páginas atingido — interrompendo paginação`, {
          pageId,
        });
        break;
      }

      logger.info(FONTE, `buscando página ${pagina}`, { pageId });
      const resposta: MetaAdsArchiveResponse = await fetchJson<MetaAdsArchiveResponse>(
        url,
        undefined,
        { retries: this.retries, fonte: FONTE }
      );
      todos.push(...(resposta.data ?? []));

      url = resposta.paging?.next;
      pagina++;

      if (url) await this.rateLimiter.wait();
    }

    return todos;
  }

  /**
   * Monta (sem chamar) a URL exata que seria usada para validar a rota sem
   * token — usado pelo modo --dry-run da CLI para fazer uma requisição REAL
   * sem `access_token` e confirmar o formato do erro (ver README). Separado
   * de `buscarAnunciosPorPageId` porque aqui queremos deixar o `access_token`
   * de fora de propósito, não usar o vazio/ausente por acidente.
   */
  montarUrlValidacaoSemToken(pageId: string): string {
    const params = new URLSearchParams({
      ad_type: "POLITICAL_AND_ISSUE_ADS",
      ad_reached_countries: JSON.stringify(["BR"]),
      search_page_ids: JSON.stringify([pageId]),
      ad_active_status: "ALL",
      fields: CAMPOS,
    });
    return `${this.baseUrl}/ads_archive?${params.toString()}`;
  }
}
