import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { parseDatabaseConnection } from "./connection.ts";
import { assertSchemaChecks, verificationSql } from "./verify-schema.ts";
import type { SchemaCheck } from "./verify-schema.ts";

async function main() {
  const connection = parseDatabaseConnection(process.env.DATABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_URL);
  const certificateAuthority = await readFile(new URL("./certificates/supabase-prod-ca-2021.crt", import.meta.url), "utf8");
  const sql = postgres({
    ...connection,
    ssl: { rejectUnauthorized: true, ca: certificateAuthority },
    max: 1,
    connect_timeout: 15,
    idle_timeout: 5,
    prepare: false,
    onnotice: () => undefined,
  });
  try {
    const [state] = await sql<{ installed: boolean; private_schema: boolean; relations: string[] }[]>`
      select to_regclass('public.faultline_schema_version') is not null as installed,
        to_regnamespace('faultline_private') is not null as private_schema,
        array(select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
          where n.nspname='public' and c.relkind in ('r','p','v','m','f') order by relname) as relations
    `;
    if (!state) throw new Error("Could not inspect the database before setup.");
    if (!state.installed) {
      if (process.argv.includes("--verify")) throw new Error("The Faultline schema version table is missing.");
      if (state.private_schema || state.relations.length > 0) {
        throw new Error("This database already contains objects. Inspect them before applying the one-time setup; no objects were changed.");
      }
      const source = await readFile(new URL("../../Faultline-Supabase-Setup.sql", import.meta.url), "utf8");
      // The user-supplied file owns its transaction. Execute it unchanged, once.
      await sql.unsafe(source).simple();
      console.log("Applied Faultline-Supabase-Setup.sql.");
    } else {
      console.log("Existing Faultline schema detected; checking it without reapplying SQL.");
    }
    const versions = await sql<{ version: number }[]>`select version from public.faultline_schema_version order by version`;
    if (versions.length !== 1 || versions[0]?.version !== 1) throw new Error("Expected exactly Faultline schema version 1.");
    const checks = await sql.unsafe<SchemaCheck[]>(verificationSql);
    assertSchemaChecks(checks);
    console.log(`PASS: schema version 1 and ${checks.length} catalog checks (tables, RLS, grants, policies, RPCs, publication and auth trigger).`);
  } catch (error) {
    // The supplied migration may have failed inside its explicit transaction.
    // Rollback affects only this connection; a committed installation stays intact.
    await sql`rollback`.catch(() => undefined);
    throw error;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof postgres.PostgresError) {
    if (error.code === "28P01") {
      console.error("PostgreSQL rejected the database credentials (28P01). Verify the database password and project connection details in DATABASE_URL.");
    } else {
      console.error(`PostgreSQL setup/check failed (SQLSTATE ${error.code}). No automatic deletion or repair was attempted.`);
    }
  } else if (error instanceof Error && error.constructor === Error) {
    console.error(error.message);
  } else {
    console.error("Database connection failed. Check the connection string, password, network and TLS certificate configuration.");
  }
  process.exitCode = 1;
}
