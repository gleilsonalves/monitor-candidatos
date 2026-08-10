import { dimensaoIcone } from "../../data/dimensoes";
import type { Dimensao } from "../../lib/types";

// Uma linha de dimensão no grid de comparação: rótulo + um valor clicável
// por candidato. Destaque é só visual (cor/peso da fonte) sobre o próprio
// número — nunca um rótulo textual tipo "melhor"/"pior" (regra do
// comparador: sem julgamento textual).
export function LinhaDimensaoComparador({
  dimensao,
  colunas,
  onAuditar,
}: {
  dimensao: Dimensao;
  colunas: { id: string; valor: number | null }[];
  onAuditar: (candidatoId: string) => void;
}) {
  const valoresValidos = colunas.map((c) => c.valor).filter((v): v is number => v !== null);
  const max = valoresValidos.length > 1 ? Math.max(...valoresValidos) : null;
  const min = valoresValidos.length > 1 ? Math.min(...valoresValidos) : null;
  const destacar = max !== null && min !== null && max !== min;

  return (
    <>
      <div className="flex items-center gap-2 py-3 px-3 border-t border-border-soft text-sm text-ink-dim bg-surface sticky left-0">
        <span aria-hidden>{dimensaoIcone(dimensao.chave)}</span>
        <span className="truncate">{dimensao.nome}</span>
      </div>
      {colunas.map((col) => {
        const ehMax = destacar && col.valor === max;
        const ehMin = destacar && col.valor === min;
        return (
          <div key={col.id} className="py-3 px-3 border-t border-l border-border-soft flex items-center justify-center">
            <button
              type="button"
              onClick={() => onAuditar(col.id)}
              title="Ver eventos que compõem este número"
              className={`font-mono text-sm tabular-nums underline decoration-dotted underline-offset-4 transition-colors ${
                col.valor === null
                  ? "text-muted-2"
                  : ehMax
                  ? "text-ochre-bright font-semibold"
                  : ehMin
                  ? "text-muted"
                  : "text-ink-dim hover:text-ink"
              }`}
            >
              {col.valor === null ? "sem dado" : Math.round(col.valor)}
            </button>
          </div>
        );
      })}
    </>
  );
}
