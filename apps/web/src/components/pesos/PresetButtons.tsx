import { PRESETS, PESO_NEUTRO } from "../../data/dimensoes";
import type { Dimensao } from "../../lib/types";

export function PresetButtons({
  dimensoes,
  presetAtivo,
  onAplicar,
  onResetar,
}: {
  dimensoes: Dimensao[];
  presetAtivo: string | null;
  onAplicar: (id: string, pesos: Record<string, number>) => void;
  onResetar: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {PRESETS.map((preset) => {
        // Presets só definem peso explícito para algumas dimensões; o
        // resto recebe peso neutro para nunca zerar dimensões "de fora".
        const pesosCompletos: Record<string, number> = {};
        for (const d of dimensoes) pesosCompletos[d.chave] = preset.pesos[d.chave] ?? PESO_NEUTRO;

        return (
          <button
            key={preset.id}
            onClick={() => onAplicar(preset.id, pesosCompletos)}
            title={preset.descricao}
            className={`rounded-full px-4 py-2 text-xs font-medium border transition-colors ${
              presetAtivo === preset.id
                ? "border-ochre bg-ochre/10 text-ochre-bright"
                : "border-border text-ink-dim hover:border-border-soft hover:bg-surface-2"
            }`}
          >
            {preset.nome}
          </button>
        );
      })}
      <button
        onClick={onResetar}
        className="rounded-full px-4 py-2 text-xs font-medium border border-border text-muted hover:text-ink hover:border-border-soft transition-colors"
      >
        Redefinir (peso igual)
      </button>
    </div>
  );
}
