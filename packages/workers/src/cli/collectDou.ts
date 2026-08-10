import { loadEnv } from "../lib/env.js";
import { createWorkerSupabaseClient } from "../lib/supabaseClient.js";
import { logger } from "../lib/logger.js";
import { DouApiClient } from "../collectors/dou/client.js";
import { DouAtosPessoalCollector } from "../collectors/dou/collector.js";

const FONTE = "dou_atos_pessoal";
const DRY_RUN_CANDIDATO_ID_PLACEHOLDER = "00000000-0000-0000-0000-000000000000";
const DATA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

interface CliArgs {
  candidatoId?: string;
  dataInicio?: string;
  dataFim?: string;
  dryRun: boolean;
  /** Só usado em --dry-run: nome a buscar quando não há candidato_id (ou candidato) real para inspecionar. */
  nome?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dryRun: false };
  for (const arg of argv) {
    if (arg.startsWith("--candidatoId=")) {
      args.candidatoId = arg.slice("--candidatoId=".length);
    } else if (arg.startsWith("--dataInicio=")) {
      const value = arg.slice("--dataInicio=".length);
      if (!DATA_REGEX.test(value)) {
        throw new Error(`--dataInicio inválido: "${value}" (esperado YYYY-MM-DD)`);
      }
      args.dataInicio = value;
    } else if (arg.startsWith("--dataFim=")) {
      const value = arg.slice("--dataFim=".length);
      if (!DATA_REGEX.test(value)) {
        throw new Error(`--dataFim inválido: "${value}" (esperado YYYY-MM-DD)`);
      }
      args.dataFim = value;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg.startsWith("--nome=")) {
      args.nome = arg.slice("--nome=".length);
    }
  }

  if ((args.dataInicio && !args.dataFim) || (!args.dataInicio && args.dataFim)) {
    throw new Error("--dataInicio e --dataFim precisam ser informados juntos (ou nenhum dos dois)");
  }

  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const douApiBase = process.env.DOU_API_BASE ?? "https://www.in.gov.br/consulta/-/buscar/dou";
  const client = new DouApiClient(douApiBase, { rateLimitMs: 600, retries: 2 });

  if (args.dryRun) {
    // Amostra default: "Camilo Santana" — validado em 10/08/2026 contra a busca real do DOU (retorna
    // atos de pessoal do Senado Federal mencionando o nome). Não precisa ser um candidato do banco:
    // --dry-run só chama fetch/normalize, nunca prepare() (ver README desta pasta).
    const nome = args.nome ?? "Camilo Santana";

    logger.info(
      FONTE,
      `[dry-run] buscando "${nome}" no DOU real (in.gov.br) — não grava no banco, não requer ` +
        "SUPABASE_SERVICE_ROLE_KEY",
      { dataInicio: args.dataInicio, dataFim: args.dataFim }
    );

    const collector = new DouAtosPessoalCollector(
      DRY_RUN_CANDIDATO_ID_PLACEHOLDER,
      client,
      args.dataInicio,
      args.dataFim,
      {}
    );
    collector.definirCandidatoParaInspecao(DRY_RUN_CANDIDATO_ID_PLACEHOLDER, nome);

    const brutos = await collector.fetchAll();
    logger.info(FONTE, `${brutos.length} artigo(s) do DOU encontrado(s) mencionando "${nome}"`);

    const amostra = brutos.map((raw) => ({
      urlTitle: raw.artigo.urlTitle,
      artType: raw.artigo.artType,
      pubDate: raw.artigo.pubDate,
      evento_normalizado: collector.normalize(raw),
    }));

    console.log(
      JSON.stringify(
        {
          nomeBuscado: nome,
          total_bruto: brutos.length,
          total_classificado_como_nomeacao_ou_exoneracao: amostra.filter((a) => a.evento_normalizado).length,
          amostra,
          aviso:
            `candidato_id acima é um placeholder (${DRY_RUN_CANDIDATO_ID_PLACEHOLDER}) — em execução ` +
            "real ele vem de --candidatoId, resolvido contra a tabela `candidato` em prepare(). A busca " +
            "do DOU é por NOME (sem CPF/ID único nos atos publicados) — confiança de entity resolution " +
            "menor que Câmara/TSE. Ver README.md em src/collectors/dou/ para a discussão completa e um " +
            "falso positivo real encontrado durante a validação deste coletor.",
        },
        null,
        2
      )
    );
    return;
  }

  if (!args.candidatoId) {
    throw new Error(
      "Informe --candidatoId=<uuid> (o candidato precisa já existir na tabela `candidato`, com " +
        "nome_civil preenchido — este coletor busca no DOU pelo nome_civil). Para validar sem banco, " +
        "use --dry-run (opcionalmente com --nome=\"Fulano de Tal\")."
    );
  }

  const env = loadEnv();
  const supabase = createWorkerSupabaseClient(env);
  const collector = new DouAtosPessoalCollector(args.candidatoId, client, args.dataInicio, args.dataFim, {
    supabase,
  });
  const stats = await collector.run();
  console.log(JSON.stringify(stats, null, 2));
}

main().catch((err) => {
  logger.error("cli", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
