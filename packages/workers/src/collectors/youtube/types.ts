/**
 * Tipos das respostas da YouTube Data API v3 (`googleapis.com/youtube/v3`)
 * usadas por este coletor. Cobrem só os campos consumidos — a API retorna
 * muito mais por `part`, mas pedir menos `part` custa menos quota.
 *
 * Endpoints usados (ver README.md desta pasta para a justificativa de não
 * usar `search.list`, que custa 100 unidades por chamada):
 *   - GET /channels?part=contentDetails       (1 unidade)
 *   - GET /playlistItems?part=snippet          (1 unidade por página)
 *   - GET /videos?part=statistics              (1 unidade por lote de até 50 ids)
 */

/** Resposta de GET /channels?part=contentDetails&id={channelId}. */
export interface YoutubeChannelListResponse {
  items?: YoutubeChannelItem[];
}

export interface YoutubeChannelItem {
  id: string;
  contentDetails: {
    relatedPlaylists: {
      /** ID da playlist "uploads" do canal — lista todos os vídeos publicados,
       * na ordem em que foram publicados. É o atalho oficial recomendado pela
       * documentação do Google em vez de `search.list` para listar uploads. */
      uploads: string;
    };
  };
}

/** Resposta de GET /playlistItems?part=snippet&playlistId={uploadsPlaylistId}. */
export interface YoutubePlaylistItemsResponse {
  items?: YoutubePlaylistItem[];
  nextPageToken?: string;
  pageInfo?: { totalResults: number; resultsPerPage: number };
}

export interface YoutubePlaylistItem {
  /** ID do item dentro da playlist — NÃO é o ID do vídeo. */
  id: string;
  snippet: {
    title: string;
    /** Descrição completa do vídeo, escrita pelo canal — truncamos ao normalizar
     * (nunca é texto de terceiro/imprensa, então truncar não é questão de
     * direito autoral, só de tamanho de campo). */
    description: string;
    /** Data/hora de publicação do item na playlist, formato RFC3339 (ISO 8601). */
    publishedAt: string;
    channelId: string;
    resourceId: {
      kind: string;
      videoId: string;
    };
  };
}

/** Resposta de GET /videos?part=statistics&id={id1,id2,...} (até 50 ids por chamada). */
export interface YoutubeVideosListResponse {
  items?: YoutubeVideoListItem[];
}

export interface YoutubeVideoListItem {
  id: string;
  /**
   * Todos os campos vêm como string na API (ex: `"1234"`), mesmo sendo
   * numéricos. Contagens públicas e agregadas — nunca o conteúdo de um
   * comentário individual (seção 2.2 do documento de arquitetura proíbe usar
   * sentimento de comentário como proxy de qualidade). `likeCount` e
   * `commentCount` podem estar ausentes quando o dono do canal desativa
   * curtidas/comentários publicamente.
   */
  statistics?: {
    viewCount?: string;
    likeCount?: string;
    commentCount?: string;
    favoriteCount?: string;
  };
}

/**
 * Registro bruto após o merge feito pelo client: metadados de
 * `playlistItems` (título, descrição, data) + estatísticas de `videos`
 * (views/likes/comentários). É este tipo que vira `TRaw` do collector e é
 * gravado em `raw_payload`.
 */
export interface YoutubeVideoBruto {
  videoId: string;
  channelId: string;
  titulo: string;
  descricao: string;
  /** RFC3339 (ISO 8601), ex: "2026-08-01T12:00:00Z". */
  publicadoEm: string;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
}
