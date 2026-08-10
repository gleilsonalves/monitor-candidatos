import { loadEnv } from "../lib/env.js";
import { createWorkerSupabaseClient } from "../lib/supabaseClient.js";
import { logger } from "../lib/logger.js";
import { TseApiClient } from "../collectors/tse/client.js";
import { TseCandidaturaCollector } from "../collectors/tse/collector.js";

const FONTE = "tse_candidatura";
const DRY_RUN_CANDIDATO_ID_PLACEHOLDER = "00000000-0000-0000-0000-000000000000";

interface CliArgs {
  ano?: number;
  dryRun: boolean;
  nomeUrna?: string;
  uf?: string;
  partido?: string;
  cargo?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dryRun: false };
  for (const arg of argv) {
    if (arg.startsWith("--ano=")) {
      const value = Number(arg.split("=")[1]);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`--ano inválido: "${arg}" (esperado um ano, ex: 2026)`);
      }
      args.ano = value;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg.startsWith("--nomeUrna=")) {
      args.nomeUrna = arg.slice("--nomeUrna=".length);
    } else if (arg.startsWith("--uf=")) {
      args.uf = arg.slice("--uf=".length).toUpperCase();
    } else if (arg.startsWith("--partido=")) {
      args.partido = arg.slice("--partido=".length).toUpperCase();
    } else if (arg.startsWith("--cargo=")) {
      args.cargo = arg.slice("--cargo=".length);
    }
  }
  return args;
}

function resolveAno(args: CliArgs): number {
  const fromEnv = process.env.TSE_ANO_ELEICAO ? Number(process.env.TSE_ANO_ELEICAO) : undefined;
  // 2026 é o ciclo eleitoral geral corrente (eleição em 04/10/2026) — ver
  // README.md desta pasta para a decisão de usar 2026 como default mesmo com
  // o período de registro de candidaturas ainda em andamento na data em que
  // este coletor foi escrito (10/08/2026).
  return args.ano ?? fromEnv ?? 2026;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const ano = resolveAno(args);
  const tseApiBase =
    process.env.TSE_API_BASE ?? "https://divulgacandcontas.tse.jus.br/divulga/rest/v1";
  const client = new TseApiClient(tseApiBase, { rateLimitMs: 400, retries: 2 });

  if (args.dryRun) {
    // amostra default: um dos 8 candidatos seed (Adail Filho, deputado
    // federal reeleito pelo AM/MDB) confirmado com candidatura registrada em
    // 2026 na validação manual deste coletor — ver README.md.
    const nomeUrna = args.nomeUrna ?? "Adail Filho";
    const uf = args.uf ?? "AM";
    const partido = args.partido ?? "MDB";
    const cargo = args.cargo ?? "Deputado Federal";

    logger.info(
      FONTE,
      `[dry-run] validando fetch/normalize para "${nomeUrna}" (${uf}/${partido}, ${cargo}, ` +
        `ano=${ano}) via API pública do TSE — não grava no banco, não requer ` +
        "SUPABASE_SERVICE_ROLE_KEY"
    );

    const collector = new TseCandidaturaCollector(ano, client, {});
    const podeContinuar = await collector.definirAlvoParaInspecao(DRY_RUN_CANDIDATO_ID_PLACEHOLDER, {
      nome_urna: nomeUrna,
      uf,
      partido_atual: partido,
      cargo_pretendido: cargo,
    });

    if (!podeContinuar) {
      console.log(
        JSON.stringify(
          {
            aviso:
              "não foi possível resolver a eleição/cargo para os parâmetros informados — veja os " +
              "logs de warn acima (ano sem 'Eleição Geral Federal' no TSE, ou cargo não mapeável)",
          },
          null,
          2
        )
      );
      return;
    }

    const brutos = await collector.fetchAll();
    logger.info(FONTE, `${brutos.length} registro(s) bruto(s) obtido(s) da API do TSE`);

    const amostra = brutos.map((raw) => collector.normalize(raw));
    console.log(
      JSON.stringify(
        {
          ano,
          total_bruto: brutos.length,
          eventos_normalizados: amostra,
          aviso:
            `candidato_id acima é um placeholder (${DRY_RUN_CANDIDATO_ID_PLACEHOLDER}) — em execução ` +
            "real ele vem do match forte (nome normalizado + UF + partido) contra a tabela `candidato`. " +
            (brutos.length === 0
              ? "Nenhum registro encontrado: ou o candidato ainda não registrou candidatura no TSE " +
                "para este ano, ou os parâmetros (nome/UF/partido) não batem com nenhum registro."
              : ""),
        },
        null,
        2
      )
    );
    return;
  }

  const env = loadEnv();
  const supabase = createWorkerSupabaseClient(env);
  const collector = new TseCandidaturaCollector(ano, client, { supabase });
  const stats = await collector.run();
  console.log(JSON.stringify(stats, null, 2));
}

main().catch((err) => {
  logger.error("cli", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
