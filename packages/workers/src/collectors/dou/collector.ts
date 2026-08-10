import { Collector, type CollectorDeps } from "../../collector.js";
import { sha256Hex } from "../../lib/hash.js";
import { logger } from "../../lib/logger.js";
import { truncate } from "../../lib/text.js";
import type { NormalizedEventoInput } from "../../types.js";
import type { DouApiClient } from "./client.js";
import type { DouArtigoBruto, DouRawEvento } from "./types.js";

const FONTE = "dou_atos_pessoal";
const RESUMO_MAX_LEN = 500;

interface CandidatoRow {
  id: string;
  nome_civil: string | null;
  nome_urna: string | null;
}

/**
 * Coletor de atos de nomeação/exoneração do Diário Oficial da União, via
 * busca pública por nome em `in.gov.br`. Ver README.md desta pasta para o
 * endpoint descoberto, a decisão de `fonte_confianca` e — mais importante —
 * a limitação de entity resolution por nome (bem mais fraca que a Câmara ou
 * o TSE, que resolvem por ID).
 *
 * **Entity resolution — DIFERENTE de Câmara/TSE (seção 5 do documento de
 * arquitetura):** o DOU não expõe nenhum identificador único de pessoa nos
 * atos publicados (nem CPF, nem um "ID de servidor" pesquisável). A única
 * forma de busca é texto livre por nome. Isso está fora da cascata de match
 * determinístico/forte/fuzzy descrita na seção 5 — não é nem passo 1 nem
 * passo 2 dela, é estruturalmente mais fraco que ambos: não há UF, partido
 * ou código de cargo para desambiguar (like TSE), e não há nenhum ID externo
 * já cadastrado em `candidato` que a fonte aceite como chave de busca (like
 * Câmara). O termo de busca é `candidato.nome_civil` lido do banco em
 * `prepare()` (nome completo — nomes comuns em português tornam essa busca
 * ambígua por natureza, ver README).
 *
 * Para reduzir (não eliminar) falsos positivos, `normalize()` só aceita
 * artigos cujo título/trecho usa linguagem de nomeação ou exoneração
 * (`classificarAto()`) — a busca do DOU é full-text livre sobre TODO o
 * conteúdo publicado (editais, extratos de contrato, atas, etc.), não só
 * atos de pessoal.
 */
export class DouAtosPessoalCollector extends Collector<DouRawEvento> {
  readonly fonte = FONTE;

  private candidatoId: string | null = null;
  private nomeBusca: string | null = null;

  constructor(
    private readonly candidatoIdAlvo: string,
    private readonly client: DouApiClient,
    private readonly dataInicio: string | undefined,
    private readonly dataFim: string | undefined,
    deps: CollectorDeps = {}
  ) {
    super(deps);
  }

  protected async prepare(): Promise<boolean> {
    if (!this.deps.supabase) return false;

    const { data, error } = await this.deps.supabase
      .from("candidato")
      .select("id, nome_civil, nome_urna")
      .eq("id", this.candidatoIdAlvo)
      .maybeSingle();
    if (error) throw error;

    if (!data) {
      logger.warn(
        FONTE,
        `candidato_id=${this.candidatoIdAlvo} não encontrado na tabela candidato — pulando coleta, ` +
          "nenhum evento órfão será inserido."
      );
      return false;
    }

    const row = data as CandidatoRow;
    const nome = row.nome_civil?.trim();
    if (!nome) {
      logger.warn(
        FONTE,
        `candidato_id=${this.candidatoIdAlvo} sem nome_civil cadastrado — não é possível buscar no DOU ` +
          "(esta fonte só permite busca textual por nome), pulando."
      );
      return false;
    }

    this.candidatoId = row.id;
    this.nomeBusca = nome;
    logger.warn(
      FONTE,
      "candidato resolvido para busca por NOME no DOU — entity resolution textual, SEM identificador " +
        "único (CPF/ID) validando o match; confiança estruturalmente menor que id_camara/id_tse. Revise " +
        "manualmente os eventos gerados antes de confiar neles para métricas (ver README desta pasta).",
      { candidatoId: this.candidatoId, nomeBusca: this.nomeBusca }
    );
    return true;
  }

  async fetchAll(): Promise<DouRawEvento[]> {
    if (!this.candidatoId || !this.nomeBusca) {
      throw new Error("fetchAll() chamado sem candidato/nome resolvido — prepare() deveria ter rodado antes");
    }
    const candidatoId = this.candidatoId;

    const artigos = await this.client.buscar({
      termo: this.nomeBusca,
      dataInicio: this.dataInicio,
      dataFim: this.dataFim,
    });

    return artigos.map((artigo): DouRawEvento => ({ candidatoId, artigo }));
  }

  normalize(raw: DouRawEvento): NormalizedEventoInput | null {
    const { candidatoId, artigo } = raw;

    const textoPlano = stripHtml(artigo.content);
    const classificacao = classificarAto(`${artigo.title} ${textoPlano}`);
    if (!classificacao) {
      logger.info(
        FONTE,
        "ato não usa linguagem de nomeação/exoneração no título/trecho retornado — pulando (a busca do " +
          "DOU é full-text livre, não filtra por tipo de ato)",
        { urlTitle: artigo.urlTitle, artType: artigo.artType }
      );
      return null;
    }

    const dataEvento = parseDataBr(artigo.pubDate);
    if (!dataEvento) {
      logger.warn(FONTE, "ato sem pubDate reconhecível — pulando (data_evento é obrigatória)", {
        urlTitle: artigo.urlTitle,
        pubDate: artigo.pubDate,
      });
      return null;
    }

    const orgao =
      (artigo.hierarchyList && artigo.hierarchyList[artigo.hierarchyList.length - 1]) ||
      artigo.hierarchyStr ||
      artigo.pubName;
    const rotuloAto = classificacao === "exoneracao" ? "Exoneração" : "Nomeação";
    const titulo = `${rotuloAto} — ${orgao}`;

    const resumo = truncate(
      `${artigo.artType || "Ato"} publicado em ${artigo.pubDate} (${artigo.pubName}, edição ` +
        `${artigo.editionNumber}, página ${artigo.numberPage}) por ${artigo.hierarchyStr}. Trecho ` +
        `localizado pela busca por "${this.nomeBusca}" — pode não conter o texto completo do ato: ` +
        textoPlano,
      RESUMO_MAX_LEN
    );

    // hash estável: tipo + candidato + identificador do artigo no DOU (classPK). Um mesmo artigo pode
    // gerar eventos para candidatos diferentes se mencionar mais de um nome buscado — por isso o
    // candidato_id entra no hash, não só o classPK.
    const hashConteudo = sha256Hex(`nomeacao|${candidatoId}|dou|${artigo.classPK}`);

    return {
      candidato_id: candidatoId,
      // enum de evento.tipo não tem 'exoneracao' — exoneração também usa 'nomeacao', diferenciado só
      // pelo texto de `titulo` (ver README desta pasta e CHECK constraint em db/migrations/0001_core_schema.sql)
      tipo: "nomeacao",
      categoria: "neutro", // nomeação/exoneração não é por si só boa ou ruim
      estagio_juridico: null, // só se aplica a tipo='processo' — CHECK constraint no banco
      tema: [],
      titulo,
      resumo,
      data_evento: dataEvento,
      fonte_nome: "Diário Oficial da União",
      fonte_url: `https://www.in.gov.br/web/dou/-/${artigo.urlTitle}`,
      fonte_confianca: 1, // fonte oficial (ver README para a discussão de por que 1 mesmo com match por nome)
      hash_conteudo: hashConteudo,
    };
  }

  /**
   * Usado apenas pelo modo --dry-run da CLI, para inspecionar fetch/normalize
   * sem consultar o banco (não requer service_role key nem que o nome exista
   * em `candidato`). Nunca chamado pelo pipeline real: run() sempre passa por
   * prepare() antes.
   */
  definirCandidatoParaInspecao(candidatoId: string, nomeCivil: string): void {
    this.candidatoId = candidatoId;
    this.nomeBusca = nomeCivil;
  }
}

/** Remove as tags HTML do trecho retornado pela busca (`<span class='highlight'>`) e decodifica as entidades mais comuns. Não é o mesmo cuidado de direito autoral de `lib/text.ts` — este texto é ato oficial, não matéria jornalística — mas ainda vale limpar antes de gravar como `resumo`. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

/** Remove acentos e caixa para comparação de padrões de texto (mesma técnica de `collectors/tse/match.ts#normalizarNome`, reimplementada aqui para manter este coletor autocontido). */
function normalizarTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase();
}

/**
 * Classificação leve por palavra-chave — sem LLM, mesma justificativa do
 * `truncate()` em `lib/text.ts` (dado oficial estruturado; classificação por
 * LLM fica para a Fase 2, seção 6 do documento de arquitetura). Reconhece se
 * o título+trecho do ato usa linguagem de nomeação ou exoneração. Retorna
 * `null` quando nenhum padrão bate — é essa checagem que evita gravar como
 * 'nomeacao' qualquer menção do nome do candidato num edital, extrato de
 * contrato, ata, etc. (a busca do DOU não filtra por tipo de ato).
 *
 * Quando o trecho menciona as duas coisas (comum em portarias consolidadas
 * tipo "exonera fulano e nomeia beltrano"), classifica como nomeação por
 * padrão — o trecho retornado pela busca é curto demais para saber com
 * segurança qual das duas ações se refere à pessoa buscada.
 */
function classificarAto(textoOriginal: string): "nomeacao" | "exoneracao" | null {
  const texto = normalizarTexto(textoOriginal);
  const temExoneracao = /EXONERA/.test(texto);
  // "NOME" seguido de vogal cobre as conjugações (nomear, nomeia, nomeou, nomeado(a), nomeação) E as
  // formas com pronome clítico hifenizado tão comuns em texto legal ("nomeá-lo", "nomeá-la") — o hífen
  // some na comparação porque checamos só o caractere logo após "NOME", que nesses casos é a vogal do
  // próprio verbo, não o hífen. O que essa checagem EVITA é o falso positivo mais óbvio: a palavra
  // "nome" (substantivo) sozinha, sempre seguida de espaço/pontuação, nunca de vogal colada.
  const temNomeacao = /NOME[AEIO]/.test(texto) || /DESIGNA/.test(texto);

  if (temNomeacao) return "nomeacao";
  if (temExoneracao) return "exoneracao";
  return null;
}

/** Converte "DD/MM/AAAA" (formato de `pubDate` na resposta do DOU) para "AAAA-MM-DD". */
function parseDataBr(pubDate: string | undefined | null): string | null {
  if (!pubDate) return null;
  const m = pubDate.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}
