import { motion } from "framer-motion";
import type { Evento } from "../../lib/types";
import { formatarData } from "../../lib/format";
import { TIPO_EVENTO_META } from "../../data/eventoMeta";
import { CategoriaBadge } from "../ui/CategoriaBadge";
import { EstagioStamp } from "../ui/EstagioStamp";
import { SourceLink } from "../ui/SourceLink";

export function EventoCard({ evento, index = 0 }: { evento: Evento; index?: number }) {
  const tipoMeta = TIPO_EVENTO_META[evento.tipo];

  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.35, delay: Math.min(index * 0.03, 0.3) }}
      className="rounded-lg border border-border bg-surface p-4 hover:border-border-soft hover:bg-surface-2 transition-colors"
    >
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="font-mono text-[11px] text-muted-2">{formatarData(evento.data_evento)}</span>
        <span className="text-muted-2" aria-hidden>
          ·
        </span>
        <span className="text-xs text-muted inline-flex items-center gap-1">
          <span aria-hidden>{tipoMeta?.icone}</span>
          {tipoMeta?.rotulo ?? evento.tipo}
        </span>
        <CategoriaBadge categoria={evento.categoria} />
      </div>

      <h3 className="font-display text-base text-ink leading-snug mb-1">{evento.titulo}</h3>

      {evento.resumo && <p className="text-sm text-ink-dim leading-relaxed mb-3">{evento.resumo}</p>}

      {evento.tipo === "processo" && evento.estagio_juridico && (
        <div className="mb-3">
          <EstagioStamp estagio={evento.estagio_juridico} tamanho="sm" />
        </div>
      )}

      {evento.tema && evento.tema.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {evento.tema.map((t) => (
            <span key={t} className="text-[10px] uppercase tracking-wide text-muted-2 border border-border-soft rounded px-1.5 py-0.5">
              {t}
            </span>
          ))}
        </div>
      )}

      <SourceLink url={evento.fonte_url} nome={evento.fonte_nome} confianca={evento.fonte_confianca} />
    </motion.article>
  );
}
