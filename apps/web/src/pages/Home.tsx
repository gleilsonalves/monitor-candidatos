import { useEffect, useMemo, useState } from "react";
import { Hero } from "../components/layout/Hero";
import { Filters, type FiltrosCandidatos } from "../components/candidatos/Filters";
import { CandidatoCard } from "../components/candidatos/CandidatoCard";
import { CandidatoCardSkeleton } from "../components/ui/Skeleton";
import { EmptyState, ErroApiState } from "../components/ui/EmptyState";
import { api } from "../lib/api";
import type { Candidato } from "../lib/types";

const PAGE_SIZE = "100";

export function Home() {
  const [filtros, setFiltros] = useState<FiltrosCandidatos>({
    q: "",
    uf: "",
    partido_atual: "",
    cargo_pretendido: "",
  });

  const [candidatos, setCandidatos] = useState<Candidato[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMais, setLoadingMais] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);

  // Troca de filtro reinicia a lista do zero.
  useEffect(() => {
    let vivo = true;
    setLoading(true);
    setError(null);

    api
      .listarCandidatos({
        uf: filtros.uf || undefined,
        partido_atual: filtros.partido_atual || undefined,
        cargo_pretendido: filtros.cargo_pretendido || undefined,
        q: filtros.q || undefined,
        limit: PAGE_SIZE,
        offset: "0",
      })
      .then((res) => {
        if (!vivo) return;
        if (res.ok) {
          setCandidatos(res.data.itens);
          setTotal(res.data.total);
        } else {
          setError(res.error);
          setOffline(res.offline);
        }
        setLoading(false);
      });

    return () => {
      vivo = false;
    };
  }, [filtros.uf, filtros.partido_atual, filtros.cargo_pretendido, filtros.q]);

  async function carregarMais() {
    setLoadingMais(true);
    const res = await api.listarCandidatos({
      uf: filtros.uf || undefined,
      partido_atual: filtros.partido_atual || undefined,
      cargo_pretendido: filtros.cargo_pretendido || undefined,
      q: filtros.q || undefined,
      limit: PAGE_SIZE,
      offset: String(candidatos.length),
    });
    if (res.ok) {
      setCandidatos((atual) => [...atual, ...res.data.itens]);
      setTotal(res.data.total);
    }
    setLoadingMais(false);
  }

  const partidosDisponiveis = useMemo(() => {
    const set = new Set<string>();
    for (const c of candidatos) if (c.partido_atual) set.add(c.partido_atual);
    return Array.from(set).sort();
  }, [candidatos]);

  const temMais = !loading && !error && candidatos.length < total;

  return (
    <div className="space-y-10">
      <Hero />

      <section id="candidatos" className="space-y-5">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-display text-2xl text-ink">Candidatos monitorados</h2>
          {!loading && !error && (
            <span className="text-xs text-muted font-mono">
              {candidatos.length === total ? total : `${candidatos.length} de ${total}`} registrados
            </span>
          )}
        </div>

        <Filters filtros={filtros} onChange={setFiltros} partidosDisponiveis={partidosDisponiveis} />

        {loading && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <CandidatoCardSkeleton key={i} />
            ))}
          </div>
        )}

        {!loading && error && <ErroApiState mensagem={error} offline={offline} />}

        {!loading && !error && candidatos.length === 0 && (
          <EmptyState
            icone="🗳️"
            titulo="Nenhum candidato encontrado"
            descricao="Ou a busca/filtro não encontrou resultado, ou a base ainda está sendo populada pelos coletores (Fase 0/1 do projeto). Tente limpar os filtros ou volte em breve."
            acao={
              (filtros.q || filtros.uf || filtros.partido_atual || filtros.cargo_pretendido) && (
                <button
                  onClick={() => setFiltros({ q: "", uf: "", partido_atual: "", cargo_pretendido: "" })}
                  className="text-xs text-ochre-bright underline underline-offset-4"
                >
                  Limpar filtros
                </button>
              )
            }
          />
        )}

        {!loading && !error && candidatos.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {candidatos.map((c, i) => (
              <CandidatoCard key={c.id} candidato={c} index={i} />
            ))}
          </div>
        )}

        {temMais && (
          <div className="flex justify-center pt-2">
            <button
              onClick={carregarMais}
              disabled={loadingMais}
              className="text-sm px-5 py-2.5 rounded-lg border border-border text-ink-dim hover:text-ink hover:border-ochre/60 transition-colors disabled:opacity-50"
            >
              {loadingMais ? "Carregando…" : `Carregar mais (${total - candidatos.length} restantes)`}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
