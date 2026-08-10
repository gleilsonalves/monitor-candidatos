import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { WorkersEnv } from "./env.js";

/**
 * Client Supabase server-side com a service_role key — bypassa RLS.
 * Uso exclusivo dos coletores (workers), nunca do frontend.
 */
export function createWorkerSupabaseClient(env: WorkersEnv): SupabaseClient {
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
