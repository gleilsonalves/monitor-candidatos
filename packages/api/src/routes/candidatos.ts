import type { FastifyInstance } from "fastify";
import { supabase } from "../lib/supabase.js";
import { parsePagination, ValidationError, NotFoundError } from "../lib/pagination.js";
import type {
  CandidatoPerfilCompleto,
  Evento,
  Metrica,
} from "../types.js";

const CANDIDATO_LIST_COLUMNS =
  "id, nome_civil, nome_urna, partido_atual, uf, cargo_pretendido, foto_url";

const TIPOS_EVENTO_VALIDOS = new Set([
  "proposicao",
  "voto",
  "processo",
  "sancao",
  "despesa",
  "nomeacao",
  "post",
  "anuncio",
]);

const CATEGORIAS_EVENTO_VALIDAS = new Set(["realizacao", "controversia", "neutro"]);

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export async function candidatosRoutes(app: FastifyInstance) {
  // GET /candidatos — lista com filtros opcionais
  app.get("/candidatos", async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const { limit, offset } = parsePagination(query);

    let builder = supabase
      .from("candidato")
      .select(CANDIDATO_LIST_COLUMNS, { count: "exact" })
      .order("nome_urna", { ascending: true })
      .range(offset, offset + limit - 1);

    if (query.uf) {
      builder = builder.eq("uf", query.uf.toUpperCase());
    }
    if (query.cargo_pretendido) {
      builder = builder.eq("cargo_pretendido", query.cargo_pretendido);
    }
    if (query.partido_atual) {
      builder = builder.eq("partido_atual", query.partido_atual);
    }
    if (query.q) {
      const term = query.q.trim();
      if (term.length === 0) {
        throw new ValidationError("`q` não pode ser vazio quando informado");
      }
      // Busca textual: tsvector `busca` (websearch) combinada com ilike de fallback
      // para prefixos curtos/termos parciais que o parser de tsquery rejeitaria.
      const escaped = term.replace(/[%_,()]/g, (m) => `\\${m}`);
      builder = builder.or(
        `busca.wfts(portuguese).${escaped},nome_civil.ilike.%${escaped}%,nome_urna.ilike.%${escaped}%`
      );
    }

    const { data, error, count } = await builder;
    if (error) {
      request.log.error(error);
      return reply.status(502).send({ error: "Falha ao consultar candidatos" });
    }

    return reply.send({
      data,
      limit,
      offset,
      total: count ?? null,
    });
  });

  // GET /candidatos/:id — perfil completo
  app.get<{ Params: { id: string } }>("/candidatos/:id", async (request, reply) => {
    const { id } = request.params;
    if (!isUuid(id)) {
      throw new ValidationError("`id` precisa ser um uuid válido");
    }

    const { data: candidato, error: candidatoError } = await supabase
      .from("candidato")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (candidatoError) {
      request.log.error(candidatoError);
      return reply.status(502).send({ error: "Falha ao consultar candidato" });
    }
    if (!candidato) {
      throw new NotFoundError(`Candidato ${id} não encontrado`);
    }

    const { data: perfisSociais, error: perfisError } = await supabase
      .from("perfil_social")
      .select("*")
      .eq("candidato_id", id);

    if (perfisError) {
      request.log.error(perfisError);
      return reply.status(502).send({ error: "Falha ao consultar perfis sociais" });
    }

    const perfilCompleto: CandidatoPerfilCompleto = {
      ...candidato,
      perfis_sociais: perfisSociais ?? [],
    };

    return reply.send(perfilCompleto);
  });

  // GET /candidatos/:id/eventos — timeline paginada
  app.get<{ Params: { id: string } }>(
    "/candidatos/:id/eventos",
    async (request, reply) => {
      const { id } = request.params;
      if (!isUuid(id)) {
        throw new ValidationError("`id` precisa ser um uuid válido");
      }

      const query = request.query as Record<string, string | undefined>;
      const { limit, offset } = parsePagination(query);

      if (query.tipo && !TIPOS_EVENTO_VALIDOS.has(query.tipo)) {
        throw new ValidationError(
          `\`tipo\` inválido. Valores aceitos: ${[...TIPOS_EVENTO_VALIDOS].join(", ")}`
        );
      }
      if (query.categoria && !CATEGORIAS_EVENTO_VALIDAS.has(query.categoria)) {
        throw new ValidationError(
          `\`categoria\` inválida. Valores aceitos: ${[...CATEGORIAS_EVENTO_VALIDAS].join(", ")}`
        );
      }

      await assertCandidatoExists(id);

      let builder = supabase
        .from("evento")
        .select("*", { count: "exact" })
        .eq("candidato_id", id)
        .order("data_evento", { ascending: false })
        .range(offset, offset + limit - 1);

      if (query.tipo) {
        builder = builder.eq("tipo", query.tipo);
      }
      if (query.categoria) {
        builder = builder.eq("categoria", query.categoria);
      }
      if (query.tema) {
        // tema é text[] no banco — contains busca eventos que tenham esse tema entre os seus.
        builder = builder.contains("tema", [query.tema]);
      }

      const { data, error, count } = await builder;
      if (error) {
        request.log.error(error);
        return reply.status(502).send({ error: "Falha ao consultar eventos" });
      }

      const eventos = data as Evento[];

      return reply.send({
        data: eventos,
        limit,
        offset,
        total: count ?? null,
      });
    }
  );

  // GET /candidatos/:id/metricas — última métrica calculada por chave
  app.get<{ Params: { id: string } }>(
    "/candidatos/:id/metricas",
    async (request, reply) => {
      const { id } = request.params;
      if (!isUuid(id)) {
        throw new ValidationError("`id` precisa ser um uuid válido");
      }

      await assertCandidatoExists(id);

      // Traz todas as métricas do candidato ordenadas por calculado_em desc
      // e reduz em memória para o registro mais recente por chave — mantém
      // o endpoint simples sem depender de DISTINCT ON via PostgREST.
      const { data, error } = await supabase
        .from("metrica")
        .select("*")
        .eq("candidato_id", id)
        .order("calculado_em", { ascending: false });

      if (error) {
        request.log.error(error);
        return reply.status(502).send({ error: "Falha ao consultar métricas" });
      }

      const maisRecentePorChave = new Map<string, Metrica>();
      for (const metrica of (data as Metrica[]) ?? []) {
        if (!maisRecentePorChave.has(metrica.chave)) {
          maisRecentePorChave.set(metrica.chave, metrica);
        }
      }

      return reply.send({
        data: [...maisRecentePorChave.values()],
      });
    }
  );
}

async function assertCandidatoExists(id: string): Promise<void> {
  const { data, error } = await supabase
    .from("candidato")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new NotFoundError(`Candidato ${id} não encontrado`);
  }
}
