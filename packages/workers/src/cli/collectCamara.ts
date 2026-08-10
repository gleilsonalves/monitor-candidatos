import { loadEnv } from "../lib/env.js";
import { createWorkerSupabaseClient } from "../lib/supabaseClient.js";
import { logger } from "../lib/logger.js";
import { CamaraApiClient } from "../collectors/camara/client.js";
import { CamaraProposicoesCollector } from "../collectors/camara/collector.js";

const FONTE = "camara_proposicoes";
const DRY_RUN_CANDIDATO_ID_PLACEHOLDER = "00000000-0000-0000-0000-000000000000";

interface CliArgs {
  idCamara?: number;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dryRun: false };
  for (const arg of argv) {
    if (arg.startsWith("--idCamara=")) {
      const value = Number(arg.split("=")[1]);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`--idCamara inválido: "${arg}" (esperado um inteiro positivo)`);
      }
      args.idCamara = value;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    }
  }
  return args;
}

function resolveIdCamara(args: CliArgs): number {
  const fromEnv = process.env.CAMARA_ID_DEPUTADO
    ? Number(process.env.CAMARA_ID_DEPUTADO)
    : undefined;
  const idCamara = args.idCamara ?? fromEnv;

  if (!idCamara || Number.isNaN(idCamara) || idCamara <= 0) {
    throw new Error(
      "Informe o id_camara do deputado: `npm run collect:camara -- --idCamara=204554` " +
        "(ou defina CAMARA_ID_DEPUTADO no ambiente/.env). O id_camara precisa já existir " +
        "na tabela `candidato` — este coletor nunca cria um candidato novo."
    );
  }
  return idCamara;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const idCamara = resolveIdCamara(args);
  const camaraApiBase =
    process.env.CAMARA_API_BASE ?? "https://dadosabertos.camara.leg.br/api/v2";
  const client = new CamaraApiClient(camaraApiBase, { rateLimitMs: 300, retries: 2 });

  if (args.dryRun) {
    logger.info(
      FONTE,
      `[dry-run] buscando proposições de idCamara=${idCamara} — não grava no banco, ` +
        "não requer SUPABASE_SERVICE_ROLE_KEY"
    );

    const collector = new CamaraProposicoesCollector(idCamara, client, {});
    collector.definirCandidatoParaInspecao(DRY_RUN_CANDIDATO_ID_PLACEHOLDER);

    const brutos = await collector.fetchAll();
    logger.info(FONTE, `${brutos.length} proposição(ões) obtida(s) da API da Câmara`);

    const amostra = brutos.slice(0, 5).map((raw) => collector.normalize(raw));
    console.log(
      JSON.stringify(
        {
          total_bruto: brutos.length,
          amostra_normalizada: amostra,
          aviso: `candidato_id acima é um placeholder (${DRY_RUN_CANDIDATO_ID_PLACEHOLDER}) — ` +
            "em execução real ele vem da resolução determinística por id_camara",
        },
        null,
        2
      )
    );
    return;
  }

  const env = loadEnv();
  const supabase = createWorkerSupabaseClient(env);
  const collector = new CamaraProposicoesCollector(idCamara, client, { supabase });
  const stats = await collector.run();
  console.log(JSON.stringify(stats, null, 2));
}

main().catch((err) => {
  logger.error("cli", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
