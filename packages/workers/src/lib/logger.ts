/**
 * Log estruturado simples (JSON lines no console) — requisito de observabilidade
 * da seção 7 do documento de arquitetura ("fonte que quebra silenciosamente é o
 * pior cenário"). Sem dependência externa: console é suficiente nesta fase.
 */

type LogLevel = "info" | "warn" | "error";

function emit(
  level: LogLevel,
  fonte: string,
  message: string,
  extra?: Record<string, unknown>
): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    fonte,
    message,
    ...extra,
  };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (fonte: string, message: string, extra?: Record<string, unknown>) =>
    emit("info", fonte, message, extra),
  warn: (fonte: string, message: string, extra?: Record<string, unknown>) =>
    emit("warn", fonte, message, extra),
  error: (fonte: string, message: string, extra?: Record<string, unknown>) =>
    emit("error", fonte, message, extra),
};
