import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const localDatabaseUrl = process.env.DATABASE_URL;

const withDefaultConnectionParams = (url: string) => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
      return url;
    }
    if (!parsed.searchParams.has("connect_timeout")) {
      parsed.searchParams.set("connect_timeout", "5");
    }
    if (!parsed.searchParams.has("pool_timeout")) {
      parsed.searchParams.set("pool_timeout", "10");
    }
    return parsed.toString();
  } catch {
    return url;
  }
};

const datasourceUrl = localDatabaseUrl ? withDefaultConnectionParams(localDatabaseUrl) : undefined;

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["error", "warn"],
    ...(datasourceUrl
      ? {
          datasources: {
            db: {
              url: datasourceUrl,
            },
          },
        }
      : {}),
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
