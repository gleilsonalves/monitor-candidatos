import "dotenv/config";

export interface WorkersEnv {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  camaraApiBase: string;
}

/**
 * Carrega e valida as variáveis de ambiente necessárias para os coletores
 * gravarem no banco. Falha com uma mensagem explicativa (não um crash
 * confuso) quando a service_role key não está configurada — ela não é
 * distribuída com o repositório, o usuário precisa preenchê-la manualmente.
 */
export function loadEnv(): WorkersEnv {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const camaraApiBase =
    process.env.CAMARA_API_BASE ?? "https://dadosabertos.camara.leg.br/api/v2";

  if (!supabaseUrl) {
    throw new Error(
      "SUPABASE_URL não definida. Copie packages/workers/.env.example para " +
        "packages/workers/.env e preencha."
    );
  }

  if (!supabaseServiceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY não definida.\n" +
        "As tabelas de escrita (raw_payload, evento, ...) têm RLS habilitado sem " +
        "policy pública de INSERT — só a service_role key (que ignora RLS) pode gravar.\n" +
        "Pegue a chave em: Supabase Dashboard > Project Settings > API > service_role.\n" +
        "NUNCA use essa chave no frontend. Preencha SUPABASE_SERVICE_ROLE_KEY em " +
        "packages/workers/.env (copie de .env.example se ainda não existir).\n" +
        "Dica: para validar só o fetch/normalize sem gravar no banco, rode com --dry-run."
    );
  }

  return { supabaseUrl, supabaseServiceRoleKey, camaraApiBase };
}
