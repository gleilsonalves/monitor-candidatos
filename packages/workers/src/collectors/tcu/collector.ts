import { Collector, type CollectorDeps } from "../../collector.js";
import { sha256Hex } from "../../lib/hash.js";
import { logger } from "../../lib/logger.js";
import { truncate } from "../../lib/text.js";
import type { NormalizedEventoInput } from "../../types.js";
import type { TcuCertidoesApiClient } from "./client.js";
import type { RegistroTcuBruto, ResponsavelSancaoTcuDTO } from "./types.js";

const FONTE = "tcu_integridade";
const RESUMO_MAX_LEN = 500;

/**
 * Coletor da dimensão "Integridade" — achados de contas do TCU (Tribunal de
 * Contas da União): responsáveis com contas julgadas irregulares e
 * responsáveis inabilitados para o exercício de função pública. Ver
 * README.md desta pasta para a discussão completa da API real encontrada,
 * da decisão de modelagem (`tipo='sancao'`, não `'processo'`) e da
 * limitação de entity resolution.
 *
 * **Modelagem — por que `tipo='sancao'` e não `'processo'`**: um acórdão do
 * TCU julgando contas irregulares (ou aplicando inabilitação) é um achado de
 * tribunal de contas — natureza administrativa/fiscal sobre o uso de
 * recursos públicos. NÃO é um processo da Justiça comum/eleitoral/criminal
 * (denúncia, ação penal, condenação...), que é o que o enum
 * `estagio_juridico` modela (seção 1 do documento de arquitetura). Colapsar
 * os dois seria exatamente o tipo de confusão que a seção 1 pede para evitar
 * — "TCU julgou as contas irregulares" e "condenado criminalmente" são
 * coisas muito diferentes. Por isso: `tipo='sancao'`, `categoria='controversia'`,
 * `estagio_juridico=null` (o CHECK constraint do banco rejeita qualquer
 * outro valor para `tipo<>'processo'`).
 *
 * **Entity resolution — DIFERENTE dos coletores da Câmara/Portal da
 * Transparência**: os webservices do TCU só buscam por `cpf`/`cnpj`,
 * `parteNome`, `uf` ou `municipio` — não existe um ID interno do candidato
 * (como `id_camara`) que a API do TCU reconheça, e muitos candidatos
 * relevantes (ex: candidatos à Presidência sem mandato na Câmara) sequer têm
 * `id_camara` preenchido em `candidato`. Por isso este coletor recebe o
 * `candidato_id` (UUID, chave primária) DIRETAMENTE do operador via
 * `--candidatoId` na CLI, em vez de resolvê-lo internamente a partir de um
 * ID externo — `prepare()` só CONFIRMA que o UUID informado existe em
 * `candidato` (evita evento órfão por erro de digitação), não faz nenhuma
 * resolução fuzzy. O CPF usado na consulta à API segue o mesmo padrão do
 * coletor do Portal da Transparência: vem de `--cpf`, nunca do banco, nunca
 * é persistido.
 */
export class TcuIntegridadeCollector extends Collector<RegistroTcuBruto> {
  readonly fonte = FONTE;

  private candidatoNomeUrna: string | null = null;

  constructor(
    /** UUID de `candidato.id` — fornecido diretamente pelo operador (ver
     * README, seção "Entity resolution"), nunca resolvido por nome. */
    private readonly candidatoId: string,
    /** CPF em claro (só dígitos ou formatado), usado unicamente para a
     * consulta à API — nunca persistido em `candidato` nem em `raw_payload`
     * (o payload bruto gravado é a RESPOSTA da API, que já vem com o CPF
     * mascarado em `numeroRegistro`, não o CPF de entrada). */
    private readonly cpf: string,
    private readonly client: TcuCertidoesApiClient,
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
        `candidato_id=${this.candidatoId} não encontrado na tabela candidato — pulando coleta, ` +
          "nenhum evento órfão será inserido."
      );
      return false;
    }

    this.candidatoNomeUrna = data.nome_urna as string;
    logger.info(
      FONTE,
      "candidato confirmado por id (chave primária, informada pelo operador via --candidatoId); " +
        "CPF de consulta veio de --cpf, fornecido pelo operador — nunca lido do banco",
      { candidatoId: this.candidatoId, nomeUrna: this.candidatoNomeUrna }
    );
    return true;
  }

  async fetchAll(): Promise<RegistroTcuBruto[]> {
    const [contasIrregulares, inabilitados] = await Promise.all([
      this.client.buscarContasIrregularesPorCpf(this.cpf),
      this.client.buscarInabilitadosPorCpf(this.cpf),
    ]);

    return [
      ...contasIrregulares.map((dado): RegistroTcuBruto => ({ registro: "CONTAS_IRREGULARES", dado })),
      ...inabilitados.map((dado): RegistroTcuBruto => ({ registro: "INABILITADOS", dado })),
    ];
  }

  normalize(raw: RegistroTcuBruto): NormalizedEventoInput | null {
    const { registro, dado } = raw;

    // Defesa 1: os dois cadastros do TCU misturam CPF e CNPJ na mesma lista.
    // Como consultamos por CPF, o esperado é sempre tipoRegistro === 'CPF'.
    // Se vier outra coisa, pulamos — nunca atribuímos sanção de empresa a
    // um candidato (pessoa física).
    if (dado.tipoRegistro && dado.tipoRegistro.toUpperCase() !== "CPF") {
      logger.warn(
        FONTE,
        "registro retornado pela busca por CPF não é de pessoa física — pulando " +
          "(proteção contra atribuição incorreta)",
        { codigoProcesso: dado.codigoProcesso, registro, tipoRegistro: dado.tipoRegistro }
      );
      return null;
    }

    // Defesa 2: mesmo já filtrando por `cpf` no corpo da requisição,
    // confirmamos que o numeroRegistro devolvido bate exatamente (só
    // dígitos) com o CPF consultado antes de gravar qualquer coisa. Camada
    // extra determinística — nunca fuzzy (seção 5 do documento).
    const cpfConsulta = onlyDigits(this.cpf);
    const cpfRetorno = onlyDigits(dado.numeroRegistro ?? "");
    if (!cpfConsulta || cpfRetorno !== cpfConsulta) {
      logger.warn(
        FONTE,
        "CPF do registro retornado não bate com o CPF consultado — pulando " +
          "(proteção contra atribuição incorreta)",
        { codigoProcesso: dado.codigoProcesso, registro }
      );
      return null;
    }

    const dataEvento = parseDataBrasileira(dado.dataTransitoEmJulgado);
    if (!dataEvento) {
      logger.warn(
        FONTE,
        "registro sem dataTransitoEmJulgado reconhecível — pulando (data_evento é obrigatória)",
        { codigoProcesso: dado.codigoProcesso, registro, dataTransitoEmJulgado: dado.dataTransitoEmJulgado }
      );
      return null;
    }

    const fonteUrl = dado.linkDeliberacoesProcesso;
    if (!fonteUrl) {
      logger.warn(
        FONTE,
        "registro sem linkDeliberacoesProcesso — pulando (fonte_url é obrigatória, nunca " +
          "gravamos evento sem link para a origem)",
        { codigoProcesso: dado.codigoProcesso, registro }
      );
      return null;
    }

    const titulo = montarTitulo(registro, dado);
    const resumo = truncate(montarResumo(registro, dado), RESUMO_MAX_LEN);

    // hash estável: tipo + candidato + fonte + registro + identificador do
    // processo no TCU. codigoProcesso é o ID interno mais estável observado;
    // cai para numeroProcessoFormatado se por algum motivo vier ausente.
    const identificadorProcesso = dado.codigoProcesso ?? dado.numeroProcessoFormatado ?? "sem-id";
    const hashConteudo = sha256Hex(
      `sancao|${this.candidatoId}|TCU|${registro}|${identificadorProcesso}`
    );

    return {
      candidato_id: this.candidatoId,
      tipo: "sancao",
      categoria: "controversia",
      // NUNCA 'processo': acórdão do TCU é achado de tribunal de contas, não
      // processo da Justiça comum/eleitoral/criminal — ver docstring da classe.
      estagio_juridico: null,
      tema: [], // classificação temática por LLM fica para a Fase 2 (seção 6 do documento)
      titulo,
      resumo,
      data_evento: dataEvento,
      fonte_nome:
        registro === "CONTAS_IRREGULARES"
          ? "Tribunal de Contas da União — Contas Julgadas Irregulares"
          : "Tribunal de Contas da União — Inabilitados para Função Pública",
      fonte_url: fonteUrl,
      fonte_confianca: 1, // 1 = oficial
      hash_conteudo: hashConteudo,
      // revisado_humano não é setado aqui: a coluna já tem DEFAULT false no
      // banco, e todo evento categoria='controversia' PRECISA nascer assim —
      // a policy de RLS de leitura pública só libera 'controversia' quando
      // revisado_humano=true (ver db/migrations/0001_core_schema.sql). Setar
      // explicitamente aqui só duplicaria a regra sem alterar o comportamento.
    };
  }
}

/**
 * As datas dos dois cadastros do TCU foram observadas SEMPRE no formato
 * "DD/MM/AAAA" em requisições reais (ver README). Ainda assim, qualquer
 * formato não reconhecido retorna `null` — o chamador pula o registro em vez
 * de gravar uma data adivinhada.
 */
function parseDataBrasileira(valor: string | undefined | null): string | null {
  if (!valor) return null;
  const v = valor.trim();
  const match = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, dd, mm, yyyy] = match;
  return `${yyyy}-${mm}-${dd}`;
}

function onlyDigits(valor: string): string {
  return valor.replace(/\D/g, "");
}

function montarTitulo(registro: RegistroTcuBruto["registro"], dado: ResponsavelSancaoTcuDTO): string {
  const processo = dado.numeroProcessoFormatado ?? "processo não identificado";
  if (registro === "CONTAS_IRREGULARES") {
    return `Contas julgadas irregulares pelo TCU — Processo ${processo}`;
  }
  return `Inabilitado pelo TCU para exercício de função pública — Processo ${processo}`;
}

/** Resumo PRÓPRIO (nunca cópia de texto de imprensa — seção 4 do documento),
 * composto a partir de campos estruturados da resposta oficial da API. */
function montarResumo(registro: RegistroTcuBruto["registro"], dado: ResponsavelSancaoTcuDTO): string {
  const partes: string[] = [];

  partes.push(
    registro === "CONTAS_IRREGULARES"
      ? "Responsável com contas julgadas irregulares pelo Tribunal de Contas da União"
      : "Responsável inabilitado pelo Tribunal de Contas da União para o exercício de função pública"
  );

  if (dado.numeroAcordaoFormatado) partes.push(`Acórdão ${dado.numeroAcordaoFormatado}`);
  if (dado.dataAcordao) partes.push(`julgado em ${dado.dataAcordao}`);
  if (dado.dataTransitoEmJulgado) partes.push(`com trânsito em julgado em ${dado.dataTransitoEmJulgado}`);
  if (dado.dataFinalSancao) partes.push(`inabilitação vigente até ${dado.dataFinalSancao}`);
  if (dado.municipio || dado.uf) {
    partes.push(`vinculado a ${[dado.municipio, dado.uf].filter(Boolean).join("/")}`);
  }
  if (dado.linkAcompanhamentoProcesso) {
    partes.push(`acompanhamento processual: ${dado.linkAcompanhamentoProcesso}`);
  }

  // Capitaliza a primeira letra de cada fragmento antes de juntar com ". " —
  // os fragmentos acima são escritos em minúsculo para compor bem no meio de
  // uma frase, mas cada um também é o início de uma nova sentença aqui.
  const frases = partes.map((p) => p.charAt(0).toUpperCase() + p.slice(1));
  return `${frases.join(". ")}.`;
}
