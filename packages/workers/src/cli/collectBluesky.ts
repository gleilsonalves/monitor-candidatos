import { loadEnv } from "../lib/env.js";
import { createWorkerSupabaseClient } from "../lib/supabaseClient.js";
import { logger } from "../lib/logger.js";
import { BlueskyApiClient } from "../collectors/bluesky/client.js";
import { BlueskyCollector } from "../collectors/bluesky/collector.js";

const FONTE = "bluesky_posts";
const DRY_RUN_CANDIDATO_ID_PLACEHOLDER = "00000000-0000-0000-0000-000000000000";

interface CliArgs {
  candidatoId?: string;
  handle?: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dryRun: false };
  for (const arg of argv) {
    if (arg.startsWith("--candidatoId=")) {
      args.candidatoId = arg.slice("--candidatoId=".length).trim();
    } else if (arg.startsWith("--handle=")) {
      args.handle = arg.slice("--handle=".length).trim();
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    }
  }
  return args;
}

function resolveHandle(args: CliArgs): string {
  if (!args.handle) {
    throw new Error(
      "Informe o handle do Bluesky do candidato: " +
        "`npm run collect:bluesky -- --candidatoId=<uuid> --handle=<handle.bsky.social>`. " +
        "O handle NUNCA é inferido a partir do nome do candidato — precisa vir explícito " +
        "(ver README de packages/workers/src/collectors/bluesky, seção 'Entity resolution')."
    );
  }
  return args.handle;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const handle = resolveHandle(args);

  const blueskyApiBase = process.env.BLUESKY_API_BASE ?? "https://public.api.bsky.app/xrpc";
  const client = new BlueskyApiClient(blueskyApiBase, { rateLimitMs: 300, retries: 2 });

  if (args.dryRun) {
    logger.info(
      FONTE,
      `[dry-run] buscando posts de handle="${handle}" — não grava no banco, não requer ` +
        "SUPABASE_SERVICE_ROLE_KEY"
    );

    const collector = new BlueskyCollector(DRY_RUN_CANDIDATO_ID_PLACEHOLDER, handle, client, {});
    await collector.prepararParaInspecao(DRY_RUN_CANDIDATO_ID_PLACEHOLDER);

    const brutos = await collector.fetchAll();
    logger.info(FONTE, `${brutos.length} item(ns) de feed obtido(s) da API do Bluesky`);

    const amostra = brutos.slice(0, 5).map((raw) => collector.normalize(raw));
    console.log(
      JSON.stringify(
        {
          total_bruto: brutos.length,
          amostra_normalizada: amostra,
          aviso: `candidato_id acima é um placeholder (${DRY_RUN_CANDIDATO_ID_PLACEHOLDER}) — ` +
            "em execução real ele vem do --candidatoId informado (validado contra a tabela " +
            "candidato em prepare()), nunca inferido a partir do handle ou do nome.",
        },
        null,
        2
      )
    );
    return;
  }

  if (!args.candidatoId) {
    throw new Error(
      "--candidatoId é obrigatório para coleta real (nunca inferido a partir do handle ou do " +
        "nome — ver README de packages/workers/src/collectors/bluesky, seção 'Entity resolution'). " +
        "Ex: `npm run collect:bluesky -- --candidatoId=<uuid> --handle=<handle.bsky.social>`"
    );
  }

  const env = loadEnv();
  const supabase = createWorkerSupabaseClient(env);
  const collector = new BlueskyCollector(args.candidatoId, handle, client, { supabase });
  const stats = await collector.run();
  console.log(JSON.stringify(stats, null, 2));
}

main().catch((err) => {
  logger.error("cli", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
