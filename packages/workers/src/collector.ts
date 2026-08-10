import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "./lib/logger.js";
import { canonicalJsonStringify, sha256Hex } from "./lib/hash.js";
import type { CollectorStats, NormalizedEventoInput } from "./types.js";

export interface CollectorDeps {
  /**
   * Client Supabase com service_role key. Opcional no construtor para permitir
   * fetch()/normalize() isolados (ex: modo --dry-run de CLI) sem exigir a chave —
   * só run() (que grava no banco) exige que ele esteja presente.
   */
  supabase?: SupabaseClient;
}

/**
 * Classe base que qualquer adaptador de fonte (Câmara, Senado, TSE, Portal da
 * Transparência, DataJud, TCU, YouTube, Bluesky, Meta Ads, DOU, ...) deve
 * estender. Implementa o pipeline padrão descrito na seção 3 do documento de
 * arquitetura:
 *
 *   fetchAll() → raw_payload (hash + append-only) → normalize() → evento (upsert com dedup)
 *
 * O que a classe base resolve (comum a todo coletor):
 *   - grava o payload bruto em `raw_payload` ANTES de normalizar, com hash de dedup
 *   - dedup automático via `hash_conteudo UNIQUE` tanto em raw_payload quanto em evento
 *   - contadores de observabilidade (buscados/inseridos/duplicados/pulados/erros)
 *   - erro por registro não derruba o restante da execução
 *
 * O que cada adaptador concreto precisa implementar:
 *   - fetchAll(): busca os dados brutos na fonte (retry/rate limit ficam a cargo
 *     do adaptador, usando lib/httpClient.ts)
 *   - normalize(raw): mapeia um registro bruto para o formato de `evento`,
 *     retornando `null` para pular o registro (ex: entidade não resolvida,
 *     dado obrigatório ausente)
 *   - prepare() (opcional): setup antes do fetch/normalize, tipicamente
 *     ENTITY RESOLUTION. Retornar `false` aborta o run() sem gravar nada —
 *     é assim que o coletor da Câmara evita inserir eventos órfãos quando
 *     o id_camara não existe em `candidato` (ver CamaraProposicoesCollector).
 */
export abstract class Collector<TRaw> {
  /** Identificador curto da fonte, usado em raw_payload.fonte e nos logs. */
  abstract readonly fonte: string;

  protected deps: CollectorDeps;

  constructor(deps: CollectorDeps = {}) {
    this.deps = deps;
  }

  protected async prepare(): Promise<boolean> {
    return true;
  }

  abstract fetchAll(): Promise<TRaw[]>;

  abstract normalize(
    raw: TRaw
  ): NormalizedEventoInput | null | Promise<NormalizedEventoInput | null>;

  private requireSupabase(): SupabaseClient {
    if (!this.deps.supabase) {
      throw new Error(
        `Coletor "${this.fonte}" precisa de um client Supabase com service_role key para gravar. ` +
          "Configure SUPABASE_SERVICE_ROLE_KEY em packages/workers/.env (veja .env.example) " +
          "ou rode em modo --dry-run para só inspecionar fetch/normalize sem gravar."
      );
    }
    return this.deps.supabase;
  }

  async run(): Promise<CollectorStats> {
    const stats: CollectorStats = {
      fonte: this.fonte,
      buscados: 0,
      raw_inseridos: 0,
      raw_duplicados: 0,
      eventos_inseridos: 0,
      eventos_atualizados: 0,
      eventos_pulados: 0,
      erros: 0,
    };

    const supabase = this.requireSupabase();

    const podeContinuar = await this.prepare();
    if (!podeContinuar) {
      logger.warn(this.fonte, "execução abortada em prepare() — nenhum dado será gravado");
      return stats;
    }

    logger.info(this.fonte, "buscando dados na fonte...");
    const rawItems = await this.fetchAll();
    stats.buscados = rawItems.length;
    logger.info(this.fonte, `${rawItems.length} registro(s) obtido(s) da fonte`);

    for (const raw of rawItems) {
      try {
        const rawResult = await this.saveRawPayload(supabase, raw);
        if (rawResult.status === "inserido") stats.raw_inseridos++;
        else stats.raw_duplicados++;

        const normalized = await this.normalize(raw);
        if (!normalized) {
          stats.eventos_pulados++;
          continue;
        }

        const eventoResult = await this.upsertEvento(supabase, {
          ...normalized,
          payload_raw_id: rawResult.id,
        });
        if (eventoResult.status === "inserido") stats.eventos_inseridos++;
        else if (eventoResult.status === "atualizado") stats.eventos_atualizados++;
        else stats.eventos_pulados++;
      } catch (err) {
        stats.erros++;
        logger.error(this.fonte, "erro ao processar registro — seguindo para o próximo", {
          erro: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logger.info(this.fonte, "execução concluída", { ...stats });
    return stats;
  }

  /**
   * Grava o payload bruto em `raw_payload` (append-only) antes de qualquer
   * normalização. Hash calculado sobre fonte + conteúdo canônico: se o mesmo
   * registro for buscado de novo sem mudar, dedup automático; se o conteúdo
   * mudar (ex: ementa retificada), gera uma nova linha para auditoria/replay.
   */
  private async saveRawPayload(
    supabase: SupabaseClient,
    raw: TRaw
  ): Promise<{ id: string; status: "inserido" | "duplicado" }> {
    const hash = sha256Hex(`${this.fonte}|${canonicalJsonStringify(raw)}`);

    const { data: existing, error: selectError } = await supabase
      .from("raw_payload")
      .select("id")
      .eq("hash_conteudo", hash)
      .maybeSingle();
    if (selectError) throw selectError;
    if (existing) return { id: existing.id as string, status: "duplicado" };

    const { data, error } = await supabase
      .from("raw_payload")
      .insert({
        fonte: this.fonte,
        payload: raw as unknown as Record<string, unknown>,
        hash_conteudo: hash,
      })
      .select("id")
      .single();

    if (error) {
      // condição de corrida: outro processo inseriu o mesmo hash entre o select e o insert
      if (error.code === "23505") {
        const { data: retry, error: retryError } = await supabase
          .from("raw_payload")
          .select("id")
          .eq("hash_conteudo", hash)
          .single();
        if (retryError) throw retryError;
        return { id: retry.id as string, status: "duplicado" };
      }
      throw error;
    }

    return { id: data.id as string, status: "inserido" };
  }

  /**
   * Upsert em `evento` com dedup por `hash_conteudo UNIQUE`: se já existe um
   * evento com o mesmo hash, atualiza os campos (o conteúdo pode ter mudado
   * na fonte); senão insere. Nunca insere sem `fonte_url` — isso é reforçado
   * pelo NOT NULL da coluna e pelo tipo NormalizedEventoInput.
   */
  private async upsertEvento(
    supabase: SupabaseClient,
    evento: NormalizedEventoInput & { payload_raw_id: string }
  ): Promise<{ id?: string; status: "inserido" | "atualizado" | "duplicado" }> {
    const { data: existing, error: selectError } = await supabase
      .from("evento")
      .select("id")
      .eq("hash_conteudo", evento.hash_conteudo)
      .maybeSingle();
    if (selectError) throw selectError;

    if (existing) {
      const { error } = await supabase
        .from("evento")
        .update(evento)
        .eq("id", existing.id);
      if (error) throw error;
      return { id: existing.id as string, status: "atualizado" };
    }

    const { data, error } = await supabase
      .from("evento")
      .insert(evento)
      .select("id")
      .single();

    if (error) {
      if (error.code === "23505") return { status: "duplicado" };
      throw error;
    }

    return { id: data.id as string, status: "inserido" };
  }
}
