import { useState } from "react";
import { useWeights } from "../../context/WeightsContext";

// "Compartilhamento de configuração via URL" (seção 8, Fase 4). Gera um
// link com os pesos atuais na query string; quem abre esse link aplica os
// mesmos pesos automaticamente (ver WeightsContext).
export function CopiarLinkPesos({ className = "" }: { className?: string }) {
  const { gerarLink } = useWeights();
  const [status, setStatus] = useState<"idle" | "copiado" | "manual">("idle");

  async function copiar() {
    const link = gerarLink();
    try {
      await navigator.clipboard.writeText(link);
      setStatus("copiado");
    } catch {
      // clipboard indisponível (contexto não-seguro, permissão negada etc.)
      // — nunca falha silenciosamente, mostra o link pra copiar à mão.
      window.prompt("Copie o link com seus pesos atuais:", link);
      setStatus("manual");
    }
    setTimeout(() => setStatus("idle"), 2200);
  }

  return (
    <button
      type="button"
      onClick={copiar}
      title="Gera uma URL com seus pesos atuais — quem abrir aplica os mesmos pesos automaticamente"
      className={`rounded-full px-4 py-2 text-xs font-medium border border-border-soft text-ink-dim hover:border-seal hover:text-seal-bright transition-colors inline-flex items-center gap-1.5 ${className}`}
    >
      <span aria-hidden>🔗</span>
      {status === "copiado" ? "Link copiado!" : status === "manual" ? "Copie o link acima" : "Copiar link com meus pesos"}
    </button>
  );
}
