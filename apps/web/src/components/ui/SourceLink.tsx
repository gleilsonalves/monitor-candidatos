import { FONTE_CONFIANCA_META } from "../../data/eventoMeta";

// "Se o usuário não pode auditar o número, o número não deveria estar lá."
// Todo fato no app tem fonte_url clicável — este é o componente que garante isso.
export function SourceLink({
  url,
  nome,
  confianca,
}: {
  url: string;
  nome: string;
  confianca?: 1 | 2 | 3 | null;
}) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-xs font-mono text-seal-bright hover:text-ochre-bright underline decoration-dotted underline-offset-4 transition-colors"
    >
      <span aria-hidden>↗</span>
      <span className="truncate max-w-[16rem]">{nome}</span>
      {confianca && (
        <span className="text-muted-2 normal-case font-body">· {FONTE_CONFIANCA_META[confianca]}</span>
      )}
    </a>
  );
}
