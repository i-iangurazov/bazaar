import { PrismaClient, type Prisma } from "@prisma/client";
import { withDefaultConnectionParams } from "./connection";

import {
  isPrismaQueryProfilingEnabled,
  recordPrismaQueryTiming,
} from "@/server/profiling/perf";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const localDatabaseUrl = process.env.DATABASE_URL;

const datasourceUrl = localDatabaseUrl
  ? withDefaultConnectionParams(localDatabaseUrl, process.env.VERCEL_ENV === "production")
  : undefined;

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
