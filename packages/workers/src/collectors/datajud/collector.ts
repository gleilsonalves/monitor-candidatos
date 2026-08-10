import { Collector, type CollectorDeps } from "../../collector.js";
import { sha256Hex } from "../../lib/hash.js";
import { logger } from "../../lib/logger.js";
import { mapearCodigoMovimento } from "./mapaMovimentacao.js";
import type { NormalizedEventoInput } from "../../types.js";
import type { DatajudApiClient } from "./client.js";
import { normalizarNumeroProcesso } from "./client.js";
import type { DatajudMovimento, DatajudProcessoBruto } from "./types.js";

const FONTE = "datajud_processos";

/**
 * Fallback de `fonte_url` quando não é passado `--fonteUrl` explícito. É a
 * consulta pública nacional do PJe mantida pelo CNJ
 * (https://www.cnj.jus.br/tecnologia-da-informacao-e-comunicacao/justica-4-0/jus-br/).
 * IMPORTANTE: não é um link direto para o processo específico — quem clicar
 * precisa digitar o número manualmente. Não existe, até onde esta pesquisa
 * confirmou, uma URL pública universal que aceite o numeroProcesso e resolva
 * direto para o processo em qualquer um dos ~91 tribunais (cada um usa seu
 * próprio sistema: e-SAJ, Projudi, PJe, etc, com padrões de URL
 * diferentes). Por isso o operador pode (e deveria, sempre que possível)
 * fornecer `--fonteUrl` com o link direto e verificado manualmente — ver
 * README.
 */
export const FONTE_URL_FALLBACK_CNJ = "https://www.cnj.jus.br/pjecnj/ConsultaPublica/listView.seam";

const RESUMO_MAX_LEN = 500;

/**
 * Coletor de processos judiciais (DataJud/CNJ) — dimensão "Integridade". Ver
 * README.md desta pasta para a discussão completa da API, do mapeamento de
 * movimentação e da entity resolution. Resumo essencial:
 *
 * - Busca só por `numeroProcesso` (a API não tem campo de parte/CPF/nome —
 *   ver types.ts). O `numeroProcesso` e o `tribunal` de origem são fornecidos
 *   pelo OPERADOR via CLI, nunca lidos do banco nem inferidos — a afirmação
 *   "este processo pertence a este candidato" é uma responsabilidade humana,
 *   verificada fora deste coletor (ex: notícia que cita o número exato do
 *   processo, publicação oficial nomeando o candidato, declaração do próprio
 *   candidato). O numeroProcesso, sendo a numeração única nacional, não tem
 *   ambiguidade de homônimo possível — diferente de um nome.
 * - `candidato_id` é validado em `prepare()` por PK exata (`id = :candidatoId`)
 *   — confiança 1.0, aborta sem gravar nada se não existir.
 * - `estagio_juridico` só é preenchido quando pelo menos um movimento do
 *   processo mapeia com confiança alta (`mapaMovimentacao.ts`, hoje só 2
 *   códigos). Sem isso, `normalize()` retorna `null` e nenhum evento é
 *   criado — nunca um evento tipo='processo' sem estágio.
 */
export class DatajudProcessoCollector extends Collector<DatajudProcessoBruto> {
  readonly fonte = FONTE;

  private candidatoResolvido: { id: string; nomeUrna: string } | null = null;

  constructor(
    private readonly candidatoId: string,
    private readonly numeroProcesso: string,
    private readonly tribunalAlias: string,
    private readonly client: DatajudApiClient,
    /** Link público verificado manualmente pelo operador (recomendado — ver
     * README). Se ausente, usa FONTE_URL_FALLBACK_CNJ. */
    private readonly fonteUrlOverride: string | undefined,
    deps: CollectorDeps = {}
  ) {
    super(deps);
  }

  protected async prepare(): Promise<boolean> {
    if (!this.deps.supabase) return false;

    const { data, error } = await this.deps.supabase
      .from("candidato")
      .select("id, nome_urna")
      .eq("id", this.candidatoId)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      logger.warn(
        FONTE,
        `candidatoId=${this.candidatoId} não encontrado na tabela candidato — pulando coleta, ` +
          "nenhum evento órfão será inserido."
      );
      return false;
    }

    this.candidatoResolvido = { id: data.id as string, nomeUrna: data.nome_urna as string };
    logger.info(
      FONTE,
      "candidato resolvido por id exato (match determinístico, confiança 1.0); numeroProcesso e " +
        "tribunal vieram de --numeroProcesso/--tribunal, fornecidos pelo operador — nunca lidos " +
        "do banco nem inferidos por nome (ver README, seção Entity resolution)",
      { candidatoId: this.candidatoId, nomeUrna: this.candidatoResolvido.nomeUrna }
    );
    return true;
  }

  async fetchAll(): Promise<DatajudProcessoBruto[]> {
    const processo = await this.client.buscarPorNumeroProcesso(this.numeroProcesso, this.tribunalAlias);
    return [
      {
        numeroProcessoConsultado: normalizarNumeroProcesso(this.numeroProcesso),
        tribunalAlias: this.tribunalAlias,
        processo,
      },
    ];
  }

  normalize(raw: DatajudProcessoBruto): NormalizedEventoInput | null {
    if (!this.candidatoResolvido) {
      logger.warn(FONTE, "normalize() chamado sem candidato resolvido — pulando", {
        numeroProcesso: raw.numeroProcessoConsultado,
      });
      return null;
    }

    if (!raw.processo) {
      logger.warn(
        FONTE,
        "DataJud não retornou nenhum processo para o numeroProcesso/tribunal informados — pulando " +
          "(número inexistente, ainda não indexado, ou tribunal errado)",
        { numeroProcesso: raw.numeroProcessoConsultado, tribunal: raw.tribunalAlias }
      );
      return null;
    }

    const movimentos = raw.processo.movimentos ?? [];
    const mapeados = movimentos
      .map((mov) => ({ mov, estagio: mapearCodigoMovimento(mov.codigo) }))
      .filter(
        (item): item is { mov: DatajudMovimento; estagio: NonNullable<ReturnType<typeof mapearCodigoMovimento>> } =>
          item.estagio !== null
      );

    if (mapeados.length === 0) {
      logger.warn(
        FONTE,
        "nenhum movimento deste processo mapeia com confiança para um estagio_juridico conhecido " +
          "(ver src/collectors/datajud/mapaMovimentacao.ts) — pulando. Isso é o comportamento " +
          "esperado e seguro para a maioria dos processos: só transito_julgado e arquivado " +
          "(definitivo) estão mapeados hoje; nunca inventamos uma correspondência.",
        {
          numeroProcesso: raw.numeroProcessoConsultado,
          codigosMovimentoEncontrados: movimentos.map((m) => m.codigo),
        }
      );
      return null;
    }

    // Entre os movimentos mapeados, usamos o mais recente cronologicamente
    // (por dataHora) como o estágio ATUAL do processo — não tentamos montar
    // uma ordem de "gravidade jurídica" entre os 8 valores do enum (isso
    // exigiria uma regra de precedência que não está documentada com
    // segurança em lugar nenhum consultado nesta tarefa). "Mais recente no
    // tempo" é a única ordenação que dá para justificar sem inventar.
    mapeados.sort((a, b) => new Date(b.mov.dataHora).getTime() - new Date(a.mov.dataHora).getTime());
    const escolhido = mapeados[0];

    const numeroFormatado = formatarNumeroProcesso(raw.processo.numeroProcesso);
    const classeNome = raw.processo.classe?.nome ?? "Processo judicial";
    const titulo = `${classeNome} — ${numeroFormatado}`;

    const resumo = truncarResumo(montarResumo(raw.processo, escolhido.mov), RESUMO_MAX_LEN);

    const dataEvento = isoParaData(escolhido.mov.dataHora);
    if (!dataEvento) {
      logger.warn(
        FONTE,
        "movimento mapeado sem dataHora reconhecível — pulando (data_evento é obrigatória)",
        { numeroProcesso: raw.numeroProcessoConsultado, movimento: escolhido.mov }
      );
      return null;
    }

    const fonteUrl = this.fonteUrlOverride ?? FONTE_URL_FALLBACK_CNJ;

    // hash estável: tipo + candidato + numeroProcesso — NÃO inclui o código
    // do movimento escolhido, de propósito. Assim, quando o processo avança
    // (ex: de "réu" para trânsito em julgado, em execuções futuras deste
    // coletor), o MESMO evento é atualizado (upsert), não duplicado — é o
    // mesmo fato ("este processo, movido contra este candidato") mudando de
    // estágio, não um fato novo.
    const hashConteudo = sha256Hex(`processo|${this.candidatoResolvido.id}|${raw.processo.numeroProcesso}`);

    return {
      candidato_id: this.candidatoResolvido.id,
      tipo: "processo",
      categoria: "controversia",
      estagio_juridico: escolhido.estagio, // NUNCA null aqui — normalize() já retornou null acima se não houvesse mapeamento confiável
      tema: [], // classificação temática por LLM fica para a Fase 2 (seção 6 do documento)
      titulo,
      resumo,
      data_evento: dataEvento,
      fonte_nome: `CNJ — DataJud (${raw.processo.tribunal ?? this.tribunalAlias.toUpperCase()})`,
      fonte_url: fonteUrl,
      fonte_confianca: 1, // 1 = oficial
      hash_conteudo: hashConteudo,
      // revisado_humano não é setado aqui: a coluna já tem DEFAULT false no
      // banco, e todo evento categoria='controversia' PRECISA nascer assim —
      // a policy de RLS de leitura pública só libera 'controversia' quando
      // revisado_humano=true. Isto é ainda mais importante aqui do que em
      // qualquer outro coletor: processo judicial é o tipo de fato mais
      // sensível do sistema (seção 9 do documento — risco de difamação).
    };
  }

  /**
   * Usado apenas pelo modo --dry-run da CLI, para inspecionar normalize()
   * sem consultar o banco (não requer service_role key).
   */
  definirCandidatoParaInspecao(candidatoId: string, nomeUrna = "(dry-run)"): void {
    this.candidatoResolvido = { id: candidatoId, nomeUrna };
  }
}

function isoParaData(iso: string | undefined | null): string | null {
  if (!iso) return null;
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? match[0] : null;
}

/** NNNNNNN-DD.AAAA.J.TR.OOOO — numeração única CNJ (Resolução 65/2008), 20 dígitos. */
function formatarNumeroProcesso(numero: string): string {
  const d = normalizarNumeroProcesso(numero);
  if (d.length !== 20) return numero;
  return `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16, 20)}`;
}

/** Resumo PRÓPRIO (nunca cópia de texto de imprensa), composto a partir de
 * campos estruturados oficiais. Nunca inclui CPF (a API nem devolve esse
 * campo — ver types.ts). */
function montarResumo(
  processo: DatajudProcessoBruto["processo"],
  movimentoEscolhido: DatajudMovimento
): string {
  if (!processo) return "";
  const partes: string[] = [];

  const assuntos = processo.assuntos?.map((a) => a.nome).filter(Boolean);
  if (assuntos && assuntos.length > 0) partes.push(`Assunto: ${assuntos.join("; ")}`);

  if (processo.orgaoJulgador?.nome) partes.push(`Órgão julgador: ${processo.orgaoJulgador.nome}`);

  const dataMov = isoParaData(movimentoEscolhido.dataHora);
  partes.push(
    `Movimentação mais recente considerada: ${movimentoEscolhido.nome}` +
      (dataMov ? ` (${dataMov})` : "")
  );

  return partes.length > 0 ? `${partes.join(". ")}.` : "Processo judicial sem detalhamento adicional.";
}

function truncarResumo(text: string, maxLen: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen - 1).trimEnd()}…`;
}
