import { TIPO_EVENTO_META } from "../../data/eventoMeta";
import type { TipoEvento } from "../../lib/types";

export interface FiltrosTimeline {
  tipo: TipoEvento | "";
  categoria: string;
  tema: string;
}

export function TimelineFilters({
  filtros,
  onChange,
  temasDisponiveis,
}: {
  filtros: FiltrosTimeline;
  onChange: (f: FiltrosTimeline) => void;
  temasDisponiveis: string[];
}) {
  const tipos = Object.keys(TIPO_EVENTO_META) as TipoEvento[];

  return (
    <div className="flex flex-wrap gap-2 items-center">
      <select
        value={filtros.tipo}
        onChange={(e) => onChange({ ...filtros, tipo: e.target.value as TipoEvento | "" })}
        className="bg-surface border border-border rounded-md px-2.5 py-1.5 text-xs text-ink-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ochre"
      >
        <option value="">Todos os tipos</option>
        {tipos.map((t) => (
          <option key={t} value={t}>
            {TIPO_EVENTO_META[t].rotulo}
          </option>
        ))}
      </select>

      <select
        value={filtros.categoria}
        onChange={(e) => onChange({ ...filtros, categoria: e.target.value })}
        className="bg-surface border border-border rounded-md px-2.5 py-1.5 text-xs text-ink-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ochre"
      >
        <option value="">Todas as categorias</option>
        <option value="realizacao">Realização</option>
        <option value="controversia">Controvérsia</option>
        <option value="neutro">Neutro</option>
      </select>

      {temasDisponiveis.length > 0 && (
        <select
          value={filtros.tema}
          onChange={(e) => onChange({ ...filtros, tema: e.target.value })}
          className="bg-surface border border-border rounded-md px-2.5 py-1.5 text-xs text-ink-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ochre"
        >
          <option value="">Todos os temas</option>
          {temasDisponiveis.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      )}

      {(filtros.tipo || filtros.categoria || filtros.tema) && (
        <button
          onClick={() => onChange({ tipo: "", categoria: "", tema: "" })}
          className="text-xs text-muted hover:text-ochre-bright underline underline-offset-4"
        >
          Limpar filtros
        </button>
      )}
    </div>
  );
}
