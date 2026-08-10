import { loadEnv } from "../lib/env.js";
import { createWorkerSupabaseClient } from "../lib/supabaseClient.js";
import { logger } from "../lib/logger.js";
import { HttpError } from "../lib/httpClient.js";
import { DatajudApiClient, TRIBUNAIS_VALIDOS, numeroProcessoValido } from "../collectors/datajud/client.js";
import { DatajudProcessoCollector } from "../collectors/datajud/collector.js";

const FONTE = "datajud_processos";
const DRY_RUN_CANDIDATO_ID_PLACEHOLDER = "00000000-0000-0000-0000-000000000000";
/** numeroProcesso de teste (dígitos zerados, formato válido de 20 dígitos)
 * usado só quando --numeroProcesso não é passado em --dry-run — serve
 * unicamente para bater na rota real da API e observar o código de status
 * (401/403 sem chave), nunca para inferir dado de verdade. */
const DRY_RUN_NUMERO_PROCESSO_PLACEHOLDER = "00000000000000000000";
const DRY_RUN_TRIBUNAL_PLACEHOLDER = "tjsp";

interface CliArgs {
  candidatoId?: string;
  numeroProcesso?: string;
  tribunal?: string;
  fonteUrl?: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dryRun: false };
  for (const arg of argv) {
    if (arg.startsWith("--candidatoId=")) {
      args.candidatoId = arg.slice("--candidatoId=".length).trim();
    } else if (arg.startsWith("--numeroProcesso=")) {
      args.numeroProcesso = arg.slice("--numeroProcesso=".length).trim();
    } else if (arg.startsWith("--tribunal=")) {
      args.tribunal = arg.slice("--tribunal=".length).trim().toLowerCase();
    } else if (arg.startsWith("--fonteUrl=")) {
      args.fonteUrl = arg.slice("--fonteUrl=".length).trim();
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const apiBase = process.env.DATAJUD_API_BASE ?? "https://api-publica.datajud.cnj.jus.br";
  const apiKey = process.env.DATAJUD_API_KEY ?? "";
  const client = new DatajudApiClient(apiBase, apiKey, { rateLimitMs: 500, retries: 2 });

  if (args.dryRun) {
    const numeroProcesso = args.numeroProcesso ?? DRY_RUN_NUMERO_PROCESSO_PLACEHOLDER;
    const tribunal = args.tribunal ?? DRY_RUN_TRIBUNAL_PLACEHOLDER;

    if (args.tribunal && !TRIBUNAIS_VALIDOS.includes(args.tribunal)) {
      throw new Error(
        `--tribunal="${args.tribunal}" não é um alias reconhecido. Exemplos válidos: tjsp, tjrj, ` +
          "trf1, tse, stj, trt2, tre-sp. Lista completa em src/collectors/datajud/client.ts."
      );
    }
    if (args.numeroProcesso && !numeroProcessoValido(args.numeroProcesso)) {
      throw new Error(
        `--numeroProcesso="${args.numeroProcesso}" inválido — esperado 20 dígitos (numeração ` +
          'única CNJ), ex: "0000832-35.2018.4.01.3202" ou "00008323520184013202".'
      );
    }

    if (!apiKey) {
      logger.warn(
        FONTE,
        "[dry-run] DATAJUD_API_KEY não definida. Mesmo assim vamos fazer uma requisição REAL à " +
          "API (sem chave) só para confirmar que a rota responde 401/403 — isso valida que a " +
          "URL/endpoint está correta, mesmo sem poder ver dados. Nenhum dado de processo real " +
          "será exibido nesta execução."
      );
    } else {
      logger.info(
        FONTE,
        `[dry-run] buscando processo numeroProcesso=${numeroProcesso} em tribunal=${tribunal} — ` +
          "não grava no banco, não requer SUPABASE_SERVICE_ROLE_KEY"
      );
    }

    const collector = new DatajudProcessoCollector(
      DRY_RUN_CANDIDATO_ID_PLACEHOLDER,
      numeroProcesso,
      tribunal,
      client,
      args.fonteUrl,
      {}
    );
    collector.definirCandidatoParaInspecao(DRY_RUN_CANDIDATO_ID_PLACEHOLDER);

    try {
      const brutos = await collector.fetchAll();
      logger.info(FONTE, `${brutos.length} registro(s) obtido(s) da API (0 ou 1 processo)`);

      const amostra = brutos.map((raw) => collector.normalize(raw));
      console.log(
        JSON.stringify(
          {
            total_bruto: brutos.length,
            amostra_normalizada: amostra,
            aviso:
              `candidato_id acima é um placeholder (${DRY_RUN_CANDIDATO_ID_PLACEHOLDER}) — em ` +
              "execução real ele vem da resolução determinística por id exato na tabela " +
              "candidato. amostra_normalizada[0] pode ser null: é o comportamento ESPERADO " +
              "quando o processo não é encontrado ou quando nenhum movimento mapeia com " +
              "confiança para um estagio_juridico (ver src/collectors/datajud/mapaMovimentacao.ts) " +
              "— nunca inventamos uma correspondência.",
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
                `A API respondeu ${err.status} (não 404 ou erro de rede), o que confirma que a ` +
                `rota /api_publica_${tribunal}/_search está correta — só falta uma DATAJUD_API_KEY ` +
                "válida (ver README) para ver dados de verdade.",
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

  if (!args.candidatoId) {
    throw new Error(
      "--candidatoId é obrigatório (uuid já existente na tabela candidato). Ex: " +
        "`npm run collect:datajud -- --candidatoId=<uuid> --numeroProcesso=0000832-35.2018.4.01.3202 --tribunal=trf1`"
    );
  }
  if (!args.numeroProcesso || !numeroProcessoValido(args.numeroProcesso)) {
    throw new Error(
      "--numeroProcesso é obrigatório e precisa ter 20 dígitos (numeração única CNJ) — nunca é " +
        "inferido nem lido do banco (ver README de src/collectors/datajud, seção 'Entity " +
        'resolution\'). Ex: --numeroProcesso="0000832-35.2018.4.01.3202"'
    );
  }
  if (!args.tribunal || !TRIBUNAIS_VALIDOS.includes(args.tribunal)) {
    throw new Error(
      '--tribunal é obrigatório (alias do tribunal de origem, ex: "tjsp", "trf1", "tse"). Lista ' +
        "completa em src/collectors/datajud/client.ts (TRIBUNAIS_VALIDOS)."
    );
  }
  if (!apiKey) {
    throw new Error(
      "DATAJUD_API_KEY não definida. A API Pública do DataJud usa uma CHAVE PÚBLICA compartilhada " +
        "(não é um cadastro individual) mantida pelo CNJ e publicada em " +
        "https://datajud-wiki.cnj.jus.br/api-publica/acesso/ — copie a chave vigente de lá para " +
        "DATAJUD_API_KEY em packages/workers/.env (ver .env.example). Use --dry-run nesse meio " +
        "tempo para validar fetch/normalize e confirmar que a rota responde."
    );
  }

  const env = loadEnv();
  const supabase = createWorkerSupabaseClient(env);
  const collector = new DatajudProcessoCollector(
    args.candidatoId,
    args.numeroProcesso,
    args.tribunal,
    client,
    args.fonteUrl,
    { supabase }
  );
  const stats = await collector.run();
  console.log(JSON.stringify(stats, null, 2));
}

main().catch((err) => {
  logger.error("cli", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
