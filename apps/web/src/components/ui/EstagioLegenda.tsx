import { ESTAGIOS_ORDENADOS } from "../../data/estagioJuridico";

// Régua explicativa da escala de estágio jurídico — usada no perfil do
// candidato para que a UI "grite" a diferença entre acusação e condenação
// definitiva antes mesmo de o usuário ver um selo isolado.
export function EstagioLegenda() {
  return (
    <details className="group rounded-lg border border-border bg-surface-2 p-4">
      <summary className="cursor-pointer list-none flex items-center justify-between gap-3 text-sm font-medium text-ink-dim">
        <span>Como ler os estágios de um processo judicial</span>
        <span className="text-muted font-mono text-xs group-open:rotate-180 transition-transform">⌄</span>
      </summary>
      <div className="mt-4 space-y-3">
        <p className="text-xs text-muted leading-relaxed">
          Nunca colapsamos esses estágios em um rótulo genérico. Réu não é condenado; condenado em 1ª instância não é
          condenado em definitivo. Cada evento mostra exatamente onde está no processo:
        </p>
        <ol className="space-y-2">
          {ESTAGIOS_ORDENADOS.map((e) => (
            <li key={e.chave} className="flex items-start gap-3 text-xs">
              <span
                className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full border"
                style={{ background: e.cor, borderColor: e.cor }}
                aria-hidden
              />
              <div>
                <span className="font-mono uppercase tracking-wide text-ink" style={{ color: e.cor }}>
                  {e.rotulo}
                </span>
                <p className="text-muted mt-0.5">{e.explicacao}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </details>
  );
}
