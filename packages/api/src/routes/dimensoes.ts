import type { FastifyInstance } from "fastify";
import { DIMENSOES } from "../lib/dimensoes.js";

export async function dimensoesRoutes(app: FastifyInstance) {
  // GET /dimensoes — estático, não depende do banco.
  app.get("/dimensoes", async (_request, reply) => {
    return reply.send({ data: DIMENSOES });
  });
}
