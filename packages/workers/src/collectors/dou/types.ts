/**
 * Tipos do payload retornado pela busca pública do Diário Oficial da União
 * (in.gov.br). Não existe API REST/JSON documentada para isso — o endpoint
 * usado aqui devolve uma página HTML completa (o mesmo portal Liferay que um
 * humano usaria) com os resultados embutidos como JSON dentro de uma tag
 * `<script>`. Ver README.md desta pasta para como isso foi descoberto e
 * confirmado com requisições reais antes de escrever qualquer parser.
 */

/** Um resultado (artigo/ato publicado) da busca do DOU. */
export interface DouArtigoBruto {
  /** Jornal: "DO1" (Seção 1), "DO2" (Seção 2 — atos de pessoal), "DO3" (Seção 3), ou variações "e" de edição extra. */
  pubName: string;
  /** Slug usado para montar a URL pública do ato: `https://www.in.gov.br/web/dou/-/{urlTitle}`. */
  urlTitle: string;
  numberPage: string;
  title: string;
  /** Data de publicação, formato "DD/MM/AAAA". */
  pubDate: string;
  editionNumber: string;
  /**
   * Trecho do texto do ato ao redor do termo buscado, em HTML, com o termo
   * encontrado envolvido em `<span class='highlight'>`. É um RECORTE gerado
   * pelo motor de busca (não o ato completo) — pode conter reticências "..."
   * entre pedaços não contíguos do texto original.
   */
  content: string;
  hierarchyLevelSize: number;
  /** Epoch ms (como string) — usado como cursor de paginação, junto com `classPK` e `score`. */
  displayDateSortable: string;
  score: number;
  /** Tipo do ato em texto livre: "Portaria", "Decreto", "Ata", "Edital", "Extrato de Contrato", etc. */
  artType: string;
  /** ID interno do artigo no Liferay. Usado para montar `hash_conteudo` e como cursor de paginação. */
  classPK: string;
  pubOrder: string;
  /** Data+hora de publicação, formato "AAAAMMDDHHmmss". */
  displayDate: string;
  /** Hierarquia organizacional do órgão emissor, ex: "Ministério da Educação/Secretaria Executiva". */
  hierarchyStr: string;
  hierarchyList: string[];
}

/** Parâmetros de busca aceitos pelo `DouApiClient` (ver client.ts para como viram query string real). */
export interface DouBuscaParams {
  /** Termo de busca — normalmente `candidato.nome_civil`. O client adiciona as aspas (busca por frase). */
  termo: string;
  /** Seções do DOU a pesquisar. Default: `["todos"]` (DO1 + DO2 + DO3). */
  secoes?: string[];
  /** Data inicial (YYYY-MM-DD). Se omitida junto com `dataFim`, busca sem filtro de data. */
  dataInicio?: string;
  /** Data final (YYYY-MM-DD). */
  dataFim?: string;
}

/** Registro bruto processado por este coletor: o artigo do DOU + o candidato ao qual a busca por nome o associou. */
export interface DouRawEvento {
  candidatoId: string;
  artigo: DouArtigoBruto;
}
