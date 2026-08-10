import { Drawer } from "../ui/Drawer";
import { EventoCard } from "../perfil/EventoCard";
import { EventoCardSkeleton } from "../ui/Skeleton";
import { EmptyState, ErroApiState } from "../ui/EmptyState";
import { useApi } from "../../hooks/useApi";
import { api } from "../../lib/api";
import { normalizarEventos } from "../../lib/eventos";
import { tiposDaDimensao } from "../../data/dimensoes";
import type { Dimensao } from "../../lib/types";

// O componente que torna o score auditável de ponta a ponta: clicar no
// número de uma dimensão abre exatamente os eventos que a compõem, cada um
// com link de fonte. "Se o usuário não pode auditar o número, o número não
// deveria estar lá."
export function DimensionAuditDrawer({
  aberto,
  onFechar,
  dimensao,
  candidatoId,
  candidatoNome,
  valorNormalizado,
}: {
  aberto: boolean;
  onFechar: () => void;
  dimensao: Dimensao | null;
  candidatoId: string | null;
  candidatoNome?: string;
  valorNormalizado: number | null;
}) {
  const { data, loading, error, offline } = useApi(
    () => (candidatoId ? api.listarEventos(candidatoId) : Promise.resolve({ ok: true as const, data: [] })),
    [candidatoId, aberto]
  );

  const todosEventos = normalizarEventos(data as never);
  const tiposRelevantes = dimensao ? tiposDaDimensao(dimensao.chave) : [];
  const eventosRelacionados = tiposRelevantes.length
    ? todosEventos.filter((e) => tiposRelevantes.includes(e.tipo))
    : [];

  return (
    <Drawer
      aberto={aberto}
      onFechar={onFechar}
      titulo={dimensao?.nome ?? ""}
      subtitulo={candidatoNome ? `${candidatoNome} · valor normalizado ${valorNormalizado ?? "—"}/100` : undefined}
    >
      {dimensao && (
        <div className="mb-4 rounded-lg border border-border-soft bg-surface-2 p-3">
          <p className="text-xs text-ink-dim leading-relaxed">{dimensao.descricao}</p>
          <p className="text-[11px] text-muted-2 font-mono mt-2">Fonte da dimensão: {dimensao.fonte}</p>
        </div>
      )}

      {loading && (
        <div className="space-y-3">
          <EventoCardSkeleton />
          <EventoCardSkeleton />
        </div>
      )}

      {!loading && error && <ErroApiState mensagem={error} offline={offline} />}

      {!loading && !error && eventosRelacionados.length === 0 && (
        <EmptyState
          icone="🔎"
          titulo="Nenhum evento individual disponível ainda"
          descricao={
            dimensao
              ? `Esta dimensão ainda não tem eventos publicados que a compõem diretamente. O valor mostrado vem de ${dimensao.fonte}. Assim que os coletores publicarem eventos deste tipo, eles aparecem aqui, cada um com fonte linkada.`
              : "Selecione um candidato para ver os eventos que compõem esta dimensão."
          }
        />
      )}

      {!loading && !error && eventosRelacionados.length > 0 && (
        <div className="space-y-3">
          {eventosRelacionados.map((ev, i) => (
            <EventoCard key={ev.id} evento={ev} index={i} />
          ))}
        </div>
      )}
    </Drawer>
  );
}
