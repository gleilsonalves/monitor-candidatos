import { iniciais } from "../../lib/format";

// Placeholder neutro com iniciais/silhueta — usado até o pipeline de dados
// real popular `foto_url`. Nunca usar fotos de terceiros sem licença.
export function AvatarPlaceholder({
  nome,
  fotoUrl,
  size = "md",
}: {
  nome: string;
  fotoUrl?: string | null;
  size?: "sm" | "md" | "lg";
}) {
  const dims = { sm: "h-12 w-12 text-sm", md: "h-20 w-20 text-xl", lg: "h-32 w-32 text-3xl" }[size];

  if (fotoUrl) {
    return (
      <img
        src={fotoUrl}
        alt={`Foto de ${nome}`}
        className={`${dims} rounded-full object-cover border border-border shadow-[var(--shadow-stamp)]`}
      />
    );
  }

  return (
    <div
      className={`${dims} rounded-full border border-border flex items-center justify-center relative overflow-hidden shrink-0`}
      style={{
        background: "linear-gradient(160deg, var(--color-surface-3), var(--color-surface))",
      }}
      role="img"
      aria-label={`Foto de ${nome} ainda não disponível`}
      title="Foto ainda não coletada — placeholder neutro"
    >
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full opacity-[0.14]" aria-hidden>
        <circle cx="50" cy="38" r="20" fill="var(--color-ink)" />
        <path d="M12 96c4-26 24-40 38-40s34 14 38 40z" fill="var(--color-ink)" />
      </svg>
      <span className="font-display font-medium text-ink-dim relative">{iniciais(nome)}</span>
    </div>
  );
}
