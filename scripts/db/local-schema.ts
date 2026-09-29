import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

export const schemaPath = new URL("../../Faultline-Supabase-Setup.sql", import.meta.url);

/** Test-only Supabase prerequisites. Never execute this bootstrap on a hosted database. */
export async function createLocalSchema() {
  const sql = await readFile(schemaPath, "utf8");
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$;
      grant usage on schema public, auth to anon, authenticated, service_role;
      grant execute on function auth.uid() to anon, authenticated, service_role;
    `);
    // Apply the actual supplied file, including its transaction, grants and triggers.
    await db.exec(sql);
    return { db, schemaHash: createHash("sha256").update(sql.replace(/\r\n/g, "\n")).digest("hex") };
  } catch (error) {
    await db.close();
    throw error;
  }
}
