import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "SUPABASE_URL e SUPABASE_ANON_KEY precisam estar definidos (veja .env.example). " +
      "A API só faz leitura e usa a chave anon/publishable — nunca a service_role."
  );
}

/**
 * Cliente Supabase server-side, somente leitura (anon key).
 * RLS no banco já restringe o que é público (ver db/migrations/0001_core_schema.sql),
 * então a API não precisa reforçar filtros de visibilidade — o Postgres faz isso.
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
