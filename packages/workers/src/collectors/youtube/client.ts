import { fetchJson, RateLimiter } from "../../lib/httpClient.js";
import { logger } from "../../lib/logger.js";
import type {
  YoutubeChannelListResponse,
  YoutubePlaylistItemsResponse,
  YoutubeVideosListResponse,
  YoutubeVideoBruto,
} from "./types.js";

const FONTE = "youtube_videos";

/** Trava de segurança contra paginação infinita em caso de resposta malformada.
 * 50 páginas * 50 itens/página = até 2500 vídeos por canal, mais que suficiente. */
const MAX_PAGINAS = 50;

/** Máximo de ids aceito por chamada de `videos.list` (limite documentado da API). */
const VIDEOS_POR_LOTE = 50;

export interface YoutubeApiClientOptions {
  /** Delay em ms entre chamadas consecutivas. Default: 300ms. */
  rateLimitMs?: number;
  /** Tentativas extras por requisição além da primeira. Default: 2. */
  retries?: number;
}

/**
 * Cliente HTTP para `www.googleapis.com/youtube/v3`. Exige uma API key do
 * Google Cloud Console (ver README desta pasta para como conseguir uma,
 * gratuita, 10.000 unidades/dia).
 *
 * A chave é enviada via header `X-Goog-Api-Key` (suportado nativamente pelas
 * APIs do Google como alternativa ao query param `?key=`), não na URL —
 * assim ela nunca aparece nos logs de retry de `fetchJson` (que loga a URL
 * completa em caso de nova tentativa), seguindo o mesmo cuidado que o
 * coletor do Portal da Transparência tem com `chave-api-dados` (lá também é
 * header, nunca query string).
 *
 * Endpoints usados, em ordem de custo de quota (ver README para os testes
 * reais contra a API sem chave, que confirmam as três rotas):
 *   1. `channels.list` (contentDetails) — resolve o ID da playlist de
 *      uploads do canal. 1 unidade.
 *   2. `playlistItems.list` — lista os vídeos da playlist de uploads,
 *      paginado. 1 unidade por página (até 50 vídeos/página).
 *   3. `videos.list` (statistics) — busca views/likes/comentários em lotes
 *      de até 50 ids. 1 unidade por lote.
 *
 * Deliberadamente NÃO usa `search.list`: é o mesmo dado (vídeos do canal),
 * mas custa 100 unidades por chamada — 100x mais caro que o caminho via
 * playlist de uploads, sem nenhuma vantagem para este caso de uso.
 */
export class YoutubeApiClient {
  private readonly rateLimiter: RateLimiter;
  private readonly retries: number;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    options: YoutubeApiClientOptions = {}
  ) {
    this.rateLimiter = new RateLimiter(options.rateLimitMs ?? 300);
    this.retries = options.retries ?? 2;
  }

  private authHeaders(): Record<string, string> {
    return this.apiKey ? { "X-Goog-Api-Key": this.apiKey } : {};
  }

  /**
   * Resolve o ID da playlist de uploads do canal. Retorna `null` se o
   * `channelId` não existir (a API responde 200 com `items: []`, não um
   * erro — é assim que a YouTube Data API sinaliza "não encontrado" aqui).
   */
  async resolverUploadsPlaylistId(channelId: string): Promise<string | null> {
    const url = `${this.baseUrl}/channels?part=contentDetails&id=${encodeURIComponent(channelId)}`;
    const resposta = await fetchJson<YoutubeChannelListResponse>(
      url,
      { headers: this.authHeaders() },
      { retries: this.retries, fonte: FONTE }
    );
    return resposta.items?.[0]?.contentDetails?.relatedPlaylists?.uploads ?? null;
  }

  /**
   * Lista todos os vídeos publicados no canal (via a playlist de uploads) já
   * enriquecidos com estatísticas de engajamento. Combina os três endpoints
   * descritos na doc da classe.
   */
  async listarVideosDoCanal(channelId: string): Promise<YoutubeVideoBruto[]> {
    const uploadsPlaylistId = await this.resolverUploadsPlaylistId(channelId);
    if (!uploadsPlaylistId) {
      logger.warn(
        FONTE,
        `canal ${channelId} não encontrado (ou sem playlist de uploads) na resposta da API`,
        { channelId }
      );
      return [];
    }

    await this.rateLimiter.wait();
    const itensPlaylist = await this.paginarPlaylistItems(uploadsPlaylistId);
    if (itensPlaylist.length === 0) return [];

    const videoIds = itensPlaylist.map((item) => item.snippet.resourceId.videoId);
    const estatisticasPorVideoId = await this.buscarEstatisticasEmLotes(videoIds);

    return itensPlaylist.map((item): YoutubeVideoBruto => {
      const videoId = item.snippet.resourceId.videoId;
      const stats = estatisticasPorVideoId.get(videoId);
      return {
        videoId,
        channelId: item.snippet.channelId,
        titulo: item.snippet.title,
        descricao: item.snippet.description,
        publicadoEm: item.snippet.publishedAt,
        viewCount: parseContagem(stats?.viewCount),
        likeCount: parseContagem(stats?.likeCount),
        commentCount: parseContagem(stats?.commentCount),
      };
    });
  }

  private async paginarPlaylistItems(
    playlistId: string
  ): Promise<NonNullable<YoutubePlaylistItemsResponse["items"]>> {
    const todos: NonNullable<YoutubePlaylistItemsResponse["items"]> = [];
    let pageToken: string | undefined;
    let pagina = 1;

    do {
      if (pagina > MAX_PAGINAS) {
        logger.warn(
          FONTE,
          `limite de ${MAX_PAGINAS} páginas atingido — interrompendo paginação`,
          { playlistId }
        );
        break;
      }

      const url =
        `${this.baseUrl}/playlistItems?part=snippet&maxResults=50&playlistId=${encodeURIComponent(playlistId)}` +
        (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");

      logger.info(FONTE, `buscando página ${pagina} de vídeos`, { playlistId });
      const resposta = await fetchJson<YoutubePlaylistItemsResponse>(
        url,
        { headers: this.authHeaders() },
        { retries: this.retries, fonte: FONTE }
      );
      todos.push(...(resposta.items ?? []));
      pageToken = resposta.nextPageToken;
      pagina++;

      if (pageToken) await this.rateLimiter.wait();
    } while (pageToken);

    return todos;
  }

  private async buscarEstatisticasEmLotes(
    videoIds: string[]
  ): Promise<Map<string, YoutubeVideoListItem_Statistics>> {
    const mapa = new Map<string, YoutubeVideoListItem_Statistics>();

    for (let i = 0; i < videoIds.length; i += VIDEOS_POR_LOTE) {
      const lote = videoIds.slice(i, i + VIDEOS_POR_LOTE);
      const url = `${this.baseUrl}/videos?part=statistics&id=${lote.map(encodeURIComponent).join(",")}`;

      const resposta = await fetchJson<YoutubeVideosListResponse>(
        url,
        { headers: this.authHeaders() },
        { retries: this.retries, fonte: FONTE }
      );
      for (const item of resposta.items ?? []) {
        mapa.set(item.id, item.statistics ?? {});
      }

      if (i + VIDEOS_POR_LOTE < videoIds.length) await this.rateLimiter.wait();
    }

    return mapa;
  }
}

type YoutubeVideoListItem_Statistics = NonNullable<
  YoutubeVideosListResponse["items"]
>[number]["statistics"];

function parseContagem(valor: string | undefined): number | null {
  if (valor === undefined) return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}
