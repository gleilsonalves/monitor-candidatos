// Cálculo do score final — roda inteiramente no cliente (seção 6 do
// documento). O backend só entrega métricas normalizadas 0-100; o peso é
// do usuário, e é ele quem decide o que importa.
//
//   score_final = Σ(metrica_normalizada[i] × peso_usuario[i]) / Σ peso_usuario[i]
//
// Escala de peso escolhida: 0–100 (mesma escala das métricas, mais legível
// numa UI de faders do que 0–1). Documentado também no README.

import type { Metrica } from "./types";

export interface ScoreBreakdownItem {
  chave: string;
  valor: number | null; // métrica normalizada 0-100, ou null se não houver dado
  peso: number; // 0-100
  contribuicao: number | null; // valor * peso, antes de dividir pelo total
}

export interface ScoreResult {
  score: number | null; // null = sem métricas suficientes para calcular
  somaPesos: number;
  itens: ScoreBreakdownItem[];
}

export function calcularScore(
  metricas: Pick<Metrica, "chave" | "valor">[],
  pesos: Record<string, number>
): ScoreResult {
  const metricaPorChave = new Map(metricas.map((m) => [m.chave, m.valor]));
  const chaves = Object.keys(pesos);

  let somaPonderada = 0;
  let somaPesos = 0;
  const itens: ScoreBreakdownItem[] = [];

  for (const chave of chaves) {
    const peso = pesos[chave] ?? 0;
    const valor = metricaPorChave.has(chave) ? metricaPorChave.get(chave)! : null;

    if (valor !== null && peso > 0) {
      somaPonderada += valor * peso;
      somaPesos += peso;
    }

    itens.push({
      chave,
      valor,
      peso,
      contribuicao: valor !== null ? valor * peso : null,
    });
  }

  return {
    score: somaPesos > 0 ? somaPonderada / somaPesos : null,
    somaPesos,
    itens,
  };
}
