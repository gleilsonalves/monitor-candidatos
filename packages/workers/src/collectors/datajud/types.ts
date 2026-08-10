/**
 * Tipos da API Pública do DataJud (CNJ) — confirmados contra a documentação
 * oficial (https://datajud-wiki.cnj.jus.br/api-publica/) e contra uma
 * requisição real feita em 2026-08-10 (ver README.md desta pasta para a
 * discussão completa, incluindo a citação literal do exemplo oficial usado
 * como base destes tipos).
 *
 * A API é um proxy de leitura sobre um cluster Elasticsearch (Elastic Cloud —
 * confirmado pelos headers `X-Found-Handling-Cluster` / `X-Found-Handling-Instance`
 * numa resposta 401 real). Cada tribunal tem seu próprio índice, acessado via
 * `POST https://api-publica.datajud.cnj.jus.br/api_publica_{alias}/_search`
 * com um corpo de "Query DSL" do Elasticsearch.
 *
 * ACHADO CRÍTICO (ver README, seção "Entity resolution"): o `_source` do
 * documento retornado **não tem nenhum campo de parte processual** — sem
 * nome, sem CPF, sem CNPJ, sem advogado. Confirmado por duas fontes
 * independentes e primárias:
 *   1. O Glossário de Dados oficial (`/api-publica/glossario/`) lista TODOS
 *      os atributos do índice e nenhum é de parte.
 *   2. O exemplo de resposta real publicado em `/api-publica/exemplos/exemplo1`
 *      (reproduzido abaixo em `DatajudDocumentoExemplo`) não tem esse campo.
 * Por isso este coletor NUNCA busca por CPF ou nome — é estruturalmente
 * impossível nesta API. A busca é só por `numeroProcesso` (ver client.ts).
 */

/** Corpo da requisição — Query DSL do Elasticsearch. Este coletor usa
 * sempre `match` sobre `numeroProcesso` (único campo de busca determinística
 * e sem ambiguidade possível: numeração única CNJ, Resolução 65/2008, 20
 * dígitos, 1 processo = 1 número). */
export interface DatajudQueryRequest {
  query: {
    match: {
      numeroProcesso: string;
    };
  };
}

export interface DatajudClasseProcessual {
  codigo: number;
  nome: string;
}

export interface DatajudAssunto {
  codigo: number;
  nome: string;
}

export interface DatajudOrgaoJulgador {
  codigo: number;
  nome: string;
  codigoMunicipioIBGE?: number;
}

export interface DatajudComplementoTabelado {
  codigo: number;
  valor?: number;
  nome?: string;
  descricao?: string;
}

/** Um movimento processual. `codigo` é o código da Tabela Processual
 * Unificada (TPU) de Movimentos — é isso que `mapaMovimentacao.ts` traduz
 * (de forma parcial e conservadora) para `estagio_juridico`. */
export interface DatajudMovimento {
  codigo: number;
  nome: string;
  dataHora: string; // ISO 8601
  complementosTabelados?: DatajudComplementoTabelado[];
  orgaoJulgador?: { codigoOrgao?: number; nomeOrgao?: string };
}

export interface DatajudFormato {
  codigo: number;
  nome: string;
}

export interface DatajudSistema {
  codigo: number;
  nome: string;
}

/** `_source` de um documento de processo — metadados processuais, sem
 * nenhum dado de parte (ver nota no topo do arquivo). Campos confirmados
 * contra o exemplo oficial e o glossário oficial. */
export interface DatajudProcesso {
  id?: string;
  numeroProcesso: string;
  tribunal: string;
  dataAjuizamento?: string;
  grau?: string;
  nivelSigilo?: number;
  formato?: DatajudFormato;
  sistema?: DatajudSistema;
  classe?: DatajudClasseProcessual;
  assuntos?: DatajudAssunto[];
  orgaoJulgador?: DatajudOrgaoJulgador;
  movimentos?: DatajudMovimento[];
  dataHoraUltimaAtualizacao?: string;
  "@timestamp"?: string;
}

export interface DatajudHit {
  _index: string;
  _id: string;
  _score: number;
  _source: DatajudProcesso;
}

export interface DatajudSearchResponse {
  took: number;
  timed_out: boolean;
  hits: {
    total: { value: number; relation: string };
    max_score: number | null;
    hits: DatajudHit[];
  };
}

/**
 * Corpo de erro real observado numa chamada sem header `Authorization`
 * (feita em 2026-08-10 contra `api_publica_tjsp`, ver README — "Validação
 * sem API key"): HTTP 401, `security_exception` do próprio Elasticsearch
 * (não um erro customizado do CNJ), com `WWW-Authenticate: ApiKey` no
 * header — confirma que o esquema de auth é literalmente o "ApiKey" nativo
 * do Elasticsearch, não um esquema proprietário do CNJ.
 */
export interface DatajudErro {
  error: {
    root_cause: Array<{ type: string; reason: string }>;
    type: string;
    reason: string;
  };
  status: number;
}

/**
 * Item bruto processado por este coletor: um PAR (numeroProcesso, tribunal)
 * já resolvido pelo operador + o processo encontrado (ou `null` se a busca
 * não retornou nada, ex: número inexistente ou digitado errado — nesse caso
 * normalize() pula sem gravar, nunca inventa um evento a partir de um
 * numeroProcesso vazio).
 */
export interface DatajudProcessoBruto {
  numeroProcessoConsultado: string;
  tribunalAlias: string;
  processo: DatajudProcesso | null;
}
