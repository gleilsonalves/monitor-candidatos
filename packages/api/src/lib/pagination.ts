export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

export interface ParsedPagination {
  limit: number;
  offset: number;
}

/**
 * Parseia limit/offset de query string com validação.
 * Lança um erro com mensagem amigável (400) se os valores forem inválidos.
 */
export function parsePagination(query: {
  limit?: unknown;
  offset?: unknown;
}): ParsedPagination {
  let limit = DEFAULT_PAGE_LIMIT;
  let offset = 0;

  if (query.limit !== undefined) {
    const parsed = Number(query.limit);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new ValidationError("`limit` precisa ser um inteiro positivo");
    }
    limit = Math.min(parsed, MAX_PAGE_LIMIT);
  }

  if (query.offset !== undefined) {
    const parsed = Number(query.offset);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new ValidationError("`offset` precisa ser um inteiro >= 0");
    }
    offset = parsed;
  }

  return { limit, offset };
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}
