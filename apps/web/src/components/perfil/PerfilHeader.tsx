import { motion } from "framer-motion";
import type { CandidatoDetalhe } from "../../lib/types";
import { AvatarPlaceholder } from "../ui/AvatarPlaceholder";

const PLATAFORMA_ICONE: Record<string, string> = {
  youtube: "▶",
  bluesky: "🦋",
  instagram: "◈",
  x: "𝕏",
};

export function PerfilHeader({ candidato }: { candidato: CandidatoDetalhe }) {
  return (
    <motion.header
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="relative overflow-hidden rounded-2xl border border-border bg-surface"
    >
      <div className="paper-grain absolute inset-0 opacity-40" aria-hidden />
      <div
        className="absolute inset-x-0 top-0 h-1"
        style={{ background: "linear-gradient(90deg, var(--color-seal), var(--color-ochre))" }}
        aria-hidden
      />
      <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row gap-6 sm:items-center">
        <AvatarPlaceholder nome={candidato.nome_urna} fotoUrl={candidato.foto_url} size="lg" />

        <div className="flex-1 min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ochre-bright mb-1.5">
            {candidato.cargo_pretendido ?? "Candidato"}
          </p>
          <h1 className="font-display text-3xl sm:text-4xl text-ink leading-tight break-words">
            {candidato.nome_urna}
          </h1>
          {candidato.nome_civil && candidato.nome_civil !== candidato.nome_urna && (
            <p className="text-sm text-muted mt-1">{candidato.nome_civil}</p>
          )}

          <div className="flex flex-wrap items-center gap-2 mt-4">
            {candidato.partido_atual && (
              <span className="rounded-full border border-border-soft bg-surface-2 px-3 py-1 text-xs font-mono text-ink-dim">
                {candidato.partido_atual}
              </span>
            )}
            {candidato.uf && (
              <span className="rounded-full border border-border-soft bg-surface-2 px-3 py-1 text-xs font-mono text-ink-dim">
                {candidato.uf}
              </span>
            )}
            {candidato.perfis_sociais?.map((p) => (
              <a
                key={p.plataforma + p.handle}
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full border border-border-soft px-3 py-1 text-xs text-seal-bright hover:border-seal hover:bg-surface-2 transition-colors inline-flex items-center gap-1.5"
              >
                <span aria-hidden>{PLATAFORMA_ICONE[p.plataforma] ?? "🔗"}</span>@{p.handle}
                {p.verificado && <span title="Handle validado manualmente">✓</span>}
              </a>
            ))}
          </div>
        </div>
      </div>
    </motion.header>
  );
}
