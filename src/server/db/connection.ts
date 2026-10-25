type DatabaseEnvironment = Readonly<Record<string, string | undefined>>;

const isNeonEndpoint = (url: URL) =>
  url.hostname.startsWith("ep-") && url.hostname.endsWith(".neon.tech");

export const resolveRuntimeDatabaseUrl = (env: DatabaseEnvironment) => {
  const configured = env.DATABASE_URL;
  if (!configured || env.VERCEL_ENV !== "production") return configured;
  const url = new URL(configured);
  // Serverless instances must share Neon's transaction pool. Direct connections
  // held by suspended instances can exhaust Postgres even when no query runs.
  if (!isNeonEndpoint(url) || url.hostname.split(".")[0].endsWith("-pooler")) {
    return configured;
  }
  url.hostname = url.hostname.replace(/\./, "-pooler.");
  return url.toString();
};

export const resolveMigrationDatabaseUrl = (env: DatabaseEnvironment) => {
  const direct = env.DATABASE_URL_UNPOOLED?.trim() || env.POSTGRES_URL_NON_POOLING?.trim();
  if (!direct) {
    if (!env.DATABASE_URL) return undefined;
    const url = new URL(env.DATABASE_URL);
    if (!isNeonEndpoint(url)) return env.DATABASE_URL;
    url.hostname = url.hostname.replace(/-pooler(?=\.)/, "");
    return url.toString();
  }
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
      if (!parsed.searchParams.has("connection_limit")) parsed.searchParams.set("connection_limit", "2");
    }
    return parsed.toString();
  } catch {
    return url;
  }
};
