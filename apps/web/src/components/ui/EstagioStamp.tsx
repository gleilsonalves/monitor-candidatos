import { useState } from "react";
import { ESTAGIO_JURIDICO } from "../../data/estagioJuridico";
import type { EstagioJuridico } from "../../lib/types";

// Componente NÃO-NEGOCIÁVEL do produto: todo evento tipo=processo precisa
// deixar claríssimo em qual estágio do devido processo ele está. Nunca um
// selo binário "culpado/inocente" — sempre o rótulo específico e uma
// explicação de uma frase, estilizados como um carimbo oficial (o motivo:
// isso É literalmente um registro processual).
export function EstagioStamp({ estagio, tamanho = "md" }: { estagio: EstagioJuridico; tamanho?: "sm" | "md" }) {
  const [aberto, setAberto] = useState(false);
  const meta = ESTAGIO_JURIDICO[estagio];

  if (!meta) {
    // Nunca deve acontecer (estagio_juridico é obrigatório e tipado), mas
    // se um valor desconhecido chegar da API, avisamos em vez de esconder.
    return (
      <span className="font-mono text-xs uppercase tracking-wide text-estagio-cond1 border border-estagio-cond1 rounded px-2 py-1">
        estágio desconhecido: {String(estagio)}
      </span>
    );
  }

  const padding = tamanho === "sm" ? "px-2 py-1 text-[10px]" : "px-3 py-1.5 text-xs";

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        onBlur={() => setAberto(false)}
        className={`group inline-flex items-center gap-1.5 rounded-sm border-2 font-mono font-semibold uppercase tracking-wider ${padding} -rotate-1 transition-transform hover:rotate-0 focus-visible:rotate-0 outline-none`}
        style={{
          borderColor: meta.cor,
          color: meta.cor,
          background: "color-mix(in srgb, var(--color-bg) 88%, transparent)",
          boxShadow: "var(--shadow-stamp)",
        }}
        aria-expanded={aberto}
        aria-describedby={`estagio-explicacao-${estagio}`}
        title={meta.explicacao}
      >
        <span aria-hidden>⚖</span>
        {meta.rotulo}
      </button>

      {aberto && (
        <div
          id={`estagio-explicacao-${estagio}`}
          role="tooltip"
          className="absolute z-20 top-full mt-2 w-64 rounded-md border border-border bg-surface-2 p-3 text-xs leading-relaxed text-ink-dim shadow-xl"
        >
          <p className="font-semibold text-ink mb-1 font-body normal-case tracking-normal">{meta.rotulo}</p>
          {meta.explicacao}
        </div>
      )}
    </div>
  );
}
