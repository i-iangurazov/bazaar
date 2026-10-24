import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withDefaultConnectionParams } from "@/server/db/connection";
import { shouldRunDbTests } from "../helpers/db";

const enabled = shouldRunDbTests && process.env.RUN_POOLING_TESTS === "1";

(enabled ? describe : describe.skip)("serverless database pooling", () => {
  let admin: PrismaClient;
  let direct: string;
  let pooled: string;
  const clients = (url: string, count = 30) => Array.from({ length: count }, () =>
    new PrismaClient({ datasourceUrl: url, log: [] }));
  const close = (dbs: PrismaClient[]) => Promise.all(dbs.map(db => db.$disconnect()));

  beforeAll(async () => {
    const workerUrl = (configured: string) => {
      const url = new URL(configured);
      url.username = "pool_worker";
      url.password = "pool_worker_test_only";
      return withDefaultConnectionParams(url.toString(), true);
    };
    direct = workerUrl(process.env.DATABASE_URL_UNPOOLED!);
    pooled = workerUrl(process.env.DATABASE_TEST_URL!);
    admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_UNPOOLED! });
    await admin.$executeRawUnsafe("CREATE SCHEMA qa_pooling");
    await admin.$executeRawUnsafe("GRANT USAGE ON SCHEMA qa_pooling TO pool_worker");
    await admin.$executeRawUnsafe("CREATE TABLE qa_pooling.counter (id integer PRIMARY KEY, quantity numeric(20,3) NOT NULL)");
    await admin.$executeRawUnsafe("INSERT INTO qa_pooling.counter VALUES (1, 0)");
    await admin.$executeRawUnsafe("CREATE TABLE qa_pooling.operation (id integer PRIMARY KEY)");
    await admin.$executeRawUnsafe("CREATE TABLE qa_pooling.plan_probe (id integer PRIMARY KEY, quantity integer, minimum integer)");
    await admin.$executeRawUnsafe("INSERT INTO qa_pooling.plan_probe VALUES (1, 1, 1)");
    await admin.$executeRawUnsafe("GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA qa_pooling TO pool_worker");
  });

  afterAll(async () => {
    if (admin) {
      try { await admin.$executeRawUnsafe("DROP SCHEMA IF EXISTS qa_pooling CASCADE"); }
      finally { await admin.$disconnect(); }
    }
  });

  it("reproduces direct-connection exhaustion but serves 30 warm clients through two server connections", async () => {
    const directClients = clients(direct);
    try {
      const results = await Promise.allSettled(directClients.map(db => db.$queryRaw`SELECT 1`));
      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(4);
      const failures = results.filter(result => result.status === "rejected");
      expect(failures).toHaveLength(26);
      for (const result of failures) {
        if (result.status === "rejected") {
          expect(String(result.reason)).toMatch(/too many (?:database )?connections/i);
        }
      }
    } finally { await close(directClients); }

    const pooledClients = clients(pooled);
    try {
      const results = await Promise.all(pooledClients.map(db => db.$queryRaw`SELECT 1`));
      expect(results).toHaveLength(30);
      const [{ count }] = await admin.$queryRaw<{ count: number }[]>`
        SELECT count(*)::int AS count FROM pg_stat_activity WHERE usename = 'pool_worker'
      `;
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThanOrEqual(2);
    } finally { await close(pooledClients); }
  }, 30_000);

  it("preserves transaction locks, fractional amounts, idempotent replay and rollback across pooled clients", async () => {
    const pooledClients = clients(pooled);
    const apply = (db: PrismaClient, id: number) => db.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(20261025)::text`;
      const inserted = await tx.$queryRaw<{ id: number }[]>`
        INSERT INTO qa_pooling.operation VALUES (${id}) ON CONFLICT DO NOTHING RETURNING id
      `;
      if (inserted.length) await tx.$executeRaw`
        UPDATE qa_pooling.counter SET quantity = quantity + 0.125 WHERE id = 1
      `;
    }, { maxWait: 20_000, timeout: 10_000 });
    try {
      await Promise.all(pooledClients.map((db, id) => apply(db, id)));
      await Promise.all(pooledClients.map((db, id) => apply(db, id)));
      await expect(pooledClients[0].$transaction(async tx => {
        await tx.$executeRaw`UPDATE qa_pooling.counter SET quantity = 999 WHERE id = 1`;
        await tx.$executeRaw`INSERT INTO qa_pooling.operation VALUES (999)`;
        throw new Error("forced rollback");
      })).rejects.toThrow("forced rollback");
      const [row] = await admin.$queryRaw<{ quantity: { toString(): string }; count: number }[]>`
        SELECT quantity, (SELECT count(*)::int FROM qa_pooling.operation) AS count
        FROM qa_pooling.counter WHERE id = 1
      `;
      expect(row.quantity.toString()).toBe("3.75");
      expect(row.count).toBe(30);
    } finally { await close(pooledClients); }
  }, 30_000);

  it("refreshes prepared parameter and result types after a migration while clients remain warm", async () => {
    const pooledClients = clients(pooled, 6);
    const read = (db: PrismaClient, quantity: number) => db.$queryRaw<{ quantity: number; minimum: number }[]>`
      SELECT quantity, minimum FROM qa_pooling.plan_probe WHERE quantity = ${quantity}
    `;
    try {
      for (const db of pooledClients) expect(await read(db, 1)).toEqual([{ quantity: 1, minimum: 1 }]);
      await admin.$executeRawUnsafe("ALTER TABLE qa_pooling.plan_probe ALTER COLUMN quantity TYPE double precision, ALTER COLUMN minimum TYPE double precision");
      await admin.$executeRaw`UPDATE qa_pooling.plan_probe SET quantity = 1.5, minimum = 0.25 WHERE id = 1`;
      for (const db of pooledClients) expect(await read(db, 1.5)).toEqual([{ quantity: 1.5, minimum: 0.25 }]);
    } finally { await close(pooledClients); }
  });
});
