import { Collector, type CollectorDeps } from "../../collector.js";
import { sha256Hex } from "../../lib/hash.js";
import { logger } from "../../lib/logger.js";
import { truncate } from "../../lib/text.js";
import type { NormalizedEventoInput } from "../../types.js";
import type { MetaAdsApiClient } from "./client.js";
import type { MetaAdArchiveItem, MetaAdsRange } from "./types.js";

const FONTE = "meta_ads";
const TITULO_CRIATIVO_MAX_LEN = 120;

/**
 * Coletor da dimensão "Investimento em propaganda" (seção 6 do documento de
 * arquitetura) via Meta Ad Library API. Ver README.md desta pasta para a
 * discussão completa: endpoint exato, o que a API exige (access_token de app
 * verificado para anúncios políticos, que este ambiente não tem), os ranges
 * de gasto/alcance (nunca valores exatos) e a decisão de entity resolution.
 *
 * Entity resolution: **determinística por `page_id`** (ID da página do
 * Facebook do candidato), fornecido pelo operador via `--pageId` na CLI —
 * nunca inferido por nome (seção 5 do documento: "nunca deixar match fuzzy
 * alimentar métrica direto"). Diferente do coletor da Câmara, aqui não há um
 * `page_id` já cadastrado em `candidato` para resolver automaticamente (o
 * schema atual não tem essa coluna — ver README, seção "Entity resolution"),
 * então tanto `candidatoId` quanto `pageId` vêm diretamente da linha de
 * comando. `prepare()` ainda confirma que o `candidatoId` informado existe
 * de fato na tabela `candidato` antes de buscar qualquer anúncio — mesma
 * postura defensiva do resto do framework: nunca gravar evento órfão.
 */
export class MetaAdsCollector extends Collector<MetaAdArchiveItem> {
  readonly fonte = FONTE;

  private candidatoId: string | null = null;
  private candidatoNome: string | null = null;

  constructor(
    /** UUID de `candidato.id`, fornecido pelo operador via --candidatoId —
     * nunca resolvido automaticamente (ver comentário de classe acima). */
    private readonly candidatoIdInformado: string,
    private readonly pageId: string,
    private readonly client: MetaAdsApiClient,
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
        `candidatoId=${this.candidatoIdInformado} não encontrado na tabela candidato — ` +
          "pulando coleta, nenhum evento órfão será inserido. Cadastre o candidato antes " +
          "de rodar este coletor para ele."
      );
      return false;
    }

    this.candidatoId = data.id as string;
    this.candidatoNome = data.nome_urna as string;
    logger.info(
      FONTE,
      "candidato confirmado por id (o pageId da busca vem direto do operador via --pageId, " +
        "nunca inferido por nome — ver README)",
      { candidatoId: this.candidatoId, nomeUrna: this.candidatoNome, pageId: this.pageId }
    );
    return true;
  }

  async fetchAll(): Promise<MetaAdArchiveItem[]> {
    return this.client.buscarAnunciosPorPageId(this.pageId);
  }

  normalize(raw: MetaAdArchiveItem): NormalizedEventoInput | null {
    if (!this.candidatoId) {
      // não deveria acontecer em run() normal (prepare() já teria abortado),
      // mas protege chamadas diretas de normalize() (ex: dry-run sem setup).
      logger.warn(FONTE, "normalize() chamado sem candidato_id resolvido — pulando", {
        adId: raw.id,
      });
      return null;
    }

    if (!raw.ad_snapshot_url) {
      logger.warn(
        FONTE,
        "anúncio sem ad_snapshot_url — pulando (fonte_url é obrigatória, nunca gravamos " +
          "evento sem link para a origem)",
        { adId: raw.id }
      );
      return null;
    }

    const dataEvento = parseData(raw.ad_delivery_start_time);
    if (!dataEvento) {
      logger.warn(
        FONTE,
        "anúncio sem ad_delivery_start_time reconhecível — pulando (data_evento é obrigatória)",
        { adId: raw.id, ad_delivery_start_time: raw.ad_delivery_start_time }
      );
      return null;
    }

    const titulo = montarTitulo(raw, dataEvento);
    const resumo = truncate(montarResumo(raw), 500);

    // hash estável: tipo + candidato + identificador da fonte (id do anúncio
    // na Ad Library). Independe de spend/impressions (que mudam enquanto o
    // anúncio segue ativo) — reprocessar o mesmo anúncio sempre bate no
    // mesmo evento (upsert atualiza o range mais recente em vez de duplicar).
    const hashConteudo = sha256Hex(`anuncio|${this.candidatoId}|meta|${raw.id}`);

    return {
      candidato_id: this.candidatoId,
      tipo: "anuncio",
      categoria: "neutro", // investir em propaganda não é por si só realização nem controvérsia
      estagio_juridico: null, // só permitido para tipo='processo' — CHECK constraint no banco
      tema: [], // classificação temática por LLM fica para a Fase 2 (seção 6 do documento)
      titulo,
      resumo,
      data_evento: dataEvento,
      fonte_nome: "Meta Ad Library",
      fonte_url: raw.ad_snapshot_url,
      fonte_confianca: 1, // 1 = oficial
      hash_conteudo: hashConteudo,
    };
  }

  /**
   * Usado apenas pelo modo --dry-run da CLI, para inspecionar normalize()
   * sem consultar o banco (não requer service_role key). Nunca chamado pelo
   * pipeline real: run() sempre passa por prepare() antes.
   */
  definirCandidatoParaInspecao(candidatoId: string, nomeUrna = "(dry-run)"): void {
    this.candidatoId = candidatoId;
    this.candidatoNome = nomeUrna;
  }
}

/**
 * `ad_delivery_start_time` normalmente vem como "YYYY-MM-DD", mas a
 * documentação não garante ausência de timestamp — tratamos os primeiros 10
 * caracteres de forma defensiva, igual aos demais coletores (ver
 * collectors/camara/collector.ts, collectors/transparencia/collector.ts).
 */
function parseData(valor: string | undefined): string | null {
  if (!valor) return null;
  const match = valor.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? match[0] : null;
}

/**
 * Título: prioriza o texto do próprio criativo (o que o eleitor viu), com
 * fallback para nome da página anunciante + período — exatamente como
 * pedido na modelagem (evento.titulo = "texto/criativo resumido do anúncio
 * ou nome da página anunciante + período").
 */
function montarTitulo(raw: MetaAdArchiveItem, dataEvento: string): string {
  const textoCreativo =
    raw.ad_creative_link_titles?.find((t) => t?.trim()) ??
    raw.ad_creative_bodies?.find((t) => t?.trim());

  if (textoCreativo) {
    return truncate(textoCreativo, TITULO_CRIATIVO_MAX_LEN);
  }

  const pagina = raw.page_name ?? `página ${raw.page_id}`;
  return `Anúncio de ${pagina} — veiculação a partir de ${dataEvento}`;
}

/**
 * Resumo PRÓPRIO (nunca cópia de texto de terceiros — seção 4 do documento),
 * composto a partir dos campos estruturados da resposta oficial. Ponto
 * central: gasto e alcance são sempre expressos como FAIXA ("Gasto
 * declarado: R$ 100–499"), nunca como um número único falsamente preciso —
 * é assim que a própria Meta Ad Library entrega o dado para anúncios
 * políticos (ver README, seção "Ranges, não valores exatos"). Quando a API
 * não retorna spend/impressions para um anúncio específico (acontece —
 * cobertura de dado incompleto é uma realidade documentada, não um bug deste
 * coletor), o resumo declara isso explicitamente em vez de omitir em
 * silêncio.
 */
function montarResumo(raw: MetaAdArchiveItem): string {
  const partes: string[] = [];

  if (raw.spend) {
    partes.push(`Gasto declarado (faixa): ${formatarFaixa(raw.spend, raw.currency ?? "moeda não informada")}`);
  } else {
    partes.push("Gasto declarado: não informado pela API para este anúncio");
  }

  if (raw.impressions) {
    partes.push(`Alcance estimado (faixa de impressões): ${formatarFaixa(raw.impressions)}`);
  } else {
    partes.push("Alcance estimado: não informado pela API para este anúncio");
  }

  if (raw.publisher_platforms && raw.publisher_platforms.length > 0) {
    partes.push(`Veiculado em: ${raw.publisher_platforms.join(", ")}`);
  }

  if (raw.bylines) {
    partes.push(`Financiado por (byline declarado): ${raw.bylines}`);
  }

  if (raw.ad_delivery_stop_time) {
    partes.push(`Encerrado em ${parseData(raw.ad_delivery_stop_time) ?? raw.ad_delivery_stop_time}`);
  } else {
    partes.push("Veiculação em andamento (sem data de encerramento) no momento da coleta");
  }

  return `${partes.join(". ")}. Faixas estimadas pela própria Meta — não são valores exatos.`;
}

function formatarFaixa(range: MetaAdsRange, unidade?: string): string {
  const sufixo = unidade ? ` ${unidade}` : "";
  if (!range.upper_bound) return `acima de ${range.lower_bound}${sufixo}`;
  return `${range.lower_bound}–${range.upper_bound}${sufixo}`;
}
