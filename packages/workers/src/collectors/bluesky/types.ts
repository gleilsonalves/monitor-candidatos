/**
 * Tipos da API pública do AT Protocol (Bluesky), confirmados em 10/08/2026
 * contra:
 *   - lexicons oficiais em github.com/bluesky-social/atproto
 *     (lexicons/app/bsky/actor/getProfile.json,
 *      lexicons/app/bsky/feed/getAuthorFeed.json)
 *   - chamadas reais a https://public.api.bsky.app/xrpc/ (sem chave)
 *
 * Só os campos usados por este coletor são tipados — a resposta real da API
 * traz muito mais (avatar, labels, embeds, associated, verification, ...),
 * que fica preservado integralmente em `raw_payload` (payload bruto), mas
 * não precisa de tipo próprio aqui.
 */

/** Resposta de GET /xrpc/app.bsky.actor.getProfile (app.bsky.actor.defs#profileViewDetailed, campos usados). */
export interface BlueskyProfile {
  did: string;
  handle: string;
  displayName?: string;
  description?: string;
  followersCount?: number;
  followsCount?: number;
  postsCount?: number;
}

/** Subconjunto usado do record do post (app.bsky.feed.post). */
export interface BlueskyPostRecord {
  text?: string;
  /** ISO 8601, ex: "2026-08-10T18:23:59.963Z". */
  createdAt: string;
  /** Presente quando o post é uma resposta a outro post (ainda autoria do próprio candidato). */
  reply?: {
    root: { uri: string; cid: string };
    parent: { uri: string; cid: string };
  };
}

/** app.bsky.feed.defs#postView (campos usados). */
export interface BlueskyPostView {
  /** at://{did}/app.bsky.feed.post/{rkey} — identificador estável do post. */
  uri: string;
  cid: string;
  author: {
    did: string;
    handle: string;
  };
  record: BlueskyPostRecord;
  /** Contagens agregadas — nunca o conteúdo das respostas em si (proibido medir
   * sentimento de terceiros como proxy de qualidade, seção 2.2 do documento). */
  replyCount?: number;
  repostCount?: number;
  likeCount?: number;
  quoteCount?: number;
  indexedAt: string;
}

/**
 * app.bsky.feed.defs#reasonRepost — presente em `feed[].reason` quando o item
 * é um REPOST feito pelo actor consultado (o `post` embutido pertence a OUTRO
 * autor). Usado só para detectar e descartar esse caso em normalize(): um
 * repost não é fala própria do candidato.
 */
export interface BlueskyReasonRepost {
  $type: "app.bsky.feed.defs#reasonRepost";
  by: { did: string; handle: string };
  indexedAt: string;
}

/** app.bsky.feed.defs#feedViewPost (campos usados). */
export interface BlueskyFeedViewPost {
  post: BlueskyPostView;
  /** Presente quando o post é uma resposta (a algum post, do próprio actor ou de terceiros). */
  reply?: unknown;
  /** Presente quando o item chegou ao feed via repost (não é post original do actor). */
  reason?: BlueskyReasonRepost | { $type: string };
}

/** Resposta de GET /xrpc/app.bsky.feed.getAuthorFeed. */
export interface BlueskyGetAuthorFeedResponse {
  cursor?: string;
  feed: BlueskyFeedViewPost[];
}
