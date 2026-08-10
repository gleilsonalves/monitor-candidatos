import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { CandidatoDetalhe, Metrica } from "../lib/types";

export interface ComparadorItem {
  id: string;
  candidato: CandidatoDetalhe | null;
  metricas: Metrica[] | null;
  loading: boolean;
  error: string | null;
  offline: boolean;
}

// Busca, em paralelo, GET /candidatos/:id e GET /candidatos/:id/metricas
// para cada candidato selecionado no comparador. Não existe (e não foi
// criado) endpoint dedicado de comparação na API — packages/api não foi
// tocado nesta fase, conforme escopo. São só N pares de chamadas
// client-side em paralelo reaproveitando os endpoints que já existem; o
// cache com TTL curto em lib/api.ts evita refetch se o mesmo candidato já
// apareceu em outra tela recentemente.
//
// Trade-off aceito: ao trocar a seleção, TODOS os ids recarregam (mesmo os
// que já estavam selecionados), não só os novos — mais simples de manter
// correto do que sincronizar estado parcial, e o cache faz o custo real
// disso ser quase zero.
export function useComparadorDados(ids: string[]): Record<string, ComparadorItem> {
  const [estado, setEstado] = useState<Record<string, ComparadorItem>>({});
  const vivo = useRef(true);
  const idsKey = ids.join(",");

  useEffect(() => {
    vivo.current = true;

    setEstado(() => {
      const proximo: Record<string, ComparadorItem> = {};
      for (const id of ids) {
        proximo[id] = { id, candidato: null, metricas: null, loading: true, error: null, offline: false };
      }
      return proximo;
    });

    ids.forEach((id) => {
      Promise.all([api.obterCandidato(id), api.listarMetricas(id)]).then(([candidatoRes, metricasRes]) => {
        if (!vivo.current) return;
        setEstado((prev) => {
          if (!(id in prev)) return prev; // candidato foi removido da seleção enquanto a chamada estava em voo
          return {
            ...prev,
            [id]: {
              id,
              candidato: candidatoRes.ok ? candidatoRes.data : null,
              metricas: metricasRes.ok ? metricasRes.data : [],
              loading: false,
              error: candidatoRes.ok ? null : candidatoRes.error,
              offline: candidatoRes.ok ? false : candidatoRes.offline,
            },
          };
        });
      });
    });

    return () => {
      vivo.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  return estado;
}
