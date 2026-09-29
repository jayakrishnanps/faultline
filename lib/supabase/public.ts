import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { parsePublicSupabaseConfig } from "./config";

/** Anonymous data access only. Authenticated SSR/session handling is a separate step. */
export function createPublicSupabaseClient() {
  const { url, publishableKey } = parsePublicSupabaseConfig(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
  return createClient<Database>(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
