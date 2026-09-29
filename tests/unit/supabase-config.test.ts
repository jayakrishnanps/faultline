import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePublicSupabaseConfig } from "../../lib/supabase/config.ts";

test("public configuration accepts project origins and local development", () => {
  const key = "sb_publishable_fixture";
  assert.equal(parsePublicSupabaseConfig("https://example.supabase.co/", key).url, "https://example.supabase.co");
  assert.equal(parsePublicSupabaseConfig("http://localhost:54321", key).url, "http://localhost:54321");
});

test("public configuration rejects secret keys and invalid origins without echoing secrets", () => {
  const secret = "sb_secret_fixture_private";
  assert.throws(() => parsePublicSupabaseConfig("https://example.supabase.co", secret), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message.includes(secret), false);
    return /publishable key/.test(error.message);
  });
  for (const url of [undefined, "broken", "http://example.com", "https://example.com/path", "https://user:password@example.com", "https://example.com?key=secret"]) {
    assert.throws(() => parsePublicSupabaseConfig(url, "sb_publishable_fixture"));
  }
});
