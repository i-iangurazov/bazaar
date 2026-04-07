import { PrismaClient, type Prisma } from "@prisma/client";

import {
  isPrismaQueryProfilingEnabled,
  recordPrismaQueryTiming,
} from "@/server/profiling/perf";

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
    log: isPrismaQueryProfilingEnabled()
      ? [{ emit: "event", level: "query" }, "error", "warn"]
      : ["error", "warn"],
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

if (isPrismaQueryProfilingEnabled()) {
  prisma.$on("query" as never, (event: Prisma.QueryEvent) => {
    recordPrismaQueryTiming({
      query: event.query,
      durationMs: event.duration,
      target: event.target,
    });
  });
}

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
