const HARDENING_TEST_DATABASES = [
  "bazaar_hardening_agent1_pos",
  "bazaar_hardening_agent2_inventory",
  "bazaar_hardening_agent3_commerce",
  "bazaar_hardening_agent4_platform",
] as const;

const LOCAL_TEST_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const SAFE_HARDENING_DATABASE_PATTERN =
  /^bazaar_hardening_agent(?:1_pos|2_inventory|3_commerce|4_platform)$/;

export const HARDENING_TEST_DATABASE_ALLOWLIST = new Set<string>(HARDENING_TEST_DATABASES);

type TestDatabaseEnvironment = NodeJS.ProcessEnv | Record<string, string | undefined>;

export type SafeTestDatabaseIdentity = {
  databaseUrl: string;
  databaseName: string;
  host: string;
};

const safetyError = (message: string) => new Error(`[test-db-safety] ${message}`);

const splitAllowlist = (value: string | undefined) =>
  new Set(
    (value ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );

const databaseNameFromUrl = (url: URL) => {
  const pathname = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  if (!pathname || pathname.includes("/")) {
    throw safetyError("DATABASE_URL must contain exactly one database name.");
  }
  if (!/^[A-Za-z0-9_]+$/.test(pathname)) {
    throw safetyError("Database name contains unsupported characters.");
  }
  return pathname;
};

const parseDatabaseUrl = (databaseUrl: string) => {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw safetyError("DATABASE_URL must be a valid PostgreSQL URL.");
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw safetyError("DATABASE_URL must use the PostgreSQL protocol.");
  }
  if (!url.hostname) {
    throw safetyError("DATABASE_URL must include a database host.");
  }
  return url;
};

const productionHosts = (env: TestDatabaseEnvironment) => {
  const hosts = splitAllowlist(env.PRODUCTION_DATABASE_HOSTS);
  const productionUrl = env.PRODUCTION_DATABASE_URL?.trim();
  if (productionUrl) {
    try {
      hosts.add(new URL(productionUrl).hostname.toLowerCase());
    } catch {
      throw safetyError("PRODUCTION_DATABASE_URL is invalid; refusing destructive test access.");
    }
  }
  return hosts;
};

export const resolveConfiguredTestDatabaseUrl = (env: TestDatabaseEnvironment = process.env) => {
  const databaseUrl = env.DATABASE_TEST_URL?.trim() || env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw safetyError("DATABASE_TEST_URL or DATABASE_URL must be explicitly set.");
  }
  return databaseUrl;
};

export const assertSafeTestDatabaseReset = (options?: {
  env?: TestDatabaseEnvironment;
  databaseUrl?: string;
}): SafeTestDatabaseIdentity => {
  const env = options?.env ?? process.env;

  if (env.NODE_ENV !== "test") {
    throw safetyError('NODE_ENV must be exactly "test".');
  }
  if (env.RUN_DB_TESTS !== "1") {
    throw safetyError('RUN_DB_TESTS must be exactly "1".');
  }
  if (env.ALLOW_TEST_DB_RESET !== "1") {
    throw safetyError('ALLOW_TEST_DB_RESET must be exactly "1".');
  }
  if (env.VERCEL_ENV === "production") {
    throw safetyError("VERCEL_ENV=production cannot run destructive database tests.");
  }

  const expectedDatabaseName = env.EXPECTED_TEST_DB_NAME?.trim();
  if (!expectedDatabaseName) {
    throw safetyError("EXPECTED_TEST_DB_NAME must be explicitly set.");
  }
  if (!HARDENING_TEST_DATABASE_ALLOWLIST.has(expectedDatabaseName)) {
    throw safetyError(`${expectedDatabaseName} is not in the hardening database allowlist.`);
  }
  if (!SAFE_HARDENING_DATABASE_PATTERN.test(expectedDatabaseName)) {
    throw safetyError("Expected database name does not contain the required hardening identity suffix.");
  }

  const databaseUrl = options?.databaseUrl ?? resolveConfiguredTestDatabaseUrl(env);
  const parsedUrl = parseDatabaseUrl(databaseUrl);
  const databaseName = databaseNameFromUrl(parsedUrl);
  if (databaseName !== expectedDatabaseName) {
    throw safetyError(
      `Database identity mismatch: expected ${expectedDatabaseName}, received ${databaseName}.`,
    );
  }

  const host = parsedUrl.hostname.toLowerCase();
  if (productionHosts(env).has(host)) {
    throw safetyError(`Database host ${host} is identified as Production.`);
  }

  if (!LOCAL_TEST_DATABASE_HOSTS.has(host)) {
    const allowedRemoteHosts = splitAllowlist(env.HARDENING_TEST_DB_HOST_ALLOWLIST);
    if (!allowedRemoteHosts.has(host)) {
      throw safetyError(
        `Non-local database host ${host} must be explicitly listed in HARDENING_TEST_DB_HOST_ALLOWLIST.`,
      );
    }
  }

  return { databaseUrl, databaseName, host };
};
