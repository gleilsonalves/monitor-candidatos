import type { Dimensao } from "../../lib/types";
import { WeightSlider } from "./WeightSlider";
import { PresetButtons } from "./PresetButtons";
import { CopiarLinkPesos } from "./CopiarLinkPesos";
import { useWeights } from "../../context/WeightsContext";

export function WeightPanel({
  dimensoes,
  onAuditarDimensao,
}: {
  dimensoes: Dimensao[];
  onAuditarDimensao: (chave: string) => void;
}) {
  const { pesos, definirPeso, aplicarPreset, resetar, presetAtivo, setPresetAtivo, aplicadoDaUrl } = useWeights();

  return (
    <div className="space-y-5">
      {aplicadoDaUrl && (
        <div className="rounded-lg border border-seal/40 bg-seal/10 px-4 py-2.5 text-xs text-seal-bright">
          Pesos aplicados a partir de um link compartilhado. Continuam 100% editáveis abaixo.
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-xl text-ink">Seus pesos</h2>
          <p className="text-xs text-muted mt-0.5">Arraste. O score recalcula ao vivo — nada é salvo no servidor.</p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <PresetButtons
            dimensoes={dimensoes}
            presetAtivo={presetAtivo}
            onAplicar={(id, novosPesos) => {
              setPresetAtivo(id);
              aplicarPreset(novosPesos);
            }}
            onResetar={() => resetar(dimensoes)}
          />
          <CopiarLinkPesos />
        </div>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
        {dimensoes.map((d) => (
          <WeightSlider
            key={d.chave}
            dimensao={d}
            peso={pesos[d.chave] ?? 50}
            onChange={(valor) => definirPeso(d.chave, valor)}
            onAuditar={() => onAuditarDimensao(d.chave)}
          />
        ))}
      </div>
    </div>
  );
}
