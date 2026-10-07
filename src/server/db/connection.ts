export const resolveRuntimeDatabaseUrl = (env: Readonly<Record<string, string | undefined>>) => {
  if (env.VERCEL_ENV !== "production") return env.DATABASE_URL;
  // Neon can retain prepared parameter types in the shared pool after a DDL change.
  // Use the integration's direct URL with a small per-instance connection pool.
  const direct = env.DATABASE_URL_UNPOOLED?.trim() || env.POSTGRES_URL_NON_POOLING?.trim();
  if (!direct) return env.DATABASE_URL;
  if (env.DATABASE_URL) {
    const pooled = new URL(env.DATABASE_URL), unpooled = new URL(direct);
    if (pooled.pathname !== unpooled.pathname ||
        (pooled.hostname.endsWith(".neon.tech") &&
         pooled.hostname.replace(/-pooler(?=\.)/, "") !== unpooled.hostname)) {
      throw new Error("Direct database connection does not match the runtime database.");
    }
  }
  return direct;
};

export const withDefaultConnectionParams = (url: string, production = false) => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") return url;
    if (!parsed.searchParams.has("connect_timeout")) parsed.searchParams.set("connect_timeout", "5");
    if (!parsed.searchParams.has("pool_timeout")) parsed.searchParams.set("pool_timeout", "10");
    if (production) {
      // Avoid reusing pre-migration prepared plans through the production pooler.
      parsed.searchParams.set("pgbouncer", "true");
      parsed.searchParams.set("statement_cache_size", "0");
      if (!parsed.searchParams.has("connection_limit")) parsed.searchParams.set("connection_limit", "5");
    }
    return parsed.toString();
  } catch {
    return url;
  }
};
