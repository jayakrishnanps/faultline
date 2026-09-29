import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import type { PGlite } from "@electric-sql/pglite";
import { createLocalSchema, schemaPath } from "../../scripts/db/local-schema.ts";
import { assertSchemaChecks, verificationSql } from "../../scripts/db/verify-schema.ts";
import type { SchemaCheck } from "../../scripts/db/verify-schema.ts";

let db: PGlite;
const userA = "00000000-0000-4000-8000-000000000001";
const userB = "00000000-0000-4000-8000-000000000002";
let repoA: string;
let repoB: string;
let installationA: string;
const sha = "a".repeat(40);

before(async () => {
  ({ db } = await createLocalSchema());
  await db.query("insert into auth.users(id) values ($1), ($2)", [userA, userB]);
  for (const [userId, githubId] of [[userA, 1], [userB, 2]] as const) {
    const installation = (await db.query<{ id: string }>(`
      insert into public.github_installations(user_id, github_installation_id, github_account_id, account_login, account_type)
      values ($1,$2,$2,'fixture','User') returning id
    `, [userId, githubId])).rows[0]!.id;
    const repository = (await db.query<{ id: string }>(`
      insert into public.repositories(installation_id, github_repository_id, owner, name)
      values ($1,$2,'fixture','demo') returning id
    `, [installation, githubId])).rows[0]!.id;
    if (userId === userA) { repoA = repository; installationA = installation; }
    else repoB = repository;
  }
});

after(async () => { await db?.close(); });

async function asRole<T>(role: "anon" | "authenticated" | "service_role", userId: string, run: () => Promise<T>) {
  // Role is a fixed internal union; UUID is passed as a parameter.
  await db.exec(`set role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  try { return await run(); }
  finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}

test("supplied SQL creates version 1, 19 RLS tables, and analyses realtime publication", async () => {
  const version = await db.query<{ version: number }>("select version from public.faultline_schema_version");
  assert.deepEqual(version.rows, [{ version: 1 }]);
  const tables = await db.query<{ relrowsecurity: boolean }>(`
    select c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r'
  `);
  assert.equal(tables.rows.length, 19);
  assert.equal(tables.rows.every((row) => row.relrowsecurity), true);
  const publication = await db.query<{ tablename: string }>(`
    select tablename from pg_publication_tables where pubname='supabase_realtime' order by tablename
  `);
  assert.deepEqual(publication.rows, [{ tablename: "analyses" }]);
});

test("hosted catalog verification accepts the supplied schema and detects a revoked server grant", async () => {
  assertSchemaChecks((await db.query<SchemaCheck>(verificationSql)).rows);
  await db.exec("revoke select on public.jobs from service_role");
  try {
    assert.throws(() => assertSchemaChecks([]), /incomplete/);
    assert.throws(() => assertSchemaChecks([
      { name: "grants:jobs", passed: false },
    ]), /grants:jobs/);
    const checks = (await db.query<SchemaCheck>(verificationSql)).rows;
    assert.throws(() => assertSchemaChecks(checks), /grants:jobs/);
  } finally {
    await db.exec("grant select on public.jobs to service_role");
  }
});

test("authenticated reads are scoped to owner and browser writes are denied", async () => {
  await asRole("authenticated", userA, async () => {
    assert.deepEqual((await db.query("select id from public.profiles")).rows, [{ id: userA }]);
    assert.deepEqual((await db.query("select id from public.repositories")).rows, [{ id: repoA }]);
    await assert.rejects(db.query("update public.repositories set name='forbidden' where id=$1", [repoA]), /permission denied/);
    await assert.rejects(db.query("select * from public.jobs"), /permission denied/);
    await assert.rejects(db.query("select * from public.webhook_deliveries"), /permission denied/);
    await assert.rejects(db.query("select * from public.claim_job('forbidden')"), /permission denied/);
  });
  await asRole("authenticated", userB, async () => {
    assert.deepEqual((await db.query("select id from public.repositories")).rows, [{ id: repoB }]);
  });
});

test("anonymous role can query sanitized public demos but cannot access private tables or worker RPCs", async () => {
  await asRole("anon", "", async () => {
    assert.deepEqual((await db.query("select * from public.public_demo_reports")).rows, []);
    await assert.rejects(db.query("select * from public.repositories"), /permission denied/);
    await assert.rejects(db.query("select * from public.faultline_schema_version"), /permission denied/);
    await assert.rejects(db.query("select * from public.claim_job('forbidden')"), /permission denied/);
  });
});

test("snapshot boundaries reject cross-repository files and ready snapshots reject mutations", async () => {
  const snapshot = (await db.query<{ id: string }>(`
    insert into public.graph_snapshots(repository_id,commit_sha) values ($1,$2) returning id
  `, [repoA, sha])).rows[0]!.id;
  await assert.rejects(db.query(`
    insert into public.source_files(repository_id,snapshot_id,path,content_sha) values ($1,$2,'wrong.ts',$3)
  `, [repoB, snapshot, sha]), /foreign key/);
  const file = (await db.query<{ id: string }>(`
    insert into public.source_files(repository_id,snapshot_id,path,content_sha) values ($1,$2,'right.ts',$3) returning id
  `, [repoA, snapshot, sha])).rows[0]!.id;
  await db.query("update public.graph_snapshots set status='ready',completed_at=now() where id=$1", [snapshot]);
  await assert.rejects(db.query("update public.source_files set path='changed.ts' where id=$1", [file]), /Only indexing snapshots/);
  await assert.rejects(db.query("update public.graph_snapshots set files_total=2 where id=$1", [snapshot]), /immutable/);
  await asRole("authenticated", userA, async () => {
    assert.equal((await db.query("select id from public.source_files where id=$1", [file])).rows.length, 1);
  });
  await db.query("update public.repositories set access_removed_at=now() where id=$1", [repoA]);
  try {
    await asRole("authenticated", userA, async () => {
      assert.deepEqual((await db.query("select id from public.source_files where id=$1", [file])).rows, []);
      assert.equal((await db.query("select id from public.repositories where id=$1", [repoA])).rows.length, 1);
    });
  } finally {
    await db.query("update public.repositories set access_removed_at=null where id=$1", [repoA]);
  }
});

test("webhook recording deduplicates delivery and jobs; lease tokens prevent stale workers finishing", async () => {
  await asRole("service_role", "", async () => {
    const delivery = "00000000-0000-4000-8000-000000000010";
    const job = { job_type: "sync_installation", dedupe_key: "installation:fixture", installation_id: installationA, payload: {} };
    const record = async (id: string) => (await db.query<{ result: { delivery_is_new: boolean; job_id: string } }>(`
      select public.record_webhook_and_job($1,'installation','created','{}'::jsonb,$2::jsonb) as result
    `, [id, JSON.stringify(job)])).rows[0]!.result;
    const first = await record(delivery);
    assert.equal(first.delivery_is_new, true);
    assert.deepEqual(await record(delivery), { delivery_is_new: false, job_id: first.job_id });
    const second = await record("00000000-0000-4000-8000-000000000011");
    assert.equal(second.job_id, first.job_id);
    const claimed = (await db.query<{ lease_token: string; status: string }>("select * from public.claim_job('fixture-worker',$1,15)", [first.job_id])).rows[0]!;
    assert.equal(claimed.status, "running");
    assert.equal((await db.query("select * from public.claim_job('other-worker',$1,15)", [first.job_id])).rows.length, 0);
    const stale = (await db.query<{ ok: boolean }>("select public.finish_job($1,$2,'complete') as ok", [first.job_id, userB])).rows[0]!;
    assert.equal(stale.ok, false);
    const heartbeat = (await db.query<{ ok: boolean }>("select public.heartbeat_job($1,$2,15) as ok", [first.job_id, claimed.lease_token])).rows[0]!;
    assert.equal(heartbeat.ok, true);
    assert.equal((await db.query<{ ok: boolean }>("select public.finish_job($1,$2,'complete') as ok", [first.job_id, claimed.lease_token])).rows[0]!.ok, true);
    assert.equal((await db.query<{ ok: boolean }>("select public.heartbeat_job($1,$2,15) as ok", [first.job_id, claimed.lease_token])).rows[0]!.ok, false);
    assert.deepEqual((await db.query("select status from public.webhook_deliveries where job_id=$1", [first.job_id])).rows, [{ status: "complete" }, { status: "complete" }]);
  });
});

test("re-running the one-time SQL fails and leaves the existing schema intact", async () => {
  await assert.rejects(db.exec(await readFile(schemaPath, "utf8")), /already exists/);
  await db.exec("rollback");
  assert.deepEqual((await db.query("select version from public.faultline_schema_version")).rows, [{ version: 1 }]);
});
