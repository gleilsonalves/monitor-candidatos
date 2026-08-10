import { loadEnv } from "../lib/env.js";
import { createWorkerSupabaseClient } from "../lib/supabaseClient.js";
import { logger } from "../lib/logger.js";
import { HttpError } from "../lib/httpClient.js";
import { PortalTransparenciaApiClient } from "../collectors/transparencia/client.js";
import { TransparenciaSancoesCollector } from "../collectors/transparencia/collector.js";

const FONTE = "transparencia_sancoes";
const DRY_RUN_CANDIDATO_ID_PLACEHOLDER = "00000000-0000-0000-0000-000000000000";
/** CPF de teste (dígitos zerados) usado só quando --cpf não é passado em
 * --dry-run — serve unicamente para bater na rota real da API e observar o
 * código de status (401/403 sem chave), nunca para inferir dado de verdade. */
const DRY_RUN_CPF_PLACEHOLDER = "00000000000";

interface CliArgs {
  idCamara?: number;
  cpf?: string;
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
    } else if (arg.startsWith("--cpf=")) {
      args.cpf = arg.slice("--cpf=".length).trim();
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    }
  }
  return args;
}

function resolveIdCamara(args: CliArgs): number {
  const fromEnv = process.env.TRANSPARENCIA_ID_CAMARA
    ? Number(process.env.TRANSPARENCIA_ID_CAMARA)
    : undefined;
  const idCamara = args.idCamara ?? fromEnv;

  if (!idCamara || Number.isNaN(idCamara) || idCamara <= 0) {
    throw new Error(
      "Informe o id_camara do candidato: `npm run collect:transparencia -- --idCamara=204554 " +
        "--cpf=12345678900` (ou defina TRANSPARENCIA_ID_CAMARA no ambiente/.env). O id_camara " +
        "precisa já existir na tabela `candidato` — este coletor nunca cria um candidato novo " +
        "nem resolve por nome (ver README de packages/workers/src/collectors/transparencia)."
    );
  }
  return idCamara;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const idCamara = resolveIdCamara(args);

  const apiBase =
    process.env.PORTAL_TRANSPARENCIA_API_BASE ?? "https://api.portaldatransparencia.gov.br/api-de-dados";
  const apiKey = process.env.PORTAL_TRANSPARENCIA_API_KEY ?? "";
  const client = new PortalTransparenciaApiClient(apiBase, apiKey, { rateLimitMs: 500, retries: 2 });

  if (args.dryRun) {
    const cpf = args.cpf ?? DRY_RUN_CPF_PLACEHOLDER;

    if (!apiKey) {
      logger.warn(
        FONTE,
        "[dry-run] PORTAL_TRANSPARENCIA_API_KEY não definida. Mesmo assim vamos fazer uma " +
          "requisição REAL à API (sem chave) só para confirmar que a rota responde 401/403 " +
          "— isso valida que a URL/endpoint está correta, mesmo sem poder ver dados. Nenhum " +
          "dado de sanção real será exibido nesta execução."
      );
    } else {
      logger.info(
        FONTE,
        `[dry-run] buscando sanções (CEIS/CNEP) para cpf informado — não grava no banco, ` +
          "não requer SUPABASE_SERVICE_ROLE_KEY"
      );
    }

    const collector = new TransparenciaSancoesCollector(idCamara, cpf, client, {});
    collector.definirCandidatoParaInspecao(DRY_RUN_CANDIDATO_ID_PLACEHOLDER);

    try {
      const brutos = await collector.fetchAll();
      logger.info(FONTE, `${brutos.length} registro(s) obtido(s) da API (CEIS + CNEP)`);

      const amostra = brutos.slice(0, 5).map((raw) => collector.normalize(raw));
      console.log(
        JSON.stringify(
          {
            total_bruto: brutos.length,
            amostra_normalizada: amostra,
            aviso:
              `candidato_id acima é um placeholder (${DRY_RUN_CANDIDATO_ID_PLACEHOLDER}) — ` +
              "em execução real ele vem da resolução determinística por id_camara. O CPF usado " +
              "nesta consulta nunca é gravado no banco (só o resultado da API, que já vem " +
              "mascarado em pessoa.cpfFormatado).",
          },
          null,
          2
        )
      );
    } catch (err) {
      if (err instanceof HttpError && (err.status === 401 || err.status === 403)) {
        console.log(
          JSON.stringify(
            {
              endpoint_validado: true,
              status_http: err.status,
              mensagem: err.message,
              aviso:
                `A API respondeu ${err.status} (não ${404} ou erro de rede), o que confirma que ` +
                "a rota /api-de-dados/ceis e /api-de-dados/cnep está correta — só falta uma " +
                "PORTAL_TRANSPARENCIA_API_KEY válida (ver README) para ver dados de verdade.",
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

  if (!args.cpf) {
    throw new Error(
      "--cpf é obrigatório para coleta real (não é lido do banco nem inferido por nome — " +
        "ver README de packages/workers/src/collectors/transparencia, seção 'Entity resolution'). " +
        "Ex: `npm run collect:transparencia -- --idCamara=204554 --cpf=12345678900`"
    );
  }
  if (!apiKey) {
    throw new Error(
      "PORTAL_TRANSPARENCIA_API_KEY não definida. Cadastre um e-mail gratuitamente em " +
        "http://www.portaldatransparencia.gov.br/api-de-dados/cadastrar-email e preencha a " +
        "chave recebida em packages/workers/.env (ver .env.example). Use --dry-run nesse meio " +
        "tempo para validar fetch/normalize e confirmar que a rota responde."
    );
  }

  const env = loadEnv();
  const supabase = createWorkerSupabaseClient(env);
  const collector = new TransparenciaSancoesCollector(idCamara, args.cpf, client, { supabase });
  const stats = await collector.run();
  console.log(JSON.stringify(stats, null, 2));
}

main().catch((err) => {
  logger.error("cli", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
