import "dotenv/config";
import Fastify, { type FastifyError } from "fastify";
import cors from "@fastify/cors";
import { healthRoutes } from "./routes/health.js";
import { candidatosRoutes } from "./routes/candidatos.js";
import { dimensoesRoutes } from "./routes/dimensoes.js";
import { ValidationError, NotFoundError } from "./lib/pagination.js";
import type { ApiErrorBody } from "./types.js";

const PORT = Number(process.env.API_PORT ?? 3333);
const HOST = process.env.API_HOST ?? "0.0.0.0";

const DEFAULT_ALLOWED_ORIGINS = ["http://localhost:5173"];
const extraOrigin = process.env.API_CORS_ORIGIN;
const allowedOrigins = extraOrigin
  ? [...DEFAULT_ALLOWED_ORIGINS, extraOrigin]
  : DEFAULT_ALLOWED_ORIGINS;

async function buildServer() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
  });

  await app.register(cors, {
    origin: allowedOrigins,
  });

  // Formato de erro consistente: { error: string }.
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof ValidationError) {
      const body: ApiErrorBody = { error: error.message };
      return reply.status(400).send(body);
    }
    if (error instanceof NotFoundError) {
      const body: ApiErrorBody = { error: error.message };
      return reply.status(404).send(body);
    }
    // Erros de validação de schema do próprio Fastify (querystring/params).
    if (error.validation) {
      const body: ApiErrorBody = { error: error.message };
      return reply.status(400).send(body);
    }

    request.log.error(error);
    const body: ApiErrorBody = { error: "Erro interno do servidor" };
    return reply.status(500).send(body);
  });

  app.setNotFoundHandler((request, reply) => {
    const body: ApiErrorBody = { error: `Rota não encontrada: ${request.method} ${request.url}` };
    return reply.status(404).send(body);
  });

  await app.register(healthRoutes);
  await app.register(dimensoesRoutes);
  await app.register(candidatosRoutes);

  return app;
}

async function main() {
  const app = await buildServer();
  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`Monitor de Candidatos API rodando em http://localhost:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
