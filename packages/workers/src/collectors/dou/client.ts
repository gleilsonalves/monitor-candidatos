import { HttpError, RateLimiter, sleep } from "../../lib/httpClient.js";
import { logger } from "../../lib/logger.js";
import type { DouArtigoBruto, DouBuscaParams } from "./types.js";

const FONTE = "dou_atos_pessoal";

/**
 * Trava de segurança contra paginação (quase) infinita: no máximo
 * MAX_PAGINAS * 20 resultados por busca. Uma pessoa pública com muitos anos
 * de vida pública pode ter centenas de menções no DOU (a busca é full-text
 * livre, não só atos de nomeação — ver README); 20 páginas (400 resultados)
 * já é mais que suficiente para não perder atos relevantes recentes sem
 * deixar o coletor rodando indefinidamente para nomes muito comuns.
 */
const MAX_PAGINAS = 20;

/** Extrai o JSON embutido em `<script id="..._params" type="application/json">{"jsonArray": [...]}</script>`. */
const PARAMS_SCRIPT_REGEX =
  /_br_com_seatecnologia_in_buscadou_BuscaDouPortlet_params"\s+type="application\/json">\s*(\{[\s\S]*?\})\s*<\/script>/;

/** Extrai `totalPages` do objeto `request` embutido no segundo `<script>` da página (não é JSON válido isolado, só um valor). */
const TOTAL_PAGES_REGEX = /totalPages\s*:\s*(\d+)/;

export interface DouApiClientOptions {
  /** Delay em ms entre páginas consecutivas. Default: 600ms (busca textual livre, mais custosa que uma API REST comum). */
  rateLimitMs?: number;
  /** Tentativas extras por requisição além da primeira. Default: 2. */
  retries?: number;
  /** Delay base do backoff exponencial em ms. Default: 800. */
  backoffMs?: number;
}

/**
 * Cliente HTTP para a busca pública do DOU (`in.gov.br/consulta/-/buscar/dou`).
 * Não existe um endpoint JSON limpo (content-type sempre `text/html`) — este
 * client faz o parse da página HTML retornada, extraindo o bloco JSON que o
 * próprio front-end do portal usa para renderizar a lista de resultados. Ver
 * README.md desta pasta para a descoberta do endpoint e exemplos reais.
 */
export class DouApiClient {
  private readonly rateLimiter: RateLimiter;
  private readonly retries: number;
  private readonly backoffMs: number;

  constructor(
    private readonly baseUrl: string = "https://www.in.gov.br/consulta/-/buscar/dou",
    options: DouApiClientOptions = {}
  ) {
    this.rateLimiter = new RateLimiter(options.rateLimitMs ?? 600);
    this.retries = options.retries ?? 2;
    this.backoffMs = options.backoffMs ?? 800;
  }

  /**
   * Busca todos os artigos do DOU que mencionam `params.termo`, paginando via
   * o cursor (`score` + `classPK` + `displayDateSortable` do último item da
   * página anterior) que o próprio portal usa — não é paginação por offset.
   * O termo é sempre enviado entre aspas (busca "por frase"), o que reduz
   * bastante o ruído de nomes compostos comuns, mas **não garante adjacência
   * estrita** das palavras no texto original (ver README, seção de
   * limitações — caso real documentado).
   */
  async buscar(params: DouBuscaParams): Promise<DouArtigoBruto[]> {
    const termoFrase = `"${params.termo.trim()}"`;
    const secoes = params.secoes && params.secoes.length > 0 ? params.secoes : ["todos"];

    const resultados: DouArtigoBruto[] = [];
    let cursor: { newPage: number; score: number; id: string; displayDate: string } | undefined;
    let pagina = 1;

    while (pagina <= MAX_PAGINAS) {
      const url = this.montarUrl(termoFrase, secoes, params, cursor, pagina);
      logger.info(FONTE, `buscando página ${pagina} no DOU`, { termo: params.termo });

      const html = await this.fetchHtmlComRetry(url);
      const pagina_ = this.extrairResultados(html);
      if (!pagina_ || pagina_.itens.length === 0) break;

      resultados.push(...pagina_.itens);

      if (pagina >= pagina_.totalPages) break;

      const ultimo = pagina_.itens[pagina_.itens.length - 1];
      cursor = {
        newPage: pagina + 1,
        score: ultimo.score,
        id: ultimo.classPK,
        displayDate: ultimo.displayDateSortable,
      };
      pagina++;
      await this.rateLimiter.wait();
    }

    return resultados;
  }

  private montarUrl(
    termoFrase: string,
    secoes: string[],
    params: DouBuscaParams,
    cursor: { newPage: number; score: number; id: string; displayDate: string } | undefined,
    paginaAtual: number
  ): string {
    const url = new URL(this.baseUrl);
    url.searchParams.set("q", termoFrase);
    for (const secao of secoes) url.searchParams.append("s", secao);
    url.searchParams.set("sortType", "0");

    if (params.dataInicio && params.dataFim) {
      url.searchParams.set("exactDate", "personalizado");
      url.searchParams.set("publishFrom", isoParaDataDou(params.dataInicio));
      url.searchParams.set("publishTo", isoParaDataDou(params.dataFim));
    } else {
      url.searchParams.set("exactDate", "all");
    }

    if (cursor) {
      url.searchParams.set("currentPage", String(paginaAtual - 1));
      url.searchParams.set("newPage", String(cursor.newPage));
      url.searchParams.set("score", String(cursor.score));
      url.searchParams.set("id", cursor.id);
      url.searchParams.set("displayDate", cursor.displayDate);
    }

    return url.toString();
  }

  /** Faz o parse do HTML de resposta: extrai `jsonArray` (os resultados) e `totalPages`. Retorna `null` se o formato mudou (página sem o script esperado). */
  private extrairResultados(html: string): { itens: DouArtigoBruto[]; totalPages: number } | null {
    const jsonMatch = html.match(PARAMS_SCRIPT_REGEX);
    if (!jsonMatch) {
      logger.error(
        FONTE,
        "não foi possível encontrar o bloco JSON de resultados na página do DOU — o portal pode ter " +
          "mudado de formato (ver README.md desta pasta)"
      );
      return null;
    }

    let parsed: { jsonArray?: DouArtigoBruto[] };
    try {
      parsed = JSON.parse(jsonMatch[1]);
    } catch (err) {
      logger.error(FONTE, "falha ao parsear o JSON de resultados embutido no HTML do DOU", {
        erro: err instanceof Error ? err.message : String(err),
      });
      return null;
    }

    const totalPagesMatch = html.match(TOTAL_PAGES_REGEX);
    const totalPages = totalPagesMatch ? Number(totalPagesMatch[1]) : 1;

    return { itens: parsed.jsonArray ?? [], totalPages };
  }

  /** fetch() com retry/backoff (mesma política de `lib/httpClient.ts#fetchJson`), mas devolvendo texto — a resposta do DOU é HTML, não JSON. */
  private async fetchHtmlComRetry(url: string): Promise<string> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const res = await fetch(url, {
          headers: {
            Accept: "text/html",
            "User-Agent": "monitor-candidatos-workers/0.1",
          },
        });
        if (!res.ok) {
          throw new HttpError(res.status, `HTTP ${res.status} ${res.statusText} em ${url}`);
        }
        return await res.text();
      } catch (err) {
        lastError = err;
        const isLastAttempt = attempt === this.retries;
        if (isLastAttempt) break;
        const delay = this.backoffMs * 2 ** attempt;
        logger.warn(FONTE, `tentativa ${attempt + 1}/${this.retries + 1} falhou, retry em ${delay}ms`, {
          url,
          erro: err instanceof Error ? err.message : String(err),
        });
        await sleep(delay);
      }
    }

    throw lastError;
  }
}

/** Converte "YYYY-MM-DD" (formato usado no resto do projeto) para "DD-MM-AAAA" (formato exigido pelo parâmetro `publishFrom`/`publishTo` do DOU). */
function isoParaDataDou(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) {
    throw new Error(`Data inválida "${iso}" — esperado YYYY-MM-DD`);
  }
  const [, yyyy, mm, dd] = m;
  return `${dd}-${mm}-${yyyy}`;
}
