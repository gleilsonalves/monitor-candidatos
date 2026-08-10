/**
 * Tipos da resposta do endpoint `ads_archive` da Meta Ad Library API
 * (`graph.facebook.com/<versão>/ads_archive`), restritos aos campos usados
 * por este coletor. Confirmados contra a documentação oficial em
 * <https://developers.facebook.com/docs/graph-api/reference/ads_archive/>
 * (consultada em 2026-08-10) — ver README.md desta pasta para a discussão
 * completa (endpoint exato, parâmetros, e validação sem access_token).
 */

/** Faixa (não valor exato) retornada pela API para gasto e alcance de
 * anúncios políticos/de interesse público — ver README, seção "Ranges, não
 * valores exatos". */
export interface MetaAdsRange {
  lower_bound: string;
  /** Ausente quando a faixa é aberta no topo (ex: acima do maior bucket). */
  upper_bound?: string;
}

export interface MetaAdsDemographicDistribution {
  age: string;
  gender: string;
  /** Percentual (string, ex: "0.12") do total de impressões atribuído a este
   * grupo demográfico — não é uma contagem absoluta. */
  percentage: string;
}

export interface MetaAdsRegionDistribution {
  region: string;
  percentage: string;
}

/** Um item de `data[]` na resposta de `GET /ads_archive`. Nomeado
 * "ArchivedAd" na documentação da Graph API. Todos os campos, exceto `id`,
 * `page_id` e `ad_snapshot_url`, são opcionais na resposta real — a API
 * omite o que não tiver disponível para aquele anúncio específico. */
export interface MetaAdArchiveItem {
  /** ID do anúncio na Ad Library (não é o ID do post/anúncio no Ads Manager). */
  id: string;
  page_id: string;
  page_name?: string;
  ad_creation_time?: string;
  /** Formato "YYYY-MM-DD" (pode vir com timestamp completo — tratado defensivamente). */
  ad_delivery_start_time?: string;
  /** Ausente enquanto o anúncio ainda está ativo. */
  ad_delivery_stop_time?: string;
  /** URL permanente do anúncio na Ad Library (usada como `fonte_url`). */
  ad_snapshot_url: string;
  ad_creative_bodies?: string[];
  ad_creative_link_captions?: string[];
  ad_creative_link_titles?: string[];
  bylines?: string;
  currency?: string;
  /** Só populado para ad_type=POLITICAL_AND_ISSUE_ADS (e anúncios EU/UK) —
   * ausente/null para anúncios comerciais comuns. Ver README. */
  spend?: MetaAdsRange;
  impressions?: MetaAdsRange;
  demographic_distribution?: MetaAdsDemographicDistribution[];
  region_distribution?: MetaAdsRegionDistribution[];
  publisher_platforms?: string[];
}

export interface MetaAdsPaging {
  cursors?: { before?: string; after?: string };
  /** URL completa da próxima página; ausente na última página. */
  next?: string;
}

export interface MetaAdsArchiveResponse {
  data: MetaAdArchiveItem[];
  paging?: MetaAdsPaging;
}

/** Corpo de erro padrão da Graph API (`{"error": {...}}`), usado pelo
 * client para reconhecer respostas de erro sem token/token inválido — ver
 * README, seção "Validação sem access_token". */
export interface MetaGraphApiError {
  error: {
    message: string;
    type: string;
    code: number;
    fbtrace_id?: string;
  };
}
