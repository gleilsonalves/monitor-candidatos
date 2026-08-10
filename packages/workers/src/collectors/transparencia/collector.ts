import { Collector, type CollectorDeps } from "../../collector.js";
import { sha256Hex } from "../../lib/hash.js";
import { logger } from "../../lib/logger.js";
import { truncate } from "../../lib/text.js";
import type { NormalizedEventoInput } from "../../types.js";
import type { PortalTransparenciaApiClient } from "./client.js";
import type { RegistroSancaoBruto } from "./types.js";

const FONTE = "transparencia_sancoes";
const RESUMO_MAX_LEN = 500;

/**
 * Coletor de sanções administrativas (CEIS/CNEP) do Portal da Transparência
 * (CGU) contra pessoa física. Ver README.md desta pasta para a discussão
 * completa da API, da limitação de entity resolution e de como validar sem
 * uma API key real.
 *
 * Entity resolution — DIFERENTE do coletor da Câmara: aqui não há um ID
 * externo já cadastrado em `candidato` que sirva como chave de busca na API
 * (a API só aceita CPF/CNPJ ou nome). Como `candidato.cpf_hash` é só um
 * hash (nunca o CPF em claro, por LGPD — seção 9 do documento de
 * arquitetura) e a API do Portal exige o CPF em claro na query, o CPF não
 * pode vir do banco. A resolução aqui é em DUAS PARTES, ambas
 * determinísticas e nenhuma delas fuzzy:
 *
 *   1. `candidato_id` é resolvido do mesmo jeito que no coletor da Câmara —
 *      por `id_camara` (confiança 1.0, seção 5 passo 1).
 *   2. O CPF em claro usado para consultar a API é fornecido pelo operador
 *      via `--cpf` na CLI (nunca lido do banco, nunca gravado no banco) — é
 *      uma asserção externa e auditável de que "este candidato_id
 *      corresponde a este CPF", vinda de uma fonte confiável fora deste
 *      sistema (ex: o próprio registro de candidatura no TSE, que exige CPF
 *      na filiação, mas que este banco propositalmente não armazena em
 *      claro).
 *
 * **Nunca** busca por nome (`nomeSancionado`) para resolver o candidato —
 * combinar um match fuzzy de nome com uma categoria `controversia` é
 * exatamente o cenário que a seção 5 do documento proíbe ("nunca deixar
 * match fuzzy alimentar métrica direto... é o pior bug possível deste
 * sistema").
 */
export class TransparenciaSancoesCollector extends Collector<RegistroSancaoBruto> {
  readonly fonte = FONTE;

  private candidatoId: string | null = null;
  private candidatoNome: string | null = null;

  constructor(
    private readonly idCamara: number,
    /** CPF em claro (só dígitos ou formatado), usado unicamente para a
     * consulta à API — nunca persistido em `candidato` nem em `raw_payload`
     * (o payload bruto gravado é a RESPOSTA da API, que já traz o CPF
     * mascarado em `pessoa.cpfFormatado`, não o CPF de entrada). */
    private readonly cpf: string,
    private readonly client: PortalTransparenciaApiClient,
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
          "nenhum evento órfão será inserido."
      );
      return false;
    }

    this.candidatoId = data.id as string;
    this.candidatoNome = data.nome_urna as string;
    logger.info(
      FONTE,
      "candidato resolvido via id_camara (match determinístico); CPF de consulta veio " +
        "de --cpf, fornecido pelo operador — nunca lido do banco",
      { idCamara: this.idCamara, candidatoId: this.candidatoId, nomeUrna: this.candidatoNome }
    );
    return true;
  }

  async fetchAll(): Promise<RegistroSancaoBruto[]> {
    const [ceis, cnep] = await Promise.all([
      this.client.buscarCeisPorCpf(this.cpf),
      this.client.buscarCnepPorCpf(this.cpf),
    ]);

    return [
      ...ceis.map((registro): RegistroSancaoBruto => ({ cadastro: "CEIS", registro })),
      ...cnep.map((registro): RegistroSancaoBruto => ({ cadastro: "CNEP", registro })),
    ];
  }

  normalize(raw: RegistroSancaoBruto): NormalizedEventoInput | null {
    if (!this.candidatoId) {
      // não deveria acontecer em run() normal (prepare() já teria abortado),
      // mas protege chamadas diretas de normalize() (ex: dry-run sem setup).
      logger.warn(FONTE, "normalize() chamado sem candidato_id resolvido — pulando", {
        registroId: raw.registro.id,
      });
      return null;
    }

    const { cadastro, registro } = raw;

    // Defesa extra: como consultamos por CPF, o esperado é sempre
    // pessoa.tipo === 'FISICA'. Se a API devolver outra coisa (ex: um
    // registro de pessoa jurídica que por algum motivo bateu na busca),
    // pulamos em vez de gravar uma sanção de empresa como se fosse do
    // candidato — mais uma barreira contra atribuição errada.
    if (registro.pessoa?.tipo && registro.pessoa.tipo.toUpperCase() !== "FISICA") {
      logger.warn(
        FONTE,
        "registro retornado pela busca por CPF não é de pessoa física — pulando " +
          "(proteção contra atribuição incorreta)",
        { registroId: registro.id, cadastro, pessoaTipo: registro.pessoa.tipo }
      );
      return null;
    }

    const dataEvento = parseDataBrasileira(registro.dataInicioSancao ?? registro.dataPublicacaoSancao);
    if (!dataEvento) {
      logger.warn(FONTE, "registro sem data de sanção reconhecível — pulando (data_evento é obrigatória)", {
        registroId: registro.id,
        cadastro,
        dataInicioSancao: registro.dataInicioSancao,
        dataPublicacaoSancao: registro.dataPublicacaoSancao,
      });
      return null;
    }

    const fonteUrl = construirFonteUrl(cadastro, registro);
    if (!fonteUrl) {
      logger.warn(
        FONTE,
        "não foi possível montar a URL pública do registro (id ou pessoa.id ausente) — " +
          "pulando (fonte_url é obrigatória, nunca gravamos evento sem link para a origem)",
        { registroId: registro.id, cadastro }
      );
      return null;
    }

    const orgao = registro.orgaoSancionador?.nome ?? registro.fonteSancao?.nomeExibicao ?? cadastro;
    const tipoSancaoDescricao = registro.tipoSancao?.descricaoResumida ?? "Sanção administrativa";

    const titulo = `${tipoSancaoDescricao} — ${orgao} (${cadastro})`;

    const resumo = truncate(montarResumo(cadastro, registro), RESUMO_MAX_LEN);

    // hash estável: tipo + candidato + identificador da fonte (id do registro
    // no cadastro CEIS ou CNEP). Independe de campos que podem ser
    // republicados/retificados pela CGU sem deixar de ser "o mesmo fato".
    const hashConteudo = sha256Hex(`sancao|${this.candidatoId}|${cadastro}|${registro.id}`);

    return {
      candidato_id: this.candidatoId,
      tipo: "sancao",
      categoria: "controversia",
      estagio_juridico: null, // sanção administrativa não é processo judicial — só se aplica a tipo='processo'
      tema: [], // classificação temática por LLM fica para a Fase 2 (seção 6 do documento)
      titulo,
      resumo,
      data_evento: dataEvento,
      fonte_nome: `Portal da Transparência — ${cadastro}`,
      fonte_url: fonteUrl,
      fonte_confianca: 1, // 1 = oficial
      hash_conteudo: hashConteudo,
      // revisado_humano não é setado aqui: a coluna já tem DEFAULT false no
      // banco, e todo evento categoria='controversia' PRECISA nascer assim —
      // a policy de RLS de leitura pública só libera 'controversia' quando
      // revisado_humano=true (ver db/migrations/0001_core_schema.sql e o
      // README desta pasta). Setar explicitamente aqui só duplicaria a regra
      // sem alterar o comportamento.
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
 * O schema OpenAPI da API declara as datas como `string` livre, sem exemplo.
 * A documentação dos PARÂMETROS de busca (`dataInicialSancao`/
 * `dataFinalSancao`) usa explicitamente "DD/MM/AAAA", então tratamos esse
 * formato como o mais provável para os campos de resposta também, com
 * "AAAA-MM-DD" (ISO) como segundo formato aceito. Qualquer outro formato
 * (ou string vazia/ausente) retorna `null` — o chamador pula o registro em
 * vez de gravar uma data adivinhada.
 */
function parseDataBrasileira(valor: string | undefined | null): string | null {
  if (!valor) return null;
  const v = valor.trim();

  const brMatch = v.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (brMatch) {
    const [, dd, mm, yyyy] = brMatch;
    return `${yyyy}-${mm}-${dd}`;
  }

  const isoMatch = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return isoMatch[0];
  }

  return null;
}

/**
 * Monta a URL pública de detalhe do registro no Portal da Transparência.
 * Padrão confirmado por exemplos reais indexados publicamente:
 *   https://portaldatransparencia.gov.br/sancoes/ceis/{id}/pessoa-fisica/{pessoa.id}
 *   https://portaldatransparencia.gov.br/sancoes/ceis/{id}/pessoa-juridica/{pessoa.id}
 * (mesmo padrão para /sancoes/cnep/...). Não documentado formalmente no
 * OpenAPI — é a URL do site público, não da API — por isso a construção é
 * defensiva: se faltar `id` ou `pessoa.id`, retorna `null` em vez de montar
 * um link que pode não resolver.
 */
function construirFonteUrl(
  cadastro: "CEIS" | "CNEP",
  registro: RegistroSancaoBruto["registro"]
): string | null {
  if (!registro.id || !registro.pessoa?.id) return null;
  const tipoPessoaSegmento =
    registro.pessoa.tipo?.toUpperCase() === "JURIDICA" ? "pessoa-juridica" : "pessoa-fisica";
  return `https://portaldatransparencia.gov.br/sancoes/${cadastro.toLowerCase()}/${registro.id}/${tipoPessoaSegmento}/${registro.pessoa.id}`;
}

/** Resumo PRÓPRIO (nunca cópia de texto de imprensa — seção 4 do documento),
 * composto a partir de campos estruturados da resposta oficial da API. */
function montarResumo(cadastro: "CEIS" | "CNEP", registro: RegistroSancaoBruto["registro"]): string {
  const partes: string[] = [];

  const tipo = registro.tipoSancao?.descricaoPortal ?? registro.tipoSancao?.descricaoResumida;
  if (tipo) partes.push(tipo);

  const orgao = registro.orgaoSancionador?.nome;
  if (orgao) partes.push(`aplicada por ${orgao}`);

  if (registro.dataInicioSancao) partes.push(`com início em ${registro.dataInicioSancao}`);
  if (registro.dataFimSancao) partes.push(`e término em ${registro.dataFimSancao}`);

  const fundamentacao = registro.fundamentacao
    ?.map((f) => f.descricao)
    .filter((d): d is string => Boolean(d));
  if (fundamentacao && fundamentacao.length > 0) {
    partes.push(`Fundamentação: ${fundamentacao.join("; ")}`);
  }

  if (registro.numeroProcesso) partes.push(`Processo nº ${registro.numeroProcesso}`);

  const corpo = partes.length > 0 ? partes.join(". ") : `Registro ${cadastro} sem detalhamento textual.`;
  return `${corpo}.`;
}
