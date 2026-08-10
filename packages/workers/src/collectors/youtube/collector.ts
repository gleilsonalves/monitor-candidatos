import { Collector, type CollectorDeps } from "../../collector.js";
import { sha256Hex } from "../../lib/hash.js";
import { logger } from "../../lib/logger.js";
import { truncate } from "../../lib/text.js";
import type { NormalizedEventoInput } from "../../types.js";
import type { YoutubeApiClient } from "./client.js";
import type { YoutubeVideoBruto } from "./types.js";

const FONTE = "youtube_videos";
const RESUMO_MAX_LEN = 500;

/**
 * Coletor de vídeos publicados no canal do YouTube de um candidato —
 * dimensão "Comunicação" (seção 6 do documento de arquitetura): volume,
 * cadência (via `data_evento` de cada vídeo), temas (`tema[]` fica vazio até
 * a classificação por LLM da Fase 2) e engajamento agregado (views/likes/
 * comentários, sempre como CONTAGEM pública — nunca sentimento de comentário
 * como proxy de qualidade, proibido pela seção 2.2).
 *
 * Entity resolution — NUNCA por nome do candidato. `candidato_id` é sempre
 * um parâmetro explícito (não há passo de resolução: o operador já informa o
 * uuid real). O `channelId` do YouTube tem exatamente dois caminhos válidos,
 * ambos determinísticos:
 *
 *   1. Explícito — passado ao construtor (tipicamente via `--channelId` da
 *      CLI). Usado direto, sem tocar no banco.
 *   2. `perfil_social` — quando nenhum `channelId` explícito é passado,
 *      `prepare()` busca `perfil_social` filtrando
 *      `plataforma='youtube' AND verificado=true` para o `candidato_id`
 *      informado. Só usa o registro se ele já foi validado manualmente
 *      (seção 2.1 do documento: "seed manual de handles sociais validados à
 *      mão") — nunca cria nem infere esse vínculo aqui.
 *
 * Se nenhum dos dois caminhos resolver um `channelId`, ou se o
 * `candidato_id` informado não existir na tabela `candidato`, `prepare()`
 * retorna `false` e `run()` aborta sem gravar nada (nenhum evento órfão).
 * Ver README.md desta pasta para a discussão completa — hoje nenhum
 * candidato tem `perfil_social` cadastrado, então na prática o caminho (1)
 * é o único que funciona até alguém popular a tabela.
 */
export class YoutubeVideosCollector extends Collector<YoutubeVideoBruto> {
  readonly fonte = FONTE;

  /** Resolvido no construtor (channelId explícito) ou em prepare() (via
   * perfil_social.verificado=true). Nunca por fuzzy match de nome. */
  private effectiveChannelId: string | null;

  constructor(
    private readonly candidatoId: string,
    /** channelId explícito (ex: `--channelId` da CLI), ou `null` para
     * tentar resolver via `perfil_social` em `prepare()`. */
    channelIdExplicito: string | null,
    private readonly client: YoutubeApiClient,
    deps: CollectorDeps = {}
  ) {
    super(deps);
    this.effectiveChannelId = channelIdExplicito;
  }

  protected async prepare(): Promise<boolean> {
    if (!this.deps.supabase) return false;

    const { data: candidato, error: candidatoError } = await this.deps.supabase
      .from("candidato")
      .select("id, nome_urna")
      .eq("id", this.candidatoId)
      .maybeSingle();
    if (candidatoError) throw candidatoError;

    if (!candidato) {
      logger.warn(
        FONTE,
        `candidato_id=${this.candidatoId} não encontrado na tabela candidato — pulando coleta, ` +
          "nenhum evento órfão será inserido."
      );
      return false;
    }

    if (this.effectiveChannelId) {
      logger.info(
        FONTE,
        "channelId fornecido explicitamente — nenhuma inferência por nome foi feita",
        { candidatoId: this.candidatoId, channelId: this.effectiveChannelId }
      );
      return true;
    }

    const { data: perfil, error: perfilError } = await this.deps.supabase
      .from("perfil_social")
      .select("handle, verificado")
      .eq("candidato_id", this.candidatoId)
      .eq("plataforma", "youtube")
      .eq("verificado", true)
      .maybeSingle();
    if (perfilError) throw perfilError;

    if (!perfil) {
      logger.warn(
        FONTE,
        `nenhum channelId foi passado explicitamente e não há registro verificado em ` +
          `perfil_social (plataforma='youtube', verificado=true) para candidato_id=` +
          `${this.candidatoId} — pulando coleta, nenhum evento órfão será inserido. Este ` +
          "coletor nunca infere o canal a partir do nome do candidato (ver README desta " +
          "pasta, seção 'Entity resolution')."
      );
      return false;
    }

    this.effectiveChannelId = perfil.handle as string;
    logger.info(
      FONTE,
      "channelId resolvido via perfil_social (verificado=true) — match determinístico, " +
        "não fuzzy",
      { candidatoId: this.candidatoId, channelId: this.effectiveChannelId }
    );
    return true;
  }

  async fetchAll(): Promise<YoutubeVideoBruto[]> {
    if (!this.effectiveChannelId) {
      logger.warn(FONTE, "fetchAll() chamado sem channelId resolvido — retornando lista vazia");
      return [];
    }
    return this.client.listarVideosDoCanal(this.effectiveChannelId);
  }

  normalize(raw: YoutubeVideoBruto): NormalizedEventoInput | null {
    if (!raw.publicadoEm) {
      logger.warn(
        FONTE,
        "vídeo sem data de publicação — pulando (data_evento é obrigatória)",
        { videoId: raw.videoId }
      );
      return null;
    }

    const dataEvento = raw.publicadoEm.slice(0, 10);
    const resumo = montarResumo(raw);

    // hash estável: tipo + candidato + identificador da fonte (videoId).
    // Independe de campos que mudam sem o fato deixar de ser "o mesmo vídeo"
    // (views/likes/comentários sobem com o tempo — o evento é ATUALIZADO,
    // não duplicado, quando o coletor roda de novo).
    const hashConteudo = sha256Hex(`post|${this.candidatoId}|youtube|${raw.videoId}`);

    return {
      candidato_id: this.candidatoId,
      tipo: "post",
      categoria: "neutro", // postar conteúdo não é em si realização nem controvérsia — isso é avaliação, não fato
      estagio_juridico: null, // só permitido para tipo='processo' — CHECK constraint no banco
      tema: [], // classificação temática por LLM fica para a Fase 2 (seção 6)
      titulo: raw.titulo,
      resumo,
      data_evento: dataEvento,
      fonte_nome: "YouTube",
      fonte_url: `https://www.youtube.com/watch?v=${raw.videoId}`,
      fonte_confianca: 1, // a métrica de views/likes vem direto da API oficial da plataforma
      hash_conteudo: hashConteudo,
    };
  }
}

/**
 * Resumo PRÓPRIO: descrição do vídeo (escrita pelo canal, não por terceiro —
 * sem questão de direito autoral de imprensa) truncada, seguida de contagens
 * públicas agregadas de engajamento. NUNCA inclui texto de comentários nem
 * qualquer classificação de sentimento — seção 2.2 do documento proíbe medir
 * sentimento de comentário de terceiros como proxy de qualidade, por ser o
 * vetor mais fácil de manipular por bot.
 */
function montarResumo(raw: YoutubeVideoBruto): string | null {
  const descricao = raw.descricao ? truncate(raw.descricao, RESUMO_MAX_LEN) : null;

  const contagens: string[] = [];
  if (raw.viewCount !== null) contagens.push(`${raw.viewCount} visualizações`);
  if (raw.likeCount !== null) contagens.push(`${raw.likeCount} curtidas`);
  if (raw.commentCount !== null) contagens.push(`${raw.commentCount} comentários`);

  const bloco = [descricao, contagens.length > 0 ? `[${contagens.join(", ")}]` : null]
    .filter((parte): parte is string => Boolean(parte))
    .join(" ");

  return bloco.length > 0 ? bloco : null;
}
