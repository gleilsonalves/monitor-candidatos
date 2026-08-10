import { CATEGORIA_META } from "../../data/eventoMeta";
import type { CategoriaEvento } from "../../lib/types";

export function CategoriaBadge({ categoria }: { categoria: CategoriaEvento | null }) {
  if (!categoria) return null;
  const meta = CATEGORIA_META[categoria];
  if (!meta) return null;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium border"
      style={{ color: meta.cor, borderColor: `color-mix(in srgb, ${meta.cor} 55%, transparent)` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.cor }} aria-hidden />
      {meta.rotulo}
    </span>
  );
}
