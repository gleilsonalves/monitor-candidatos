import { NavLink } from "react-router-dom";

export function Header() {
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `text-sm font-medium whitespace-nowrap transition-colors ${isActive ? "text-ochre-bright" : "text-ink-dim hover:text-ink"}`;

  return (
    <header className="no-print sticky top-0 z-30 border-b border-border-soft bg-bg/85 backdrop-blur-md">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 flex items-center justify-between h-16">
        <NavLink to="/" className="flex items-center gap-2.5 group">
          <span
            className="h-8 w-8 rounded-full border-2 border-ochre flex items-center justify-center font-display text-sm text-ochre-bright -rotate-6 group-hover:rotate-0 transition-transform"
            aria-hidden
          >
            M
          </span>
          <span className="font-display text-lg text-ink tracking-tight">
            Monitor <span className="text-muted">de Candidatos</span>
          </span>
        </NavLink>

        <nav className="flex items-center gap-6">
          <NavLink to="/" end className={linkClass}>
            Candidatos
          </NavLink>
          <NavLink to="/comparar" className={linkClass}>
            Comparar
          </NavLink>
          <NavLink to="/pesos" className={linkClass}>
            Painel de pesos
          </NavLink>
          <NavLink to="/metodologia" className={linkClass}>
            Metodologia
          </NavLink>
        </nav>
      </div>
    </header>
  );
}
