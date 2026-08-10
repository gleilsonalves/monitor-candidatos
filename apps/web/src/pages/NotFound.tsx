import { Link } from "react-router-dom";

export function NotFound() {
  return (
    <div className="text-center py-24">
      <p className="font-mono text-ochre-bright text-sm mb-2">404</p>
      <h1 className="font-display text-3xl text-ink mb-3">Página não encontrada</h1>
      <p className="text-sm text-muted mb-6">O endereço não corresponde a nenhum registro conhecido.</p>
      <Link to="/" className="text-sm text-seal-bright hover:text-ochre-bright underline underline-offset-4">
        Voltar para a lista de candidatos
      </Link>
    </div>
  );
}
