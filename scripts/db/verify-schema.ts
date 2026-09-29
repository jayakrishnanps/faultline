import { publicTableNames } from "../../types/database.ts";

export type SchemaCheck = { name: string; passed: boolean };

// These names are fixed contract identifiers, never request input.
const tables = publicTableNames.map((name) => `('${name}')`).join(",");
const functions = [
  "public.record_webhook_and_job(uuid,text,text,jsonb,jsonb)",
  "public.claim_job(text,uuid,integer)",
  "public.heartbeat_job(uuid,uuid,integer)",
  "public.finish_job(uuid,uuid,text,text,text,timestamptz)",
  "public.retry_job(uuid)",
].map((name) => `('${name}')`).join(",");

/** Read-only catalog checks. Does not invoke worker functions or read business rows. */
export const verificationSql = `
  with expected_tables(name) as (values ${tables}),
  expected_functions(name) as (values ${functions}),
  relations as (
    select e.name, c.oid, c.relrowsecurity
    from expected_tables e left join pg_class c
      on c.oid=to_regclass('public.' || e.name) and c.relkind='r'
  )
  select 'table:' || name as name, coalesce(relrowsecurity, false) as passed from relations
  union all
  select 'grants:' || name,
    case when oid is null then false else
      has_table_privilege('service_role',oid,'SELECT') and
      has_table_privilege('service_role',oid,'INSERT') and
      has_table_privilege('service_role',oid,'UPDATE') and
      has_table_privilege('service_role',oid,'DELETE') and
      has_table_privilege('anon',oid,'SELECT') = (name='public_demo_reports') and
      has_table_privilege('authenticated',oid,'SELECT') =
        (name not in ('faultline_schema_version','jobs','webhook_deliveries')) and
      not has_table_privilege('anon',oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') and
      not has_table_privilege('authenticated',oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    end from relations
  union all
  select 'policy:' || r.name,
    exists(select 1 from pg_policies p where p.schemaname='public' and p.tablename=r.name and p.cmd='SELECT')
      = (r.name not in ('faultline_schema_version','jobs','webhook_deliveries'))
    from relations r
  union all
  select 'rpc:' || name, coalesce(
    has_function_privilege('service_role',to_regprocedure(name),'EXECUTE') and
    not has_function_privilege('anon',to_regprocedure(name),'EXECUTE') and
    not has_function_privilege('authenticated',to_regprocedure(name),'EXECUTE'), false)
    from expected_functions
  union all
  select 'realtime:analyses', exists(
    select 1 from pg_publication_tables where pubname='supabase_realtime'
      and schemaname='public' and tablename='analyses')
  union all
  select 'auth:profile-trigger', exists(
    select 1 from pg_trigger where tgrelid='auth.users'::regclass
      and tgname='faultline_auth_user_created' and tgenabled='O')
  order by name
`;

export function assertSchemaChecks(checks: readonly SchemaCheck[]) {
  const failed = checks.filter((check) => !check.passed).map((check) => check.name);
  if (failed.length) throw new Error(`Database verification failed: ${failed.join(", ")}`);
  if (checks.length !== publicTableNames.length * 3 + 7) throw new Error("Database verification returned an incomplete check set.");
}
