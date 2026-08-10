// Metadados do componente não-negociável do produto (ver seção 1 e 9 do
// documento de arquitetura): todo evento de tipo 'processo' carrega um
// estagio_juridico que NUNCA pode ser colapsado em algo genérico tipo
// "problema legal". Réu != condenado != condenação com trânsito em julgado.
//
// A ordem abaixo é a ordem real do devido processo (acusação -> decisão
// definitiva), usada para renderizar a régua de estágios. "arquivado" e
// "absolvido" ficam fora da régua de severidade: não são "menos graves",
// são desfechos de natureza diferente (processo encerrado sem condenação).

import type { EstagioJuridico } from "../lib/types";

export interface EstagioMeta {
  chave: EstagioJuridico;
  rotulo: string;
  explicacao: string;
  cor: string; // var(--color-estagio-*)
  grupo: "acusacao" | "condenacao" | "desfecho-neutro";
  ordem: number;
}

export const ESTAGIO_JURIDICO: Record<EstagioJuridico, EstagioMeta> = {
  denuncia: {
    chave: "denuncia",
    rotulo: "Denúncia recebida",
    explicacao:
      "O Ministério Público (ou órgão competente) formalizou uma denúncia. Não há, até aqui, apuração concluída nem julgamento — é o estágio mais inicial da acusação.",
    cor: "var(--color-estagio-denuncia)",
    grupo: "acusacao",
    ordem: 1,
  },
  investigacao_aberta: {
    chave: "investigacao_aberta",
    rotulo: "Investigação em andamento",
    explicacao:
      "Há um inquérito ou apuração formal em curso. Ainda não houve ação penal recebida nem julgamento de mérito.",
    cor: "var(--color-estagio-investigacao)",
    grupo: "acusacao",
    ordem: 2,
  },
  acao_recebida: {
    chave: "acao_recebida",
    rotulo: "Ação penal recebida",
    explicacao:
      "A Justiça aceitou a ação penal e o processo segue seu curso. O candidato é réu — réu não é condenado.",
    cor: "var(--color-estagio-acao)",
    grupo: "acusacao",
    ordem: 3,
  },
  condenacao_1a_instancia: {
    chave: "condenacao_1a_instancia",
    rotulo: "Condenação em 1ª instância",
    explicacao:
      "Houve condenação em primeira instância, mas a decisão ainda não é definitiva — cabe recurso e o entendimento pode mudar.",
    cor: "var(--color-estagio-cond1)",
    grupo: "condenacao",
    ordem: 4,
  },
  condenacao_colegiado: {
    chave: "condenacao_colegiado",
    rotulo: "Condenação em colegiado (2ª instância)",
    explicacao:
      "Um órgão colegiado manteve ou proferiu a condenação. Ainda cabem recursos às instâncias superiores — não é decisão definitiva.",
    cor: "var(--color-estagio-cond2)",
    grupo: "condenacao",
    ordem: 5,
  },
  transito_julgado: {
    chave: "transito_julgado",
    rotulo: "Condenação com trânsito em julgado",
    explicacao:
      "Decisão definitiva: não cabem mais recursos. Este é o único estágio que representa uma condenação encerrada e irrecorrível.",
    cor: "var(--color-estagio-transito)",
    grupo: "condenacao",
    ordem: 6,
  },
  arquivado: {
    chave: "arquivado",
    rotulo: "Processo arquivado",
    explicacao:
      "O processo foi encerrado sem condenação (por exemplo, por falta de provas ou prescrição). Não é absolvição de mérito, mas também não é condenação.",
    cor: "var(--color-estagio-arquivado)",
    grupo: "desfecho-neutro",
    ordem: 7,
  },
  absolvido: {
    chave: "absolvido",
    rotulo: "Absolvido",
    explicacao: "A Justiça julgou o mérito e absolveu o candidato.",
    cor: "var(--color-estagio-absolvido)",
    grupo: "desfecho-neutro",
    ordem: 8,
  },
};

export const ESTAGIOS_ORDENADOS = Object.values(ESTAGIO_JURIDICO).sort((a, b) => a.ordem - b.ordem);
