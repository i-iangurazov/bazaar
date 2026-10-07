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
    }
    return parsed.toString();
  } catch {
    return url;
  }
};
