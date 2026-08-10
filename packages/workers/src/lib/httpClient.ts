import { logger } from "./logger.js";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RetryOptions {
  /** Número de tentativas extras após a primeira falha. Default: 2 (3 tentativas no total). */
  retries?: number;
  /** Delay base do backoff exponencial em ms. Default: 500. */
  backoffMs?: number;
  /** Nome da fonte, só para o log de retry ficar identificável. */
  fonte?: string;
}

/**
 * fetch() com retry e backoff exponencial simples (tentativa N espera
 * backoffMs * 2^(N-1)). Pensado para ser reaproveitado por qualquer adaptador
 * de fonte (Câmara, TSE, Portal da Transparência, ...).
 */
export async function fetchJson<T>(
  url: string,
  init?: RequestInit,
  opts: RetryOptions = {}
): Promise<T> {
  const { retries = 2, backoffMs = 500, fonte = "http" } = opts;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: {
          Accept: "application/json",
          "User-Agent": "monitor-candidatos-workers/0.1",
          ...init?.headers,
        },
      });
      if (!res.ok) {
        throw new HttpError(res.status, `HTTP ${res.status} ${res.statusText} em ${url}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      lastError = err;
      const isLastAttempt = attempt === retries;
      if (isLastAttempt) break;
      const delay = backoffMs * 2 ** attempt;
      logger.warn(fonte, `tentativa ${attempt + 1}/${retries + 1} falhou, retry em ${delay}ms`, {
        url,
        erro: err instanceof Error ? err.message : String(err),
      });
      await sleep(delay);
    }
  }

  throw lastError;
}

/** Rate limiting básico: delay fixo configurável entre requisições sequenciais. */
export class RateLimiter {
  constructor(private readonly delayMs: number) {}

  async wait(): Promise<void> {
    if (this.delayMs > 0) await sleep(this.delayMs);
  }
}
