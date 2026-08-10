import type { Dimensao } from "../../lib/types";
import { dimensaoIcone } from "../../data/dimensoes";

export function WeightSlider({
  dimensao,
  peso,
  onChange,
  onAuditar,
}: {
  dimensao: Dimensao;
  peso: number;
  onChange: (valor: number) => void;
  onAuditar: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-surface px-3 py-4 w-[6.5rem] shrink-0">
      <span className="text-lg" aria-hidden>
        {dimensaoIcone(dimensao.chave)}
      </span>

      <div className="h-32 flex items-center justify-center">
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={peso}
          onChange={(e) => onChange(Number(e.target.value))}
          className="fader-track"
          style={{ ["--fader-fill" as string]: peso }}
          aria-label={`Peso de ${dimensao.nome}`}
          aria-valuetext={`${peso} de 100`}
        />
      </div>

      <button
        type="button"
        onClick={onAuditar}
        className="font-mono text-sm text-ochre-bright hover:text-ochre-bright/80 tabular-nums"
        title="Ver eventos que compõem esta dimensão"
      >
        {peso}
      </button>

      <button
        type="button"
        onClick={onAuditar}
        className="text-[11px] text-center text-ink-dim hover:text-ink leading-tight underline decoration-dotted decoration-muted-2 underline-offset-4"
        title={dimensao.descricao}
      >
        {dimensao.nome}
      </button>
    </div>
  );
}
