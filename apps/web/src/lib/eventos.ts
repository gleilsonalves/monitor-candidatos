import type { Evento, EventosPaginados } from "./types";

export function normalizarEventos(data: EventosPaginados | Evento[] | null): Evento[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return data.itens ?? [];
}
