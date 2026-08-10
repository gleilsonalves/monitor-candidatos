import type { CategoriaEvento, TipoEvento } from "../lib/types";

export const CATEGORIA_META: Record<CategoriaEvento, { rotulo: string; cor: string }> = {
  realizacao: { rotulo: "Realização", cor: "var(--color-cat-realizacao)" },
  controversia: { rotulo: "Controvérsia", cor: "var(--color-cat-controversia)" },
  neutro: { rotulo: "Neutro", cor: "var(--color-cat-neutro)" },
};

export const TIPO_EVENTO_META: Record<TipoEvento, { rotulo: string; icone: string }> = {
  proposicao: { rotulo: "Proposição legislativa", icone: "📜" },
  voto: { rotulo: "Voto / presença", icone: "🗳️" },
  processo: { rotulo: "Processo judicial", icone: "⚖️" },
  sancao: { rotulo: "Sanção administrativa", icone: "🚫" },
  despesa: { rotulo: "Despesa / uso de verba", icone: "💰" },
  nomeacao: { rotulo: "Nomeação / ato oficial", icone: "🏛️" },
  post: { rotulo: "Publicação em rede social", icone: "💬" },
  anuncio: { rotulo: "Anúncio político", icone: "📢" },
};

export const FONTE_CONFIANCA_META: Record<number, string> = {
  1: "Fonte oficial",
  2: "Imprensa",
  3: "Rede social",
};
