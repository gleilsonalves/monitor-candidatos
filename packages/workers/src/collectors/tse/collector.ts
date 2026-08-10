import { Collector, type CollectorDeps } from "../../collector.js";
import { sha256Hex } from "../../lib/hash.js";
import { logger } from "../../lib/logger.js";
import { truncate } from "../../lib/text.js";
import type { NormalizedEventoInput } from "../../types.js";
import type { TseApiClient } from "./client.js";
import { normalizarNome, normalizarSigla, regiaoParaUf } from "./match.js";
import type { TseCandidatoAlvo, TseRawEvento } from "./types.js";

const FONTE = "tse_candidatura";
const RESUMO_MAX_LEN = 500;

/** Linha mínima de `candidato` necessária para tentar a resolução no TSE. */
interface CandidatoRow {
  id: string;
  nome_urna: string | null;
  partido_atual: string | null;
  uf: string | null;
  cargo_pretendido: string | null;
  id_tse: string | null;
}

/**
 * Coletor de candidaturas do TSE (DivulgaCand) — registro de candidatura e
 * bens declarados. Ver README.md desta pasta para os endpoints usados e as
 * decisões de modelagem.
 *
 * Diferença estrutural em relação ao coletor da Câmara: a Câmara é uma API
 * por-deputado (um `idCamara` → as proposições daquele deputado), então
 * `prepare()` resolve UM candidato_id determinístico (seção 5, passo 1) antes
 * de buscar qualquer coisa. O TSE não tem um endpoint "candidatura de um
 * deputado específico" independente de UF/cargo/ano — os dados vêm por
 * UF+cargo. Por isso este coletor processa TODOS os candidatos elegíveis da
 * tabela `candidato` numa única execução: `prepare()` carrega a tabela
 * inteira e resolve, para cada linha, o código de cargo do TSE; `fetchAll()`
 * agrupa por (UF, cargo) para minimizar chamadas e, para cada candidato,
 * tenta o match forte por nome normalizado + UF + partido (seção 5, passo 2
 * — confiança ~0.9, NUNCA fuzzy). Sem match exato e inequívoco, o candidato é
 * pulado com um aviso — nenhum evento é gerado a partir de um match ambíguo.
 *
 * Quando o match dá certo e `candidato.id_tse` ainda está NULL, este
 * collector grava `id_tse` (enriquecimento de identidade, não uma métrica) —
 * assim a próxima execução já teria, em tese, condição de fazer o match
 * determinístico do passo 1 (embora hoje `fetchAll` sempre refaça o match
 * por nome, já que os dados chegam por UF/cargo e não por id_tse).
 */
export class TseCandidaturaCollector extends Collector<TseRawEvento> {
  readonly fonte = FONTE;

  private idEleicao: number | null = null;
  private candidatosAlvo: TseCandidatoAlvo[] = [];

  constructor(
    private readonly ano: number,
    private readonly client: TseApiClient,
    deps: CollectorDeps = {}
  ) {
    super(deps);
  }

  protected async prepare(): Promise<boolean> {
    if (!this.deps.supabase) return false;

    const { data, error } = await this.deps.supabase
      .from("candidato")
      .select("id, nome_urna, partido_atual, uf, cargo_pretendido, id_tse");
    if (error) throw error;

    if (!data || data.length === 0) {
      logger.warn(FONTE, "nenhum candidato cadastrado em `candidato` — nada para resolver no TSE");
      return false;
    }

    return this.carregarCandidatosAlvo(data as CandidatoRow[]);
  }

  /**
   * Resolve `idEleicao` (a partir do ano) e os códigos de cargo do TSE, e
   * filtra `candidatos` para os que têm dado suficiente (uf, partido, nome,
   * cargo mapeável) para tentar o match. Compartilhado entre `prepare()`
   * (execução real, carrega da tabela `candidato`) e
   * `definirAlvoParaInspecao()` (modo --dry-run da CLI, um candidato
   * sintético só para inspecionar fetch/normalize sem banco).
   */
  private async carregarCandidatosAlvo(candidatos: CandidatoRow[]): Promise<boolean> {
    const eleicoes = await this.client.listarEleicoesOrdinarias();
    const eleicao = eleicoes.find((e) => e.ano === this.ano && e.tipoAbrangencia === "F");
    if (!eleicao) {
      logger.warn(
        FONTE,
        `nenhuma "Eleição Geral Federal" encontrada no TSE para o ano ${this.ano} — pulando coleta`
      );
      return false;
    }
    this.idEleicao = eleicao.id;
    logger.info(FONTE, `eleição resolvida: ${eleicao.nomeEleicao} (idEleicao=${eleicao.id})`);

    const cargos = await this.client.listarCargos(this.ano, this.idEleicao);
    const cargoPorNome = new Map<string, number>(
      cargos.map((c) => [normalizarNome(c.nome ?? ""), c.codigo])
    );

    const alvos: TseCandidatoAlvo[] = [];
    for (const c of candidatos) {
      if (!c.uf || !c.partido_atual || !c.nome_urna || !c.cargo_pretendido) {
        logger.warn(
          FONTE,
          `candidato_id=${c.id} sem uf/partido_atual/nome_urna/cargo_pretendido — não é possível ` +
            "tentar o match no TSE, pulando",
          { candidatoId: c.id }
        );
        continue;
      }
      const cargoCodigo = cargoPorNome.get(normalizarNome(c.cargo_pretendido));
      if (cargoCodigo === undefined) {
        logger.warn(
          FONTE,
          `cargo_pretendido="${c.cargo_pretendido}" (candidato_id=${c.id}) não corresponde a nenhum ` +
            "cargo do TSE para esta eleição — pulando",
          { candidatoId: c.id }
        );
        continue;
      }
      alvos.push({
        id: c.id,
        nome_urna: c.nome_urna,
        uf: c.uf,
        partido_atual: c.partido_atual,
        cargo_pretendido: c.cargo_pretendido,
        id_tse: c.id_tse,
        cargoCodigo,
      });
    }

    if (alvos.length === 0) {
      logger.warn(FONTE, "nenhum candidato com dados suficientes para tentar o match no TSE");
      return false;
    }

    this.candidatosAlvo = alvos;
    return true;
  }

  /**
   * Usado apenas pelo modo --dry-run da CLI: monta um único `TseCandidatoAlvo`
   * a partir de nome/UF/partido/cargo informados na linha de comando e reusa
   * a mesma resolução de eleição/cargo de `prepare()`. Não requer Supabase —
   * só chama a API pública do TSE. `candidatoId` é um placeholder, deixado
   * explícito no output da CLI.
   */
  async definirAlvoParaInspecao(
    candidatoId: string,
    alvo: { nome_urna: string; uf: string; partido_atual: string; cargo_pretendido: string }
  ): Promise<boolean> {
    return this.carregarCandidatosAlvo([{ id: candidatoId, id_tse: null, ...alvo }]);
  }

  async fetchAll(): Promise<TseRawEvento[]> {
    if (!this.idEleicao) {
      throw new Error("fetchAll() chamado sem idEleicao resolvido — prepare() deveria ter rodado antes");
    }
    const idEleicao = this.idEleicao;

    // agrupa por (uf, cargoCodigo) para não repetir a mesma chamada de listagem
    // para candidatos diferentes da mesma UF/cargo.
    const grupos = new Map<string, { uf: string; cargoCodigo: number }>();
    for (const alvo of this.candidatosAlvo) {
      grupos.set(`${alvo.uf}|${alvo.cargoCodigo}`, { uf: alvo.uf, cargoCodigo: alvo.cargoCodigo });
    }

    const brutos: TseRawEvento[] = [];

    for (const { uf, cargoCodigo } of grupos.values()) {
      const candidatosDoGrupo = this.candidatosAlvo.filter(
        (a) => a.uf === uf && a.cargoCodigo === cargoCodigo
      );

      logger.info(FONTE, `listando candidaturas TSE ${this.ano}/${uf}/cargo=${cargoCodigo}...`, {
        candidatosNoGrupo: candidatosDoGrupo.length,
      });
      const candidatosTse = await this.client.listarCandidatos(this.ano, uf, idEleicao, cargoCodigo);

      for (const alvo of candidatosDoGrupo) {
        const nomeAlvo = normalizarNome(alvo.nome_urna);
        const partidoAlvo = normalizarSigla(alvo.partido_atual);

        const matches = candidatosTse.filter(
          (t) =>
            normalizarNome(t.nomeUrna) === nomeAlvo &&
            normalizarSigla(t.partido?.sigla ?? "") === partidoAlvo
        );

        if (matches.length === 0) {
          logger.info(
            FONTE,
            `nenhuma candidatura ${this.ano} encontrada no TSE para "${alvo.nome_urna}" ` +
              `(${uf}/${alvo.partido_atual}) — pode ainda não ter registrado candidatura, ou o ` +
              "período de registro pode estar incompleto nesta data",
            { candidatoId: alvo.id }
          );
          continue;
        }
        if (matches.length > 1) {
          logger.warn(
            FONTE,
            `match AMBÍGUO no TSE para "${alvo.nome_urna}" (${uf}/${alvo.partido_atual}): ` +
              `${matches.length} candidaturas com o mesmo nome normalizado — pulando para evitar ` +
              "atribuir o registro errado ao candidato errado (seção 5 do documento de arquitetura)",
            { candidatoId: alvo.id, idsCandidatosTse: matches.map((m) => m.id) }
          );
          continue;
        }

        const match = matches[0];

        let detalhe;
        try {
          detalhe = await this.client.buscarCandidato(this.ano, uf, idEleicao, match.id);
        } catch (err) {
          logger.error(FONTE, `falha ao buscar detalhe da candidatura id_tse=${match.id}`, {
            candidatoId: alvo.id,
            erro: err instanceof Error ? err.message : String(err),
          });
          continue;
        }

        await this.gravarIdTseSeAusente(alvo, detalhe.id);

        brutos.push({ kind: "candidatura", candidatoId: alvo.id, ano: this.ano, uf, idEleicao, detalhe });
        if (detalhe.bens && detalhe.bens.length > 0) {
          brutos.push({ kind: "bens", candidatoId: alvo.id, ano: this.ano, uf, idEleicao, detalhe });
        }
      }
    }

    return brutos;
  }

  /**
   * Enriquecimento de identidade (não é uma métrica do produto): grava
   * `candidato.id_tse` quando o match forte (nome+UF+partido) resolveu um
   * candidato que ainda não tinha id_tse, para que execuções futuras tenham
   * a chance de evoluir para o match determinístico do passo 1. Não-fatal:
   * se a gravação falhar, loga e segue (o evento ainda é gerado normalmente).
   * Não faz nada em modo --dry-run (sem client Supabase).
   */
  private async gravarIdTseSeAusente(alvo: TseCandidatoAlvo, idTse: number): Promise<void> {
    if (alvo.id_tse || !this.deps.supabase) return;

    const { error } = await this.deps.supabase
      .from("candidato")
      .update({ id_tse: String(idTse) })
      .eq("id", alvo.id);

    if (error) {
      logger.error(FONTE, `falha ao gravar id_tse=${idTse} para candidato_id=${alvo.id}`, {
        erro: error.message,
      });
      return;
    }

    logger.info(
      FONTE,
      `id_tse=${idTse} gravado para candidato_id=${alvo.id} (match forte nome+UF+partido, confiança ~0.9)`
    );
    alvo.id_tse = String(idTse);
  }

  normalize(raw: TseRawEvento): NormalizedEventoInput | null {
    const { detalhe, candidatoId, ano, uf, idEleicao } = raw;

    if (!detalhe.dataUltimaAtualizacao) {
      logger.warn(
        FONTE,
        "candidatura sem dataUltimaAtualizacao — pulando (data_evento é obrigatória)",
        { idCandidatoTse: detalhe.id }
      );
      return null;
    }
    const dataEvento = detalhe.dataUltimaAtualizacao.slice(0, 10);

    const regiao = regiaoParaUf(uf);
    const fonteUrl = regiao
      ? `https://divulgacandcontas.tse.jus.br/divulga/#/candidato/${regiao}/${uf}/${idEleicao}/${detalhe.id}/${ano}/${uf}`
      : `https://divulgacandcontas.tse.jus.br/divulga/rest/v1/candidatura/buscar/${ano}/${uf}/${idEleicao}/candidato/${detalhe.id}`;

    const partidoSigla = detalhe.partido?.sigla ?? "?";
    const cargoNome = detalhe.cargo?.nome ?? "candidatura";

    if (raw.kind === "candidatura") {
      const hashConteudo = sha256Hex(`nomeacao|candidatura|${candidatoId}|tse|${ano}|${detalhe.id}`);
      // nomeColigacao repete a sigla do partido quando é "partido isolado" (sem
      // coligação/federação de fato) — só mostra a coligação quando ela agrega
      // informação de verdade.
      const coligacaoRelevante =
        detalhe.nomeColigacao && normalizarSigla(detalhe.nomeColigacao) !== normalizarSigla(partidoSigla)
          ? detalhe.nomeColigacao
          : null;
      const resumo = truncate(
        `Registro de candidatura nº ${detalhe.numero ?? "não informado"} pelo ${partidoSigla}` +
          `${coligacaoRelevante ? ` (${coligacaoRelevante})` : ""}. ` +
          `Situação: ${detalhe.descricaoSituacao ?? "não informada"}. ` +
          `Totalização: ${detalhe.descricaoTotalizacao ?? "não informada"}.`,
        RESUMO_MAX_LEN
      );

      return {
        candidato_id: candidatoId,
        // "registro de candidatura" não tem tipo próprio no enum de evento;
        // 'nomeacao' é o mais próximo semanticamente (ato oficial formal de
        // investidura numa disputa eleitoral) — decisão pragmática dentro do
        // enum existente, documentada no README desta pasta.
        tipo: "nomeacao",
        categoria: "neutro",
        estagio_juridico: null, // só se aplica a tipo='processo' — CHECK constraint no banco
        tema: [],
        titulo: `Candidatura a ${cargoNome} ${ano} — ${partidoSigla}/${uf}`,
        resumo,
        data_evento: dataEvento,
        fonte_nome: "TSE — DivulgaCand",
        fonte_url: fonteUrl,
        fonte_confianca: 1,
        hash_conteudo: hashConteudo,
      };
    }

    // kind === "bens": resumo agregado dos bens declarados (não um evento por
    // item — evita poluir a timeline do candidato com dezenas de eventos
    // minúsculos por uma única declaração).
    const bens = detalhe.bens ?? [];
    const total = detalhe.totalDeBens ?? bens.reduce((acc, b) => acc + (b.valor ?? 0), 0);
    const totalFormatado = total.toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
    const hashConteudo = sha256Hex(`nomeacao|bens|${candidatoId}|tse|${ano}|${detalhe.id}`);

    return {
      candidato_id: candidatoId,
      tipo: "nomeacao",
      categoria: "neutro",
      estagio_juridico: null,
      tema: [],
      titulo: `Bens declarados — candidatura ${ano} (${partidoSigla}/${uf})`,
      resumo: truncate(
        `${bens.length} bem(ns) declarado(s) à Justiça Eleitoral na candidatura de ${ano}, ` +
          `totalizando ${totalFormatado}.`,
        RESUMO_MAX_LEN
      ),
      data_evento: dataEvento,
      fonte_nome: "TSE — DivulgaCand",
      fonte_url: fonteUrl,
      fonte_confianca: 1,
      hash_conteudo: hashConteudo,
    };
  }
}
