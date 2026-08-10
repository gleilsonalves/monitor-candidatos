import type { Evento } from "../../lib/types";
import { EventoCard } from "./EventoCard";
import { EventoCardSkeleton } from "../ui/Skeleton";
import { EmptyState, ErroApiState } from "../ui/EmptyState";

export function Timeline({
  eventos,
  loading,
  error,
  offline,
}: {
  eventos: Evento[] | null;
  loading: boolean;
  error: string | null;
  offline: boolean;
}) {
  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <EventoCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (error) {
    return <ErroApiState mensagem={error} offline={offline} />;
  }

  if (!eventos || eventos.length === 0) {
    return (
      <EmptyState
        icone="🗞️"
        titulo="Nenhum evento registrado ainda"
        descricao="Assim que os coletores processarem fatos sobre este candidato — proposições, votos, processos, despesas — eles aparecem aqui com fonte linkada."
      />
    );
  }

  // Ordem cronológica decrescente (mais recente primeiro) com uma espinha
  // vertical, como um dossiê / processo — reforça a leitura factual.
  const ordenados = [...eventos].sort(
    (a, b) => new Date(b.data_evento).getTime() - new Date(a.data_evento).getTime()
  );

  return (
    <div className="relative pl-4 sm:pl-6 space-y-4 before:content-[''] before:absolute before:left-[3px] sm:before:left-[7px] before:top-2 before:bottom-2 before:w-px before:bg-border">
      {ordenados.map((evento, i) => (
        <div key={evento.id} className="relative">
          <span
            className="absolute -left-4 sm:-left-6 top-5 h-1.5 w-1.5 rounded-full bg-ochre"
            aria-hidden
          />
          <EventoCard evento={evento} index={i} />
        </div>
      ))}
    </div>
  );
}
