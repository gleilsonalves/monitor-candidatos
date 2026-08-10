import { loadEnv } from "../lib/env.js";
import { createWorkerSupabaseClient } from "../lib/supabaseClient.js";
import { logger } from "../lib/logger.js";
import { TcuCertidoesApiClient } from "../collectors/tcu/client.js";
import { TcuIntegridadeCollector } from "../collectors/tcu/collector.js";

const FONTE = "tcu_integridade";
const DRY_RUN_CANDIDATO_ID_PLACEHOLDER = "00000000-0000-0000-0000-000000000000";
/** CPF de teste (dígitos zerados) usado só quando --cpf não é passado em
 * --dry-run — nunca retorna resultado real, serve só para exercitar
 * fetch/normalize contra a API real. */
const DRY_RUN_CPF_PLACEHOLDER = "00000000000";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CliArgs {
  candidatoId?: string;
  cpf?: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dryRun: false };
  for (const arg of argv) {
    if (arg.startsWith("--candidatoId=")) {
      args.candidatoId = arg.slice("--candidatoId=".length).trim();
    } else if (arg.startsWith("--cpf=")) {
      args.cpf = arg.slice("--cpf=".length).trim();
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const apiBase = process.env.TCU_CERTIDOES_API_BASE ?? "https://certidoes.apps.tcu.gov.br/api/publico";
  const client = new TcuCertidoesApiClient(apiBase, { rateLimitMs: 500, retries: 2 });

  if (args.dryRun) {
    const candidatoId = args.candidatoId ?? DRY_RUN_CANDIDATO_ID_PLACEHOLDER;
    const cpf = args.cpf ?? DRY_RUN_CPF_PLACEHOLDER;

    logger.info(
      FONTE,
      "[dry-run] buscando contas irregulares e inabilitados no TCU para o cpf informado — " +
        "não grava no banco, não requer SUPABASE_SERVICE_ROLE_KEY"
    );

    const collector = new TcuIntegridadeCollector(candidatoId, cpf, client, {});

    const brutos = await collector.fetchAll();
    logger.info(
      FONTE,
      `${brutos.length} registro(s) obtido(s) da API do TCU (contas irregulares + inabilitados)`
    );

    const amostra = brutos.slice(0, 5).map((raw) => collector.normalize(raw));
    console.log(
      JSON.stringify(
        {
          total_bruto: brutos.length,
          amostra_normalizada: amostra,
          aviso: args.candidatoId
            ? "candidato_id acima é o valor informado via --candidatoId (real)."
            : `candidato_id acima é um placeholder (${DRY_RUN_CANDIDATO_ID_PLACEHOLDER}) — em execução ` +
              "real, informe --candidatoId=<uuid> de um candidato já cadastrado em `candidato`. O CPF " +
              "usado nesta consulta nunca é gravado no banco (só o resultado da API, que já vem " +
              "mascarado em numeroRegistro).",
        },
        null,
        2
      )
    );
    return;
  }

  if (!args.candidatoId || !UUID_RE.test(args.candidatoId)) {
    throw new Error(
      "--candidatoId=<uuid> é obrigatório para coleta real e precisa ser o UUID de um candidato " +
        "já cadastrado em `candidato` (este coletor nunca cria um candidato novo nem resolve por " +
        "nome). Ex: `npm run collect:tcu -- --candidatoId=11111111-1111-1111-1111-111111111111 " +
        "--cpf=12345678900`"
    );
  }
  if (!args.cpf) {
    throw new Error(
      "--cpf é obrigatório para coleta real (não é lido do banco nem inferido por nome — ver " +
        "README de packages/workers/src/collectors/tcu, seção 'Entity resolution'). " +
        `Ex: npm run collect:tcu -- --candidatoId=${args.candidatoId} --cpf=12345678900`
    );
  }

  const env = loadEnv();
  const supabase = createWorkerSupabaseClient(env);
  const collector = new TcuIntegridadeCollector(args.candidatoId, args.cpf, client, { supabase });
  const stats = await collector.run();
  console.log(JSON.stringify(stats, null, 2));
}

main().catch((err) => {
  logger.error("cli", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
