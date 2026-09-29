import { createClient } from "@supabase/supabase-js";
import { parsePublicSupabaseConfig } from "../../lib/supabase/config.ts";
import { publicTableNames } from "../../types/database.ts";
import type { Database } from "../../types/database.ts";

async function main() {
  const { url, publishableKey } = parsePublicSupabaseConfig(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret?.startsWith("sb_secret_")) throw new Error("SUPABASE_SECRET_KEY is required for the database check.");
  const options = {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) }) },
  };
  const admin = createClient<Database>(url, secret, options);
  const publicClient = createClient<Database>(url, publishableKey, options);
  const { data, error } = await admin.from("faultline_schema_version").select("version").order("version");
  if (error) {
    if (error.code === "PGRST205") throw new Error("Faultline schema is not exposed by the Data API. Apply the supplied SQL, then rerun npm run db:check.");
    throw new Error(`Schema version query failed (${error.code || "connection error"}).`);
  }
  if (data.length !== 1 || data[0]?.version !== 1) throw new Error("Expected exactly Faultline schema version 1.");
  for (const table of publicTableNames) {
    // HEAD confirms access without downloading repository/user/report rows.
    const { error: tableError } = await admin.from(table).select("*", { head: true }).limit(0);
    if (tableError) throw new Error(`Table check failed for ${table} (${tableError.code || "connection error"}).`);
  }
  const { error: demoError } = await publicClient.from("public_demo_reports").select("id", { head: true }).limit(0);
  if (demoError) throw new Error(`Public demo access check failed (${demoError.code || "connection error"}).`);
  for (const table of publicTableNames.filter((name) => name !== "public_demo_reports")) {
    // Zero-row GET preserves SQLSTATE in the error body without reading business rows.
    // PostgREST maps 42501 to 401 for anonymous requests and 403 for authenticated ones.
    const { error: denied, status } = await publicClient.from(table).select("*").limit(0);
    if (denied?.code !== "42501" || (status !== 401 && status !== 403)) {
      throw new Error(`Expected anonymous SQL permission denial for ${table}.`);
    }
  }
  console.log(`PASS: schema version 1; ${publicTableNames.length} admin table checks; anonymous demo access; ${publicTableNames.length - 1} private-table denials.`);
  console.log("Read-only API checks complete. No rows written; SQL policies/RPC internals are validated separately by local tests.");
}

try {
  await main();
} catch (error) {
  // Supabase error objects may contain request details; print only our own bounded errors.
  console.error(error instanceof Error && !error.message.includes("sb_") ? error.message : "Database check failed.");
  process.exitCode = 1;
}
