import { useEffect, useRef, useState } from "react";
import type { ApiResult } from "../lib/api";

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  offline: boolean;
}

/**
 * Hook genérico para chamadas à API que nunca lança — sempre resolve em
 * { data, loading, error, offline }. `deps` controla quando refazer a
 * chamada (mesmo espírito de um array de dependências de efeito).
 */
export function useApi<T>(fetcher: () => Promise<ApiResult<T>>, deps: unknown[]): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ data: null, loading: true, error: null, offline: false });
  const vivo = useRef(true);

  useEffect(() => {
    vivo.current = true;
    setState((s) => ({ ...s, loading: true, error: null }));

    fetcher().then((res) => {
      if (!vivo.current) return;
      if (res.ok) {
        setState({ data: res.data, loading: false, error: null, offline: false });
      } else {
        setState({ data: null, loading: false, error: res.error, offline: res.offline });
      }
    });

    return () => {
      vivo.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
