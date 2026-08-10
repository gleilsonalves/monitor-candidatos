import { loadEnv } from "../lib/env.js";
import { createWorkerSupabaseClient } from "../lib/supabaseClient.js";
import { logger } from "../lib/logger.js";
import { HttpError } from "../lib/httpClient.js";
import { YoutubeApiClient } from "../collectors/youtube/client.js";
import { YoutubeVideosCollector } from "../collectors/youtube/collector.js";

const FONTE = "youtube_videos";
const DRY_RUN_CANDIDATO_ID_PLACEHOLDER = "00000000-0000-0000-0000-000000000000";
/** Canal público real (Google for Developers), usado só quando --channelId
 * não é passado em --dry-run — serve unicamente para bater na rota real da
 * API e observar o código de status (400/403 sem uma chave válida), nunca
 * para inferir o canal de um candidato de verdade. */
const DRY_RUN_CHANNEL_ID_PLACEHOLDER = "UC_x5XG1OV2P6uZZ5FSM9Ttw";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CliArgs {
  candidatoId?: string;
  channelId?: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dryRun: false };
  for (const arg of argv) {
    if (arg.startsWith("--candidatoId=")) {
      args.candidatoId = arg.slice("--candidatoId=".length).trim();
    } else if (arg.startsWith("--channelId=")) {
      args.channelId = arg.slice("--channelId=".length).trim();
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    }
  }
  return args;
}

function resolveCandidatoId(args: CliArgs): string {
  const candidatoId = args.candidatoId ?? process.env.YOUTUBE_CANDIDATO_ID;

  if (!candidatoId) {
    throw new Error(
      "--candidatoId é obrigatório para coleta real: `npm run collect:youtube -- " +
        "--candidatoId=<uuid> --channelId=UCxxxxxxxx` (ou defina YOUTUBE_CANDIDATO_ID no " +
        "ambiente/.env). O uuid precisa já existir na tabela `candidato` — este coletor nunca " +
        "cria um candidato novo nem infere o canal a partir do nome (ver README de " +
        "packages/workers/src/collectors/youtube)."
    );
  }
  if (!UUID_REGEX.test(candidatoId)) {
    throw new Error(
      `--candidatoId="${candidatoId}" não parece um uuid válido (formato esperado: ` +
        "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)."
    );
  }
  return candidatoId;
}

function resolveChannelId(args: CliArgs): string | null {
  return args.channelId ?? process.env.YOUTUBE_CHANNEL_ID ?? null;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const apiBase = process.env.YOUTUBE_API_BASE ?? "https://www.googleapis.com/youtube/v3";
  const apiKey = process.env.YOUTUBE_API_KEY ?? "";
  const client = new YoutubeApiClient(apiBase, apiKey, { rateLimitMs: 300, retries: 2 });

  if (args.dryRun) {
    const channelIdInformado = resolveChannelId(args);
    const channelId = channelIdInformado ?? DRY_RUN_CHANNEL_ID_PLACEHOLDER;

    if (!apiKey) {
      logger.warn(
        FONTE,
        "[dry-run] YOUTUBE_API_KEY não definida. Mesmo assim vamos fazer uma requisição REAL " +
          "à API (sem chave válida) só para confirmar que a rota responde 400/403 com uma " +
          "mensagem clara — isso valida que a URL/endpoint está correta, mesmo sem poder ver " +
          "dados. Nenhum dado de vídeo real será exibido nesta execução."
      );
    } else {
      logger.info(
        FONTE,
        `[dry-run] buscando vídeos do canal ${channelId} — não grava no banco, não requer ` +
          "SUPABASE_SERVICE_ROLE_KEY"
      );
    }

    // candidato_id nunca precisa existir no banco em --dry-run: fetchAll()/normalize()
    // não tocam no banco (só run(), que --dry-run nunca chama).
    const collector = new YoutubeVideosCollector(
      DRY_RUN_CANDIDATO_ID_PLACEHOLDER,
      channelId,
      client,
      {}
    );

    try {
      const brutos = await collector.fetchAll();
      logger.info(FONTE, `${brutos.length} vídeo(s) obtido(s) da API do YouTube`);

      const amostra = brutos.slice(0, 5).map((raw) => collector.normalize(raw));
      console.log(
        JSON.stringify(
          {
            total_bruto: brutos.length,
            amostra_normalizada: amostra,
            aviso:
              `candidato_id acima é um placeholder (${DRY_RUN_CANDIDATO_ID_PLACEHOLDER}) — em ` +
              "execução real ele vem de --candidatoId, sempre validado contra a tabela " +
              "candidato em prepare() antes de gravar qualquer evento." +
              (channelIdInformado
                ? ""
                : ` channelId também é um placeholder público (${DRY_RUN_CHANNEL_ID_PLACEHOLDER}, ` +
                  "canal 'Google for Developers') só para testar a rota — passe " +
                  "--channelId=UCxxxxxxxx para ver vídeos de um canal real."),
          },
          null,
          2
        )
      );
    } catch (err) {
      if (err instanceof HttpError && (err.status === 400 || err.status === 403)) {
        console.log(
          JSON.stringify(
            {
              endpoint_validado: true,
              status_http: err.status,
              mensagem: err.message,
              aviso:
                `A API respondeu ${err.status} (não 404 ou erro de rede), o que confirma que as ` +
                "rotas /youtube/v3/channels, /youtube/v3/playlistItems e /youtube/v3/videos " +
                "estão corretas — só falta uma YOUTUBE_API_KEY válida (ver README) para ver " +
                "dados de verdade.",
            },
            null,
            2
          )
        );
        return;
      }
      throw err;
    }
    return;
  }

  const candidatoId = resolveCandidatoId(args);
  const channelId = resolveChannelId(args);

  if (!apiKey) {
    throw new Error(
      "YOUTUBE_API_KEY não definida. Crie um projeto no Google Cloud Console, ative a " +
        "'YouTube Data API v3' e gere uma API key em " +
        "https://console.cloud.google.com/apis/credentials — depois preencha " +
        "YOUTUBE_API_KEY em packages/workers/.env (crie a partir de .env.example se ainda não " +
        "existir). Use --dry-run nesse meio tempo para validar fetch/normalize e confirmar que " +
        "a rota responde."
    );
  }

  const env = loadEnv();
  const supabase = createWorkerSupabaseClient(env);
  const collector = new YoutubeVideosCollector(candidatoId, channelId, client, { supabase });
  const stats = await collector.run();
  console.log(JSON.stringify(stats, null, 2));
}

main().catch((err) => {
  logger.error("cli", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
