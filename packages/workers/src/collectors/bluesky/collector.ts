import { Collector, type CollectorDeps } from "../../collector.js";
import { sha256Hex } from "../../lib/hash.js";
import { logger } from "../../lib/logger.js";
import { truncate } from "../../lib/text.js";
import type { NormalizedEventoInput } from "../../types.js";
import type { BlueskyApiClient } from "./client.js";
import type { BlueskyFeedViewPost, BlueskyReasonRepost } from "./types.js";

const FONTE = "bluesky_posts";
const TITULO_MAX_LEN = 80;
const RESUMO_MAX_LEN = 500;

/**
 * Coletor de posts do Bluesky (AT Protocol) de um candidato — dimensão
 * "Comunicação" (seção 6 do documento de arquitetura). Ver README.md desta
 * pasta para a validação real e a discussão completa da limitação de entity
 * resolution.
 *
 * Entity resolution — DIFERENTE de Câmara/Transparência: o Bluesky não tem
 * nenhum ID interno do candidato equivalente a `id_camara`. `perfil_social`
 * está vazia hoje (seção "Contexto" da tarefa), então este coletor NUNCA
 * infere um handle a partir do nome do candidato (proibido pela seção 5 do
 * documento — "atribuir um processo criminal ao candidato errado é o pior
 * bug possível", e o mesmo raciocínio vale para qualquer evento). Em vez
 * disso, `candidato_id` E `handle` chegam como PARÂMETROS EXPLÍCITOS,
 * fornecidos pelo operador (via CLI) a partir de uma fonte externa confiável
 * — nunca por match automático. `prepare()` só faz duas verificações
 * determinísticas, nenhuma fuzzy:
 *
 *   1. `candidato_id` informado existe mesmo na tabela `candidato` (protege
 *      contra erro de digitação/UUID inválido gerando eventos órfãos).
 *   2. `handle` informado resolve de fato via API pública do Bluesky (se não
 *      resolver, aborta sem gravar nada — mesmo padrão de "aborta em
 *      prepare()" da Câmara/Transparência).
 */
export class BlueskyCollector extends Collector<BlueskyFeedViewPost> {
  readonly fonte = FONTE;

  private candidatoId: string | null = null;
  private did: string | null = null;
  private handleCanonico: string | null = null;

  constructor(
    private readonly candidatoIdInformado: string,
    private readonly handle: string,
    private readonly client: BlueskyApiClient,
    deps: CollectorDeps = {}
  ) {
    super(deps);
  }

  protected async prepare(): Promise<boolean> {
    if (!this.deps.supabase) return false;

    const { data, error } = await this.deps.supabase
      .from("candidato")
      .select("id, nome_urna")
      .eq("id", this.candidatoIdInformado)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      logger.warn(
        FONTE,
        `candidato_id="${this.candidatoIdInformado}" não encontrado na tabela candidato — ` +
          "pulando coleta, nenhum evento órfão será inserido. Cadastre o candidato antes de " +
          "rodar este coletor para ele."
      );
      return false;
    }

    let profile;
    try {
      profile = await this.client.getProfile(this.handle);
    } catch (err) {
      logger.warn(
        FONTE,
        `não foi possível resolver o handle="${this.handle}" via API pública do Bluesky — ` +
          "pulando coleta, nenhum evento órfão será inserido. Confirme se o handle está " +
          "correto e é uma conta pública existente.",
        { erro: err instanceof Error ? err.message : String(err) }
      );
      return false;
    }

    this.candidatoId = data.id as string;
    this.did = profile.did;
    this.handleCanonico = profile.handle;
    logger.info(
      FONTE,
      "candidato_id validado e handle resolvido via API pública (entity resolution " +
        "determinística: candidato_id + handle fornecidos explicitamente pelo operador, " +
        "nunca inferidos por nome)",
      {
        candidatoId: this.candidatoId,
        nomeUrna: data.nome_urna,
        handleInformado: this.handle,
        handleCanonico: this.handleCanonico,
        did: this.did,
        seguidores: profile.followersCount,
      }
    );
    return true;
  }

  async fetchAll(): Promise<BlueskyFeedViewPost[]> {
    return this.client.getAuthorFeed(this.handle);
  }

  normalize(raw: BlueskyFeedViewPost): NormalizedEventoInput | null {
    if (!this.candidatoId) {
      // não deveria acontecer em run() normal (prepare() já teria abortado),
      // mas protege chamadas diretas de normalize() (ex: dry-run sem setup).
      logger.warn(FONTE, "normalize() chamado sem candidato_id resolvido — pulando", {
        uri: raw.post?.uri,
      });
      return null;
    }

    const { post } = raw;

    // Descarta reposts: o post embutido em raw.reason=reasonRepost pertence a
    // OUTRO autor (o candidato só o republicou) — não é fala própria dele.
    // Mesma proteção também via post.author.did !== this.did, que cobre
    // qualquer forma do feed trazer conteúdo de terceiros, não só o caso com
    // `reason` explícito.
    const reason = raw.reason as BlueskyReasonRepost | undefined;
    if (reason?.$type === "app.bsky.feed.defs#reasonRepost") {
      logger.info(FONTE, "item é um repost de outro autor — pulando (não é fala própria do candidato)", {
        uri: post.uri,
        autorOriginal: post.author.handle,
      });
      return null;
    }
    if (this.did && post.author.did !== this.did) {
      logger.info(
        FONTE,
        "post.author.did diverge do did resolvido do candidato — pulando (proteção contra " +
          "atribuir conteúdo de terceiros ao candidato)",
        { uri: post.uri, autorPost: post.author.did, didCandidato: this.did }
      );
      return null;
    }

    if (!post.record?.createdAt) {
      logger.warn(FONTE, "post sem record.createdAt — pulando (data_evento é obrigatória)", {
        uri: post.uri,
      });
      return null;
    }

    const rkey = post.uri.split("/").pop();
    if (!rkey) {
      logger.warn(FONTE, "não foi possível extrair o rkey de post.uri — pulando (fonte_url é obrigatória)", {
        uri: post.uri,
      });
      return null;
    }

    const texto = post.record.text?.trim() ?? "";
    const titulo = texto ? truncate(texto, TITULO_MAX_LEN) : "Post no Bluesky";
    // resumo = texto próprio do candidato, só truncado — não passa por LLM
    // (é conteúdo primário da própria fonte, não matéria de imprensa a
    // resumir; seção 4 do documento: "resumo... nunca cópia de matéria
    // jornalística" não se aplica aqui, mas ainda truncamos por consistência
    // de tamanho com os demais coletores).
    const resumo = texto ? truncate(texto, RESUMO_MAX_LEN) : null;

    const dataEvento = post.record.createdAt.slice(0, 10);
    const handleParaUrl = this.handleCanonico ?? this.handle;
    const fonteUrl = `https://bsky.app/profile/${handleParaUrl}/post/${rkey}`;

    // hash estável: tipo + candidato + identificador da fonte (uri do post no
    // AT Protocol, que é estável e único por post — não muda se o texto for
    // editado, o que o Bluesky nem permite hoje). Contagens de engajamento
    // (like/repost/reply/quoteCount) e o texto completo ficam preservados em
    // raw_payload para uso futuro por jobs de métrica (ex: engajamento
    // relativo, seção 6 do documento) — não há coluna para elas em `evento`.
    const hashConteudo = sha256Hex(`post|${this.candidatoId}|bluesky|${post.uri}`);

    return {
      candidato_id: this.candidatoId,
      tipo: "post",
      categoria: "neutro",
      estagio_juridico: null, // só permitido para tipo='processo' — CHECK constraint no banco
      tema: [], // classificação temática por LLM fica para a Fase 2 (seção 6 do documento)
      titulo,
      resumo,
      data_evento: dataEvento,
      fonte_nome: "Bluesky",
      fonte_url: fonteUrl,
      fonte_confianca: 1, // conteúdo capturado diretamente da API oficial da plataforma, fala primária do próprio candidato — ver README (nota sobre fonte_confianca)
      hash_conteudo: hashConteudo,
    };
  }

  /**
   * Usado apenas pelo modo --dry-run da CLI: faz uma chamada REAL à API
   * pública para resolver o `did` do handle informado (necessário para o
   * filtro de reposts em normalize() se comportar como em produção) e seta um
   * `candidato_id` placeholder, sem tocar no banco. Nunca chamado pelo
   * pipeline real: run() sempre passa por prepare().
   */
  async prepararParaInspecao(candidatoIdPlaceholder: string): Promise<void> {
    const profile = await this.client.getProfile(this.handle);
    this.candidatoId = candidatoIdPlaceholder;
    this.did = profile.did;
    this.handleCanonico = profile.handle;
    logger.info(FONTE, "[dry-run] handle resolvido via API pública real", {
      handleInformado: this.handle,
      handleCanonico: this.handleCanonico,
      did: this.did,
      seguidores: profile.followersCount,
    });
  }
}
