export function parsePublicSupabaseConfig(url: string | undefined, publishableKey: string | undefined) {
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is required.");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must be a valid URL.");
  }
  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if ((parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) ||
      parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must be an HTTPS project origin (HTTP is allowed for localhost).");
  }
  if (!publishableKey?.startsWith("sb_publishable_")) {
    throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be a publishable key.");
  }
  return { url: parsed.origin, publishableKey };
}
