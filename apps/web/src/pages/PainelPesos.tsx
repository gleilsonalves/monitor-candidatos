import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { WeightPanel } from "../components/pesos/WeightPanel";
import { ScoreGauge } from "../components/pesos/ScoreGauge";
import { ScoreBreakdownList } from "../components/pesos/ScoreBreakdownList";
import { DimensionAuditDrawer } from "../components/pesos/DimensionAuditDrawer";
import { EmptyState, ErroApiState } from "../components/ui/EmptyState";
import { Skeleton } from "../components/ui/Skeleton";
import { useApi } from "../hooks/useApi";
import { api } from "../lib/api";
import { calcularScore } from "../lib/score";
import { useWeights } from "../context/WeightsContext";
import type { Dimensao } from "../lib/types";

export function PainelPesos() {
  const dimensoesState = useApi(() => api.listarDimensoes(), []);
  const candidatosState = useApi(() => api.listarCandidatos({ limit: "100" }), []);
  const { garantirChaves, pesos } = useWeights();

  const [candidatoId, setCandidatoId] = useState<string>("");
  const [dimensaoAuditada, setDimensaoAuditada] = useState<Dimensao | null>(null);

  const dimensoes = dimensoesState.data ?? [];
  const candidatos = candidatosState.data?.itens ?? [];
  const dimensoesPorChave = useMemo(() => new Map(dimensoes.map((d) => [d.chave, d])), [dimensoes]);

  useEffect(() => {
    if (dimensoes.length) garantirChaves(dimensoes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dimensoes.length]);

  useEffect(() => {
    if (!candidatoId && candidatos.length > 0) setCandidatoId(candidatos[0].id);
  }, [candidatos, candidatoId]);

  const metricasState = useApi(
    () => (candidatoId ? api.listarMetricas(candidatoId) : Promise.resolve({ ok: true as const, data: [] })),
    [candidatoId]
  );

  const scoreResult = useMemo(
    () => calcularScore(metricasState.data ?? [], pesos),
    [metricasState.data, pesos]
  );

  const candidatoAtual = candidatos.find((c) => c.id === candidatoId);

  return (
    <div className="space-y-10">
      <header className="max-w-2xl">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-ochre-bright mb-2">O diferencial do produto</p>
        <h1 className="font-display text-3xl text-ink">Painel de pesos</h1>
        <p className="text-sm text-ink-dim mt-2 leading-relaxed">
          Cada dimensão abaixo é uma métrica normalizada de 0 a 100 vinda de fonte oficial. O peso é inteiramente seu.
          Nada disso é enviado a um servidor — o cálculo roda aqui, no seu navegador, e some conforme você fecha a
          aba.
        </p>
      </header>

      {dimensoesState.loading ? (
        <Skeleton className="h-56 w-full rounded-2xl" />
      ) : dimensoesState.error ? (
        <ErroApiState mensagem={dimensoesState.error} offline={dimensoesState.offline} />
      ) : dimensoes.length === 0 ? (
        <EmptyState
          icone="🧮"
          titulo="As dimensões ainda não foram publicadas"
          descricao="Assim que a rota /dimensoes retornar as 9 dimensões de metrificação, os faders aparecem aqui."
        />
      ) : (
        <>
          <div className="rounded-2xl border border-border bg-surface p-5 sm:p-7">
            <WeightPanel dimensoes={dimensoes} onAuditarDimensao={(chave) => setDimensaoAuditada(dimensoesPorChave.get(chave) ?? null)} />
          </div>

          <div className="grid gap-6 lg:grid-cols-[20rem_1fr] items-start">
            <div className="rounded-2xl border border-border bg-surface p-6 flex flex-col items-center">
              <ScoreGauge score={scoreResult.score} somaPesos={scoreResult.somaPesos} />
              <p className="text-xs text-muted text-center mt-2">
                {candidatoAtual ? `Score de ${candidatoAtual.nome_urna} com os pesos atuais.` : "Selecione um candidato para calcular."}
              </p>
            </div>

            <div className="rounded-2xl border border-border bg-surface p-6 space-y-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="font-display text-lg text-ink">Pré-visualizar em um candidato</h2>
                {candidatosState.loading ? (
                  <Skeleton className="h-9 w-48" />
                ) : candidatos.length > 0 ? (
                  <select
                    value={candidatoId}
                    onChange={(e) => setCandidatoId(e.target.value)}
                    className="bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-ink-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ochre"
                  >
                    {candidatos.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome_urna}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>

              {candidatosState.error ? (
                <ErroApiState mensagem={candidatosState.error} offline={candidatosState.offline} />
              ) : candidatos.length === 0 && !candidatosState.loading ? (
                <EmptyState
                  icone="🗳️"
                  titulo="Nenhum candidato para pré-visualizar"
                  descricao="Configure os pesos à vontade — assim que houver candidatos na base, escolha um aqui para ver o score calculado."
                />
              ) : metricasState.loading ? (
                <Skeleton className="h-40 w-full" />
              ) : (
                <ScoreBreakdownList
                  itens={scoreResult.itens}
                  dimensoesPorChave={dimensoesPorChave}
                  onAuditar={(chave) => setDimensaoAuditada(dimensoesPorChave.get(chave) ?? null)}
                />
              )}

              {candidatoAtual && (
                <Link
                  to={`/candidatos/${candidatoAtual.id}`}
                  className="inline-flex items-center gap-1.5 text-xs text-seal-bright hover:text-ochre-bright underline underline-offset-4"
                >
                  Ver perfil completo de {candidatoAtual.nome_urna} →
                </Link>
              )}
            </div>
          </div>
        </>
      )}

      <DimensionAuditDrawer
        aberto={!!dimensaoAuditada}
        onFechar={() => setDimensaoAuditada(null)}
        dimensao={dimensaoAuditada}
        candidatoId={candidatoId || null}
        candidatoNome={candidatoAtual?.nome_urna}
        valorNormalizado={
          dimensaoAuditada ? scoreResult.itens.find((i) => i.chave === dimensaoAuditada.chave)?.valor ?? null : null
        }
      />
    </div>
  );
}
