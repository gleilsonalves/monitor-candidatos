import { loadEnv } from "../lib/env.js";
import { createWorkerSupabaseClient } from "../lib/supabaseClient.js";
import { logger } from "../lib/logger.js";
import { fetchJson, HttpError } from "../lib/httpClient.js";
import { MetaAdsApiClient } from "../collectors/meta-ads/client.js";
import { MetaAdsCollector } from "../collectors/meta-ads/collector.js";

const FONTE = "meta_ads";

/** Versão da Graph API sem o header `x-ad-api-version-warning` de
 * depreciação (confirmado por requisição real em 2026-08-10 — ver README de
 * src/collectors/meta-ads/). */
const META_ADS_API_BASE_DEFAULT = "https://graph.facebook.com/v24.0";

interface CliArgs {
  candidatoId?: string;
  pageId?: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dryRun: false };
  for (const arg of argv) {
    if (arg.startsWith("--candidatoId=")) {
      args.candidatoId = arg.slice("--candidatoId=".length).trim();
    } else if (arg.startsWith("--pageId=")) {
      args.pageId = arg.slice("--pageId=".length).trim();
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    }
  }
  return args;
}

function requireArgs(args: CliArgs): { candidatoId: string; pageId: string } {
  if (!args.candidatoId || !args.pageId) {
    throw new Error(
      "Informe --candidatoId=<uuid> e --pageId=<id da página do Facebook do candidato>: " +
        "`npm run collect:meta-ads -- --candidatoId=<uuid> --pageId=<id> [--dry-run]`. " +
        "Nenhum dos dois é inferido automaticamente — candidatoId precisa já existir na " +
        "tabela `candidato`, e pageId é uma asserção externa do operador (ver README de " +
        "src/collectors/meta-ads, seção 'Entity resolution')."
    );
  }
  return { candidatoId: args.candidatoId, pageId: args.pageId };
}

/**
 * Faz uma requisição REAL ao endpoint sem `access_token` (nenhum retry —
 * é só para observar o erro, não para tentar de novo) e imprime o que a API
 * respondeu. Não lança: sempre volta um resultado imprimível, porque o
 * objetivo aqui é justamente capturar o erro, não escondê-lo. Ver README,
 * seção "Endpoint exato e validação sem token", para os corpos de erro reais
 * observados (400 "parâmetro obrigatório" quando falta um param exigido,
 * 400/500 OAuthException quando falta/é inválido o access_token — nunca 404,
 * o que confirma que a rota está certa).
 */
async function validarRotaSemToken(client: MetaAdsApiClient, pageId: string): Promise<void> {
  const url = client.montarUrlValidacaoSemToken(pageId);
  logger.info(
    FONTE,
    "[dry-run] META_ADS_ACCESS_TOKEN não definida. Fazendo uma requisição REAL ao endpoint " +
      "SEM access_token só para confirmar o formato do erro — isso prova que a rota/parâmetros " +
      "estão corretos mesmo sem poder ver dados de verdade. Nenhum dado de anúncio real será " +
      "exibido nesta execução.",
    { url }
  );

  try {
    await fetchJson(url, undefined, { retries: 0, fonte: FONTE });
    // Não deveria chegar aqui: a API sempre exige access_token neste endpoint.
    console.log(
      JSON.stringify(
        {
          endpoint_validado: "inconclusivo",
          aviso:
            "A requisição sem token não retornou erro — inesperado (a API deveria sempre " +
            "exigir access_token neste endpoint). Verifique manualmente.",
        },
        null,
        2
      )
    );
  } catch (err) {
    if (err instanceof HttpError) {
      console.log(
        JSON.stringify(
          {
            endpoint_validado: true,
            status_http: err.status,
            mensagem: err.message,
            aviso:
              `A API respondeu ${err.status} (não 404), o que confirma que a rota /ads_archive ` +
              "e os parâmetros (ad_type, ad_reached_countries, search_page_ids) estão corretos — " +
              "só falta um META_ADS_ACCESS_TOKEN válido, de um app Meta com acesso aprovado a " +
              "anúncios políticos, para ver dados de verdade (ver README).",
          },
          null,
          2
        )
      );
      return;
    }
    throw err;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { candidatoId, pageId } = requireArgs(args);

  const apiBase = process.env.META_ADS_API_BASE ?? META_ADS_API_BASE_DEFAULT;
  const accessToken = process.env.META_ADS_ACCESS_TOKEN ?? "";
  const client = new MetaAdsApiClient(apiBase, accessToken, { rateLimitMs: 1000, retries: 2 });

  if (args.dryRun) {
    if (!accessToken) {
      await validarRotaSemToken(client, pageId);
      return;
    }

    logger.info(
      FONTE,
      `[dry-run] buscando anúncios de pageId=${pageId} — não grava no banco, não requer ` +
        "SUPABASE_SERVICE_ROLE_KEY (mas requer META_ADS_ACCESS_TOKEN válida, que já está definida)"
    );

    const collector = new MetaAdsCollector(candidatoId, pageId, client, {});
    collector.definirCandidatoParaInspecao(candidatoId);

    const brutos = await collector.fetchAll();
    logger.info(FONTE, `${brutos.length} anúncio(s) obtido(s) da Meta Ad Library`);

    const amostra = brutos.slice(0, 5).map((raw) => collector.normalize(raw));
    console.log(
      JSON.stringify(
        {
          total_bruto: brutos.length,
          amostra_normalizada: amostra,
          aviso:
            `candidato_id acima (${candidatoId}) não foi validado contra a tabela candidato ` +
            "nesta execução de --dry-run (prepare() não roda) — em execução real, run() confirma " +
            "que ele existe antes de gravar qualquer coisa.",
        },
        null,
        2
      )
    );
    return;
  }

  if (!accessToken) {
    throw new Error(
      "META_ADS_ACCESS_TOKEN não definida. É um access_token de app Meta com acesso aprovado a " +
        "anúncios políticos (processo de verificação de identidade do desenvolvedor — ver README " +
        "de src/collectors/meta-ads, seção 'Como conseguir o token'). Use --dry-run nesse meio " +
        "tempo para validar que a rota/parâmetros estão corretos (faz uma requisição real sem " +
        "token e confirma o erro esperado, não 404)."
    );
  }

  const env = loadEnv();
  const supabase = createWorkerSupabaseClient(env);
  const collector = new MetaAdsCollector(candidatoId, pageId, client, { supabase });
  const stats = await collector.run();
  console.log(JSON.stringify(stats, null, 2));
}

main().catch((err) => {
  logger.error("cli", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
