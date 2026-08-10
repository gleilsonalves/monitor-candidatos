import { Collector, type CollectorDeps } from "../../collector.js";
import { sha256Hex } from "../../lib/hash.js";
import { logger } from "../../lib/logger.js";
import { truncate } from "../../lib/text.js";
import type { NormalizedEventoInput } from "../../types.js";
import type { CamaraApiClient } from "./client.js";
import type { ProposicaoResumo } from "./types.js";

const FONTE = "camara_proposicoes";
const RESUMO_MAX_LEN = 500;

/**
 * Coletor de proposições de autoria de um deputado na Câmara. Primeiro
 * coletor concreto do framework (seção 10 do documento de arquitetura) —
 * serve de referência para os próximos adaptadores (TSE, Portal da
 * Transparência, DataJud, TCU, YouTube, Bluesky, Meta Ads, DOU).
 *
 * Entity resolution: DETERMINÍSTICA via id_camara (seção 5, passo 1 — match
 * por ID, confiança 1.0). Nunca faz fuzzy match nem cria candidato novo: se
 * o id_camara recebido não existir na tabela `candidato`, prepare() retorna
 * false e run() aborta sem gravar nada (nenhum evento órfão).
 */
export class CamaraProposicoesCollector extends Collector<ProposicaoResumo> {
  readonly fonte = FONTE;

  private candidatoId: string | null = null;
  private candidatoNome: string | null = null;

  constructor(
    private readonly idCamara: number,
    private readonly client: CamaraApiClient,
    deps: CollectorDeps = {}
  ) {
    super(deps);
  }

  protected async prepare(): Promise<boolean> {
    if (!this.deps.supabase) return false;

    const { data, error } = await this.deps.supabase
      .from("candidato")
      .select("id, nome_urna")
      .eq("id_camara", this.idCamara)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      logger.warn(
        FONTE,
        `id_camara=${this.idCamara} não encontrado na tabela candidato — pulando coleta, ` +
          "nenhum evento órfão será inserido. Cadastre o candidato antes de rodar este coletor " +
          "para ele."
      );
      return false;
    }

    this.candidatoId = data.id as string;
    this.candidatoNome = data.nome_urna as string;
    logger.info(FONTE, `candidato resolvido via id_camara (match determinístico)`, {
      idCamara: this.idCamara,
      candidatoId: this.candidatoId,
      nomeUrna: this.candidatoNome,
    });
    return true;
  }

  async fetchAll(): Promise<ProposicaoResumo[]> {
    return this.client.listarProposicoesPorAutor(this.idCamara);
  }

  normalize(raw: ProposicaoResumo): NormalizedEventoInput | null {
    if (!this.candidatoId) {
      // não deveria acontecer em run() normal (prepare() já teria abortado),
      // mas protege chamadas diretas de normalize() (ex: dry-run sem setup).
      logger.warn(FONTE, "normalize() chamado sem candidato_id resolvido — pulando", {
        proposicaoId: raw.id,
      });
      return null;
    }

    if (!raw.dataApresentacao) {
      logger.warn(FONTE, "proposição sem dataApresentacao — pulando (data_evento é obrigatória)", {
        proposicaoId: raw.id,
      });
      return null;
    }

    const dataEvento = raw.dataApresentacao.slice(0, 10);
    const identificacao =
      raw.ano && raw.ano > 0
        ? `${raw.siglaTipo} ${raw.numero}/${raw.ano}`
        : `${raw.siglaTipo} ${raw.numero}`;
    const resumo = raw.ementa ? truncate(raw.ementa, RESUMO_MAX_LEN) : null;

    // hash estável: tipo + candidato + identificador da fonte (id da proposição
    // na Câmara). Independe do conteúdo mutável (ementa pode ser retificada),
    // então reprocessar a mesma proposição sempre bate no mesmo evento (upsert).
    const hashConteudo = sha256Hex(
      `proposicao|${this.candidatoId}|camara|${raw.id}`
    );

    return {
      candidato_id: this.candidatoId,
      tipo: "proposicao",
      categoria: "realizacao", // proposição de autoria é produção legislativa, não controvérsia
      estagio_juridico: null, // só permitido para tipo='processo' — CHECK constraint no banco
      tema: [], // classificação temática por LLM fica para a Fase 2 (seção 6)
      titulo: identificacao,
      resumo,
      data_evento: dataEvento,
      fonte_nome: "Câmara dos Deputados",
      fonte_url: `https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=${raw.id}`,
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
