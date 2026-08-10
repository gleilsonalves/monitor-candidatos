import { useMemo, useState } from "react";
import type { Candidato } from "../../lib/types";
import { AvatarPlaceholder } from "../ui/AvatarPlaceholder";

export function SeletorCandidatos({
  candidatos,
  selecionados,
  onAdicionar,
  onRemover,
  max,
}: {
  candidatos: Candidato[];
  selecionados: Candidato[];
  onAdicionar: (id: string) => void;
  onRemover: (id: string) => void;
  max: number;
}) {
  const [busca, setBusca] = useState("");
  const idsSelecionados = useMemo(() => new Set(selecionados.map((c) => c.id)), [selecionados]);
  const cheio = selecionados.length >= max;

  const resultados = useMemo(() => {
    if (!busca.trim()) return [];
    const termo = busca.trim().toLowerCase();
    return candidatos
      .filter((c) => !idsSelecionados.has(c.id))
      .filter((c) => c.nome_urna.toLowerCase().includes(termo) || c.nome_civil?.toLowerCase().includes(termo))
      .slice(0, 8);
  }, [busca, candidatos, idsSelecionados]);

  return (
    <div className="space-y-3 no-print">
      <div className="flex flex-wrap gap-2">
        {selecionados.map((c) => (
          <span
            key={c.id}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-2 pl-1.5 pr-3 py-1"
          >
            <AvatarPlaceholder nome={c.nome_urna} fotoUrl={c.foto_url} size="sm" />
            <span className="text-xs text-ink-dim">{c.nome_urna}</span>
            <button
              type="button"
              onClick={() => onRemover(c.id)}
              aria-label={`Remover ${c.nome_urna} da comparação`}
              className="text-muted-2 hover:text-ochre-bright transition-colors"
            >
              ✕
            </button>
          </span>
        ))}
        {selecionados.length === 0 && <p className="text-xs text-muted py-1.5">Nenhum candidato selecionado ainda.</p>}
      </div>

      {cheio ? (
        <p className="text-xs text-muted-2 font-mono">Limite de {max} candidatos por comparação.</p>
      ) : (
        <div className="relative max-w-sm">
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder={`Adicionar candidato (${selecionados.length}/${max})…`}
            className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-ink placeholder:text-muted-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ochre"
          />
          {resultados.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-surface-2 shadow-xl overflow-hidden">
              {resultados.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onAdicionar(c.id);
                      setBusca("");
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-ink-dim hover:bg-surface-3 hover:text-ink transition-colors"
                  >
                    <AvatarPlaceholder nome={c.nome_urna} fotoUrl={c.foto_url} size="sm" />
                    <span className="truncate">{c.nome_urna}</span>
                    <span className="text-[11px] text-muted-2 font-mono ml-auto shrink-0">
                      {[c.partido_atual, c.uf].filter(Boolean).join(" · ") || "—"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
