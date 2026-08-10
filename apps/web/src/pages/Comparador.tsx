import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { SeletorCandidatos } from "../components/comparador/SeletorCandidatos";
import { LinhaDimensaoComparador } from "../components/comparador/LinhaDimensaoComparador";
import { ScoreGauge } from "../components/pesos/ScoreGauge";
import { CopiarLinkPesos } from "../components/pesos/CopiarLinkPesos";
import { DimensionAuditDrawer } from "../components/pesos/DimensionAuditDrawer";
import { AvatarPlaceholder } from "../components/ui/AvatarPlaceholder";
import { EmptyState, ErroApiState } from "../components/ui/EmptyState";
import { Skeleton } from "../components/ui/Skeleton";
import { useApi } from "../hooks/useApi";
import { useComparadorDados } from "../hooks/useComparador";
import { api } from "../lib/api";
import { calcularScore } from "../lib/score";
import { normalizarEventos } from "../lib/eventos";
import { serializarPesosParaQuery } from "../lib/pesosUrl";
import { baixarArquivoTexto, gerarMarkdownComparador, nomeArquivoSeguro, type EntradaComparador } from "../lib/relatorio";
import { useWeights } from "../context/WeightsContext";
import type { Dimensao } from "../lib/types";

const MAX_CANDIDATOS = 4;
const MIN_CANDIDATOS = 2;

export function Comparador() {
  const [searchParams, setSearchParams] = useSearchParams();
  const idsIniciais = useMemo(
    () => (searchParams.get("ids") ?? "").split(",").filter(Boolean).slice(0, MAX_CANDIDATOS),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const [selecionados, setSelecionados] = useState<string[]>(idsIniciais);

  // Seleção vira query string (?ids=a,b,c) pra a comparação inteira ser
  // compartilhável, não só os pesos — replace (não push) pra não poluir o
  // histórico do navegador a cada clique de adicionar/remover.
  useEffect(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (selecionados.length) next.set("ids", selecionados.join(","));
        else next.delete("ids");
        return next;
      },
      { replace: true }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selecionados]);

  const candidatosState = useApi(() => api.listarCandidatos({ limit: "200" }), []);
  const dimensoesState = useApi(() => api.listarDimensoes(), []);
  const { pesos, garantirChaves } = useWeights();

  const todosCandidatos = candidatosState.data?.itens ?? [];
  const dimensoes = dimensoesState.data ?? [];

  useEffect(() => {
    if (dimensoes.length) garantirChaves(dimensoes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dimensoes.length]);

  const dados = useComparadorDados(selecionados);

  const [auditoria, setAuditoria] = useState<{
    candidatoId: string;
    candidatoNome: string;
    dimensao: Dimensao;
    valor: number | null;
  } | null>(null);
  const [exportando, setExportando] = useState(false);

  function adicionar(id: string) {
    setSelecionados((prev) => (prev.includes(id) || prev.length >= MAX_CANDIDATOS ? prev : [...prev, id]));
  }
  function remover(id: string) {
    setSelecionados((prev) => prev.filter((x) => x !== id));
  }

  const selecionadosCandidatos = selecionados
    .map((id) => todosCandidatos.find((c) => c.id === id))
    .filter((c): c is (typeof todosCandidatos)[number] => !!c);

  const podeExportar = selecionados.length >= MIN_CANDIDATOS && selecionados.every((id) => dados[id]?.candidato);

  async function exportarMarkdown() {
    if (!podeExportar) return;
    setExportando(true);
    try {
      const entradas: EntradaComparador[] = await Promise.all(
        selecionados.map(async (id) => {
          const item = dados[id]!;
          const eventosRes = await api.listarEventos(id);
          const eventos = normalizarEventos(eventosRes.ok ? eventosRes.data : null);
          const scoreResult = calcularScore(item.metricas ?? [], pesos);
          return { candidato: item.candidato!, eventos, scoreResult };
        })
      );
      const md = gerarMarkdownComparador({ entradas, dimensoes, pesos });
      const nomes = entradas.map((e) => nomeArquivoSeguro(e.candidato.nome_urna)).join("-vs-");
      baixarArquivoTexto(`comparacao-${nomes || "candidatos"}.md`, md);
    } finally {
      setExportando(false);
    }
  }

  function copiarLinkComparacao() {
    const url = new URL(window.location.href);
    url.searchParams.set("ids", selecionados.join(","));
    url.searchParams.set("pesos", serializarPesosParaQuery(pesos));
    const link = url.toString();
    navigator.clipboard?.writeText(link).catch(() => window.prompt("Copie o link desta comparação:", link));
  }

  const gridStyle = { gridTemplateColumns: `14rem repeat(${selecionados.length}, minmax(13.5rem, 1fr))` };

  return (
    <div className="space-y-8">
      <header className="max-w-2xl">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-ochre-bright mb-2">Comparador</p>
        <h1 className="font-display text-3xl text-ink">Comparação lado a lado</h1>
        <p className="text-sm text-ink-dim mt-2 leading-relaxed">
          Escolha de {MIN_CANDIDATOS} a {MAX_CANDIDATOS} candidatos. O score de cada um usa os mesmos pesos do{" "}
          <Link to="/pesos" className="text-seal-bright hover:text-ochre-bright underline underline-offset-4">
            painel de pesos
          </Link>{" "}
          — sem dado numa dimensão aparece como "sem dado", nunca como zero.
        </p>
      </header>

      {candidatosState.error ? (
        <ErroApiState mensagem={candidatosState.error} offline={candidatosState.offline} />
      ) : (
        <SeletorCandidatos
          candidatos={todosCandidatos}
          selecionados={selecionadosCandidatos}
          onAdicionar={adicionar}
          onRemover={remover}
          max={MAX_CANDIDATOS}
        />
      )}

      {selecionados.length < MIN_CANDIDATOS ? (
        <EmptyState
          icone="⚖️"
          titulo={`Selecione ao menos ${MIN_CANDIDATOS} candidatos`}
          descricao="Use o campo de busca acima para montar a comparação. A tabela lado a lado aparece assim que houver candidatos suficientes selecionados."
        />
      ) : dimensoesState.loading ? (
        <Skeleton className="h-96 w-full rounded-2xl" />
      ) : dimensoesState.error ? (
        <ErroApiState mensagem={dimensoesState.error} offline={dimensoesState.offline} />
      ) : dimensoes.length === 0 ? (
        <EmptyState icone="🧮" titulo="Dimensões indisponíveis" descricao="A rota /dimensoes ainda não retornou dados." />
      ) : (
        <div className="space-y-4">
          <div className="no-print flex flex-wrap gap-2 justify-end">
            <CopiarLinkPesos />
            <button
              type="button"
              onClick={copiarLinkComparacao}
              className="rounded-full px-4 py-2 text-xs font-medium border border-border-soft text-ink-dim hover:border-seal hover:text-seal-bright transition-colors inline-flex items-center gap-1.5"
              title="Copia um link com estes candidatos e estes pesos"
            >
              <span aria-hidden>🔗</span>
              Copiar link desta comparação
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-full px-4 py-2 text-xs font-medium border border-border-soft text-ink-dim hover:border-ochre hover:text-ochre-bright transition-colors"
            >
              Imprimir / salvar PDF
            </button>
            <button
              type="button"
              disabled={!podeExportar || exportando}
              onClick={exportarMarkdown}
              className="rounded-full px-4 py-2 text-xs font-medium border border-border-soft text-ink-dim hover:border-seal hover:text-seal-bright transition-colors disabled:opacity-40 disabled:pointer-events-none"
            >
              {exportando ? "Gerando…" : "Baixar Markdown"}
            </button>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
            <div className="grid min-w-max" style={gridStyle}>
              <div className="p-3 bg-surface sticky left-0" aria-hidden />
              {selecionados.map((id) => {
                const item = dados[id];
                if (!item || item.loading) {
                  return (
                    <div key={id} className="p-4 border-l border-border-soft flex flex-col items-center gap-2">
                      <Skeleton className="h-16 w-16 rounded-full" />
                      <Skeleton className="h-4 w-24" />
                    </div>
                  );
                }
                if (item.error || !item.candidato) {
                  return (
                    <div key={id} className="p-4 border-l border-border-soft">
                      <ErroApiState mensagem={item.error ?? "Candidato não encontrado"} offline={item.offline} />
                    </div>
                  );
                }
                const c = item.candidato;
                return (
                  <div key={id} className="p-4 border-l border-border-soft flex flex-col items-center text-center gap-1.5">
                    <AvatarPlaceholder nome={c.nome_urna} fotoUrl={c.foto_url} size="md" />
                    <Link
                      to={`/candidatos/${c.id}`}
                      className="font-display text-base text-ink hover:text-ochre-bright transition-colors leading-tight"
                    >
                      {c.nome_urna}
                    </Link>
                    <p className="text-[11px] font-mono text-muted-2">
                      {[c.cargo_pretendido, c.partido_atual, c.uf].filter(Boolean).join(" · ") || "—"}
                    </p>
                    <button
                      type="button"
                      onClick={() => remover(id)}
                      className="no-print text-[11px] text-muted hover:text-ochre-bright underline underline-offset-4 mt-1"
                    >
                      remover
                    </button>
                  </div>
                );
              })}

              <div className="p-3 border-t border-border-soft flex items-center text-sm text-ink-dim font-medium bg-surface sticky left-0">
                Score com seus pesos
              </div>
              {selecionados.map((id) => {
                const item = dados[id];
                const score = item?.metricas ? calcularScore(item.metricas, pesos) : null;
                return (
                  <div key={id} className="p-3 border-t border-l border-border-soft flex items-center justify-center">
                    {item?.loading ? (
                      <Skeleton className="h-24 w-24 rounded-full" />
                    ) : (
                      <div className="scale-75 -my-4">
                        <ScoreGauge score={score?.score ?? null} somaPesos={score?.somaPesos ?? 0} />
                      </div>
                    )}
                  </div>
                );
              })}

              {dimensoes.map((dim) => (
                <LinhaDimensaoComparador
                  key={dim.chave}
                  dimensao={dim}
                  colunas={selecionados.map((id) => {
                    const item = dados[id];
                    const score = item?.metricas ? calcularScore(item.metricas, pesos) : null;
                    const valorItem = score?.itens.find((i) => i.chave === dim.chave);
                    return { id, valor: valorItem?.valor ?? null };
                  })}
                  onAuditar={(candidatoId) => {
                    const item = dados[candidatoId];
                    if (!item?.candidato) return;
                    const score = calcularScore(item.metricas ?? [], pesos);
                    const valorItem = score.itens.find((i) => i.chave === dim.chave);
                    setAuditoria({
                      candidatoId,
                      candidatoNome: item.candidato.nome_urna,
                      dimensao: dim,
                      valor: valorItem?.valor ?? null,
                    });
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      <DimensionAuditDrawer
        aberto={!!auditoria}
        onFechar={() => setAuditoria(null)}
        dimensao={auditoria?.dimensao ?? null}
        candidatoId={auditoria?.candidatoId ?? null}
        candidatoNome={auditoria?.candidatoNome}
        valorNormalizado={auditoria?.valor ?? null}
      />
    </div>
  );
}
