import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PerfilHeader } from "../components/perfil/PerfilHeader";
import { Timeline } from "../components/perfil/Timeline";
import { TimelineFilters, type FiltrosTimeline } from "../components/perfil/TimelineFilters";
import { EstagioLegenda } from "../components/ui/EstagioLegenda";
import { ScoreGauge } from "../components/pesos/ScoreGauge";
import { ScoreBreakdownList } from "../components/pesos/ScoreBreakdownList";
import { DimensionAuditDrawer } from "../components/pesos/DimensionAuditDrawer";
import { ErroApiState, EmptyState } from "../components/ui/EmptyState";
import { Skeleton } from "../components/ui/Skeleton";
import { useApi } from "../hooks/useApi";
import { api } from "../lib/api";
import { normalizarEventos } from "../lib/eventos";
import { calcularScore } from "../lib/score";
import { baixarArquivoTexto, gerarMarkdownCandidato, nomeArquivoSeguro } from "../lib/relatorio";
import { useWeights } from "../context/WeightsContext";
import type { Dimensao } from "../lib/types";

export function CandidatoPerfil() {
  const { id } = useParams<{ id: string }>();
  const [filtros, setFiltros] = useState<FiltrosTimeline>({ tipo: "", categoria: "", tema: "" });
  const [dimensaoAuditada, setDimensaoAuditada] = useState<Dimensao | null>(null);

  const candidatoState = useApi(() => (id ? api.obterCandidato(id) : Promise.resolve({ ok: false as const, error: "sem id", offline: false })), [id]);
  const eventosState = useApi(() => (id ? api.listarEventos(id) : Promise.resolve({ ok: false as const, error: "sem id", offline: false })), [id]);
  const metricasState = useApi(() => (id ? api.listarMetricas(id) : Promise.resolve({ ok: false as const, error: "sem id", offline: false })), [id]);
  const dimensoesState = useApi(() => api.listarDimensoes(), []);

  const { pesos, garantirChaves } = useWeights();

  const todosEventos = normalizarEventos(eventosState.data as never);

  const eventosFiltrados = useMemo(() => {
    return todosEventos.filter((e) => {
      if (filtros.tipo && e.tipo !== filtros.tipo) return false;
      if (filtros.categoria && e.categoria !== filtros.categoria) return false;
      if (filtros.tema && !(e.tema ?? []).includes(filtros.tema)) return false;
      return true;
    });
  }, [todosEventos, filtros]);

  const temasDisponiveis = useMemo(() => {
    const set = new Set<string>();
    for (const e of todosEventos) for (const t of e.tema ?? []) set.add(t);
    return Array.from(set).sort();
  }, [todosEventos]);

  const dimensoes = dimensoesState.data ?? [];
  const dimensoesPorChave = useMemo(() => new Map(dimensoes.map((d) => [d.chave, d])), [dimensoes]);

  useMemo(() => {
    if (dimensoes.length) garantirChaves(dimensoes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dimensoes.length]);

  const scoreResult = useMemo(
    () => calcularScore(metricasState.data ?? [], pesos),
    [metricasState.data, pesos]
  );

  if (candidatoState.loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    );
  }

  if (candidatoState.error || !candidatoState.data) {
    return <ErroApiState mensagem={candidatoState.error ?? "Candidato não encontrado"} offline={candidatoState.offline} />;
  }

  const candidato = candidatoState.data;

  return (
    <div className="space-y-8">
      <PerfilHeader candidato={candidato} />

      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <section className="space-y-4 min-w-0">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="font-display text-xl text-ink">Linha do tempo de eventos</h2>
            <div className="no-print">
              <TimelineFilters filtros={filtros} onChange={setFiltros} temasDisponiveis={temasDisponiveis} />
            </div>
          </div>
          <Timeline
            eventos={eventosFiltrados}
            loading={eventosState.loading}
            error={eventosState.error}
            offline={eventosState.offline}
          />
        </section>

        <aside className="space-y-4">
          <EstagioLegenda />

          <div className="rounded-xl border border-border bg-surface p-5">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-display text-lg text-ink">Seu score para {candidato.nome_urna.split(" ")[0]}</h3>
              <Link
                to="/pesos"
                className="no-print text-[11px] text-seal-bright hover:text-ochre-bright underline underline-offset-4"
              >
                ajustar pesos
              </Link>
            </div>
            <p className="text-[11px] text-muted mb-4">Calculado no seu navegador com os pesos atuais.</p>

            {dimensoesState.loading || metricasState.loading ? (
              <Skeleton className="h-32 w-full" />
            ) : dimensoesState.error ? (
              <ErroApiState mensagem={dimensoesState.error} offline={dimensoesState.offline} />
            ) : dimensoes.length === 0 ? (
              <EmptyState icone="🧮" titulo="Dimensões indisponíveis" descricao="A rota /dimensoes ainda não retornou dados." />
            ) : (
              <>
                <ScoreGauge score={scoreResult.score} somaPesos={scoreResult.somaPesos} />
                <div className="mt-3">
                  <ScoreBreakdownList
                    itens={scoreResult.itens}
                    dimensoesPorChave={dimensoesPorChave}
                    onAuditar={(chave) => setDimensaoAuditada(dimensoesPorChave.get(chave) ?? null)}
                  />
                </div>
              </>
            )}
          </div>

          <div className="no-print rounded-xl border border-border bg-surface p-5">
            <h3 className="font-display text-base text-ink mb-1">Exportar relatório</h3>
            <p className="text-[11px] text-muted mb-3 leading-relaxed">
              Inclui a linha do tempo completa com link de fonte de cada evento, estágio jurídico de cada processo e
              o breakdown de score com os pesos atuais.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="rounded-full px-4 py-2 text-xs font-medium border border-border-soft text-ink-dim hover:border-ochre hover:text-ochre-bright transition-colors"
              >
                Imprimir / salvar PDF
              </button>
              <button
                type="button"
                disabled={todosEventos.length === 0 && dimensoes.length === 0}
                onClick={() => {
                  const md = gerarMarkdownCandidato({
                    candidato,
                    eventos: todosEventos,
                    scoreResult,
                    dimensoesPorChave,
                    pesos,
                  });
                  baixarArquivoTexto(`relatorio-${nomeArquivoSeguro(candidato.nome_urna)}.md`, md);
                }}
                className="rounded-full px-4 py-2 text-xs font-medium border border-border-soft text-ink-dim hover:border-seal hover:text-seal-bright transition-colors disabled:opacity-40 disabled:pointer-events-none"
              >
                Baixar Markdown
              </button>
            </div>
          </div>
        </aside>
      </div>

      <DimensionAuditDrawer
        aberto={!!dimensaoAuditada}
        onFechar={() => setDimensaoAuditada(null)}
        dimensao={dimensaoAuditada}
        candidatoId={candidato.id}
        candidatoNome={candidato.nome_urna}
        valorNormalizado={
          dimensaoAuditada
            ? scoreResult.itens.find((i) => i.chave === dimensaoAuditada.chave)?.valor ?? null
            : null
        }
      />
    </div>
  );
}
