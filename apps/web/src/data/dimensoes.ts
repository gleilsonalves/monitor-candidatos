// As 9 dimensões vêm de /dimensoes (chave, nome, descricao, fonte). Este
// arquivo guarda apenas metadados de APRESENTAÇÃO que a API não expõe:
// ícone e o heurístico "que tipos de evento auditam essa dimensão".
//
// DECISÃO DE DESIGN (documentada no README): a API ainda não tem um filtro
// `/eventos?dimensao=`, então o drawer de auditoria filtra a timeline do
// candidato pelos `tipo` de evento mais associados a cada dimensão. Quando
// nenhum evento correspondente existe, mostramos a fonte declarada da
// dimensão em vez de fingir que há uma lista. Isso é uma ponte até o
// backend expor a relação de forma explícita — nunca escondemos a
// aproximação do usuário.

import type { TipoEvento } from "../lib/types";

export interface DimensaoMeta {
  icone: string;
  tiposRelacionados: TipoEvento[];
}

export const DIMENSAO_META: Record<string, DimensaoMeta> = {
  producao_legislativa: { icone: "📜", tiposRelacionados: ["proposicao"] },
  assiduidade: { icone: "🗳️", tiposRelacionados: ["voto"] },
  coerencia: { icone: "🔗", tiposRelacionados: ["voto", "post"] },
  transparencia: { icone: "🔍", tiposRelacionados: ["despesa", "nomeacao"] },
  integridade: { icone: "⚖️", tiposRelacionados: ["processo", "sancao"] },
  uso_recursos_publicos: { icone: "💰", tiposRelacionados: ["despesa"] },
  comunicacao: { icone: "💬", tiposRelacionados: ["post"] },
  investimento_propaganda: { icone: "📢", tiposRelacionados: ["anuncio"] },
  foco_tematico: { icone: "🧭", tiposRelacionados: ["proposicao", "post", "voto"] },
};

export function dimensaoIcone(chave: string): string {
  return DIMENSAO_META[chave]?.icone ?? "◆";
}

export function tiposDaDimensao(chave: string): TipoEvento[] {
  return DIMENSAO_META[chave]?.tiposRelacionados ?? [];
}

// Presets de peso (seção 6). Chaves fora do preset assumem peso neutro (50).
// Sempre editáveis depois de aplicados — nunca uma caixa-preta.
export interface PesoPreset {
  id: string;
  nome: string;
  descricao: string;
  pesos: Record<string, number>;
}

export const PRESETS: PesoPreset[] = [
  {
    id: "integridade",
    nome: "Foco em integridade",
    descricao: "Prioriza processos, sanções e transparência sobre produção ou comunicação.",
    pesos: {
      integridade: 100,
      transparencia: 90,
      uso_recursos_publicos: 70,
      producao_legislativa: 30,
      assiduidade: 30,
      coerencia: 40,
      comunicacao: 10,
      investimento_propaganda: 10,
      foco_tematico: 20,
    },
  },
  {
    id: "producao",
    nome: "Foco em produção legislativa",
    descricao: "Prioriza proposições, assiduidade e coerência entre discurso e voto.",
    pesos: {
      producao_legislativa: 100,
      assiduidade: 80,
      coerencia: 70,
      integridade: 40,
      transparencia: 30,
      uso_recursos_publicos: 20,
      comunicacao: 20,
      investimento_propaganda: 10,
      foco_tematico: 40,
    },
  },
  {
    id: "social",
    nome: "Foco em área social",
    descricao: "Prioriza foco temático em pautas sociais e coerência de atuação.",
    pesos: {
      foco_tematico: 100,
      coerencia: 70,
      comunicacao: 50,
      producao_legislativa: 50,
      assiduidade: 40,
      transparencia: 40,
      integridade: 40,
      uso_recursos_publicos: 20,
      investimento_propaganda: 10,
    },
  },
];

export const PESO_NEUTRO = 50;
