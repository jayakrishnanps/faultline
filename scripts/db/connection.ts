/** Parse a direct or session-pooler connection for the configured Supabase project. */
export function parseDatabaseConnection(connection: string | undefined, projectUrl: string | undefined) {
  if (!connection) throw new Error("DATABASE_URL is missing. Add the Supabase Session pooler connection string with its database password to .env.local.");
  let url: URL;
  let project: URL;
  try {
    url = new URL(connection);
    project = new URL(projectUrl ?? "");
  } catch {
    throw new Error("DATABASE_URL and NEXT_PUBLIC_SUPABASE_URL must be valid URLs.");
  }
  const reference = project.hostname.match(/^([a-z]{20})\.supabase\.co$/)?.[1];
  if (!reference || project.protocol !== "https:") throw new Error("A hosted Supabase project URL is required for setup.");
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error("DATABASE_URL must use postgres:// or postgresql://.");
  let username: string;
  let password: string;
  try {
    username = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
  } catch {
    throw new Error("DATABASE_URL contains invalid credential encoding.");
  }
  const direct = url.hostname === `db.${reference}.supabase.co` && username === "postgres";
  const pooled = /^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname) && username === `postgres.${reference}`;
  if (!direct && !pooled) throw new Error("DATABASE_URL must target this project's direct or Session pooler endpoint as postgres.");
  if (url.pathname !== "/postgres" || (url.port && url.port !== "5432")) {
    throw new Error("Use the postgres database on port 5432 (direct or Session pooler, not transaction mode).");
  }
  if (!password || /\[?YOUR[-_]PASSWORD\]?/i.test(password)) throw new Error("Fill in the actual database password in DATABASE_URL.");
  return { host: url.hostname, port: 5432, username, password, database: "postgres" };
}
