import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import type { Candidato } from "../../lib/types";
import { AvatarPlaceholder } from "../ui/AvatarPlaceholder";

export function CandidatoCard({ candidato, index = 0 }: { candidato: Candidato; index?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index * 0.04, 0.4) }}
      whileHover={{ y: -3 }}
    >
      <Link
        to={`/candidatos/${candidato.id}`}
        className="group relative flex items-center gap-4 rounded-xl border border-border bg-surface p-5 overflow-hidden transition-colors hover:border-ochre/60 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ochre"
      >
        <span
          className="absolute inset-x-0 top-0 h-0.5 origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300"
          style={{ background: "linear-gradient(90deg, var(--color-seal), var(--color-ochre))" }}
          aria-hidden
        />
        <AvatarPlaceholder nome={candidato.nome_urna} fotoUrl={candidato.foto_url} size="md" />
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-2 mb-0.5">
            {candidato.cargo_pretendido ?? "candidato"}
          </p>
          <h3 className="font-display text-lg text-ink truncate group-hover:text-ochre-bright transition-colors">
            {candidato.nome_urna}
          </h3>
          <p className="text-xs text-muted mt-1 truncate">
            {[candidato.partido_atual, candidato.uf].filter(Boolean).join(" · ") || "Partido e UF não informados"}
          </p>
        </div>
        <span className="text-muted-2 group-hover:text-ochre-bright group-hover:translate-x-0.5 transition-all shrink-0" aria-hidden>
          →
        </span>
      </Link>
    </motion.div>
  );
}
