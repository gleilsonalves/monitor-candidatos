import type { ScoreBreakdownItem } from "../../lib/score";
import type { Dimensao } from "../../lib/types";
import { dimensaoIcone } from "../../data/dimensoes";

export function ScoreBreakdownList({
  itens,
  dimensoesPorChave,
  onAuditar,
}: {
  itens: ScoreBreakdownItem[];
  dimensoesPorChave: Map<string, Dimensao>;
  onAuditar: (chave: string) => void;
}) {
  return (
    <ul className="divide-y divide-border-soft">
      {itens.map((item) => {
        const dim = dimensoesPorChave.get(item.chave);
        return (
          <li key={item.chave} className="flex items-center gap-3 py-2.5">
            <span className="text-sm" aria-hidden>
              {dimensaoIcone(item.chave)}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-ink-dim truncate">{dim?.nome ?? item.chave}</p>
              <p className="text-[11px] text-muted-2 font-mono">peso {item.peso}</p>
            </div>
            <button
              type="button"
              onClick={() => onAuditar(item.chave)}
              className="font-mono text-sm tabular-nums text-ochre-bright hover:underline underline-offset-4 decoration-dotted"
              title="Ver eventos que compõem este número"
            >
              {item.valor === null ? "sem dado" : Math.round(item.valor)}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
