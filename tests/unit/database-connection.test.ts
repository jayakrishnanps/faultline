import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDatabaseConnection } from "../../scripts/db/connection.ts";

const ref = "abcdefghijklmnopqrst";
const projectUrl = `https://${ref}.supabase.co`;

test("setup accepts only a direct or session-pooler connection for the configured project", () => {
  const direct = parseDatabaseConnection(`postgresql://postgres:encoded%40password@db.${ref}.supabase.co:5432/postgres`, projectUrl);
  assert.equal(direct.password, "encoded@password");
  assert.equal(direct.host, `db.${ref}.supabase.co`);
  const pooler = parseDatabaseConnection(`postgresql://postgres.${ref}:password@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`, projectUrl);
  assert.equal(pooler.username, `postgres.${ref}`);
});

test("setup rejects missing credentials, wrong projects, endpoints and transaction-pooler mode", () => {
  for (const value of [
    undefined,
    `postgresql://postgres@db.${ref}.supabase.co/postgres`,
    `postgresql://postgres:YOUR_PASSWORD@db.${ref}.supabase.co/postgres`,
    "postgresql://postgres:password@db.wrongproject.supabase.co/postgres",
    `postgresql://postgres.${ref}:password@aws-0-ap-south-1.pooler.supabase.com:6543/postgres`,
    `postgresql://postgres.${ref}:password@example.com:5432/postgres`,
  ]) {
    assert.throws(() => parseDatabaseConnection(value, projectUrl));
  }
});
