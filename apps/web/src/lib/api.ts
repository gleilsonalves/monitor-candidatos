// Cliente de API tipado, sem dependências externas.
// A API (packages/api) está sendo construída em paralelo e pode estar fora
// do ar, com o banco vazio, ou ainda sem todas as rotas — todo método aqui
// falha "graciosamente": nunca lança para a UI, sempre devolve um resultado
// tipado que a tela sabe renderizar como vazio/erro.

import type {
  Candidato,
  CandidatoDetalhe,
  Dimensao,
  EventosPaginados,
  Evento,
  Metrica,
  Pagina,
} from "./types";

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ||
  "http://localhost:3333";

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; offline: boolean };

// Cache HTTP em memória, TTL curto (Fase 4, seção 8: "cache agressivo e
// CDN"). Isso é uma aproximação deliberadamente modesta: não existe CDN
// nem cache compartilhado entre usuários rodando localmente — o que dá pra
// fazer no cliente é evitar refetch da MESMA url dentro da MESMA aba/sessão
// enquanto a tela recalcula (comparador com 4 candidatos reabrindo o mesmo
// candidato, navegação de volta ao perfil, etc). Cache agressivo de verdade
// (edge/CDN, invalidação por deploy, cache compartilhado) só se resolve em
// produção com Netlify/Vercel — não dá pra simular isso num app client-side
// sozinho. Só respostas OK são cacheadas; erro nunca fica preso em cache.
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { expiresAt: number; result: ApiResult<unknown> }>();

export function limparCacheApi() {
  cache.clear();
}

async function request<T>(
  path: string,
  params?: Record<string, string | undefined>,
  opts?: { raw?: boolean }
): Promise<ApiResult<T>> {
  const url = new URL(BASE_URL + path);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") url.searchParams.set(key, value);
    }
  }

  // raw entra na chave porque a mesma URL pode ser lida tanto "crua"
  // (requestPagina) quanto desembrulhada (request normal) em pontos
  // diferentes do código — não deveriam colidir, mas a chave evita qualquer
  // risco de um consumidor receber o formato do outro.
  const cacheKey = `${opts?.raw ? "raw:" : "unwrapped:"}${url.toString()}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result as ApiResult<T>;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return { ok: false, error: `A API respondeu ${res.status} para ${path}`, offline: false };
    }

    const json = await res.json();
    const result: ApiResult<T> = { ok: true, data: opts?.raw ? (json as T) : unwrap<T>(json) };
    cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, result });
    return result;
  } catch (err) {
    clearTimeout(timeout);
    const offline = err instanceof TypeError || (err as Error)?.name === "AbortError";
    return {
      ok: false,
      error: offline
        ? "Não foi possível conectar à API. Ela pode ainda não estar no ar."
        : (err as Error)?.message || "Erro desconhecido",
      offline,
    };
  }
}

// Aceita tanto payload bruto quanto envelopes comuns ({data: ...}, {items: ...})
// já que o contrato exato da API ainda está sendo fechado em paralelo.
function unwrap<T>(json: unknown): T {
  if (json && typeof json === "object") {
    if ("data" in (json as Record<string, unknown>)) return (json as Record<string, unknown>).data as T;
  }
  return json as T;
}

// Para endpoints paginados, preserva `total`/`limit`/`offset` do envelope —
// `unwrap()` sozinho descartaria tudo isso e só devolveria os itens da página.
async function requestPagina<T>(
  path: string,
  params?: Record<string, string | undefined>
): Promise<ApiResult<Pagina<T>>> {
  const res = await request<Record<string, unknown>>(path, params, { raw: true });
  if (!res.ok) return res;
  const json = res.data;
  const itens = (Array.isArray(json) ? json : (json.data as T[]) ?? []) as T[];
  const total = typeof json.total === "number" ? json.total : itens.length;
  const limit = typeof json.limit === "number" ? json.limit : itens.length;
  const offset = typeof json.offset === "number" ? json.offset : 0;
  return { ok: true, data: { itens, total, limit, offset } };
}

export interface ListaCandidatosParams {
  uf?: string;
  cargo_pretendido?: string;
  partido_atual?: string;
  q?: string;
  limit?: string;
  offset?: string;
  [key: string]: string | undefined;
}

export const api = {
  listarCandidatos(params: ListaCandidatosParams = {}) {
    return requestPagina<Candidato>("/candidatos", params);
  },

  obterCandidato(id: string) {
    return request<CandidatoDetalhe>(`/candidatos/${id}`);
  },

  listarEventos(
    id: string,
    params: { tipo?: string; categoria?: string; tema?: string; pagina?: string } = {}
  ) {
    return request<EventosPaginados | Evento[]>(`/candidatos/${id}/eventos`, params);
  },

  listarMetricas(id: string) {
    return request<Metrica[]>(`/candidatos/${id}/metricas`);
  },

  listarDimensoes() {
    return request<Dimensao[]>("/dimensoes");
  },
};

export function apiBaseUrl() {
  return BASE_URL;
}
