import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const objects = new Map<string, Buffer>();
  const metadata = new Map<string, Record<string, string>>();
  const expirations = new Map<string, number>();
  const send = vi.fn(async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
    const key = String(command.input.Key ?? "");
    if (command.constructor.name === "PutObjectCommand") {
      const chunks: Buffer[] = [];
      for await (const chunk of command.input.Body as AsyncIterable<Uint8Array>) {
        chunks.push(Buffer.from(chunk));
      }
      objects.set(key, Buffer.concat(chunks));
      return {};
    }
    if (command.constructor.name === "GetObjectCommand") {
      const data = objects.get(key);
      if (!data) throw new Error("missingObject");
      return { Body: Readable.from(data), ContentLength: data.length };
    }
    if (command.constructor.name === "DeleteObjectCommand") {
      objects.delete(key);
      return {};
    }
    throw new Error(`unexpectedCommand:${command.constructor.name}`);
  });
  const redis = {
    multi: vi.fn(() => {
      let key = "";
      let values: Record<string, string> = {};
      let expiration: { member: string; score: number } | null = null;
      const chain = {
        hset(redisKey: string, ...fields: string[]) {
          key = redisKey;
          values = Object.fromEntries(
            Array.from({ length: fields.length / 2 }, (_, index) => [
              fields[index * 2]!,
              fields[index * 2 + 1]!,
            ]),
          );
          return chain;
        },
        pexpire() {
          return chain;
        },
        zadd(_key: string, score: number, member: string) {
          expiration = { member, score };
          return chain;
        },
        async exec() {
          metadata.set(key, values);
          if (expiration) expirations.set(expiration.member, expiration.score);
          return [[null, 1]];
        },
      };
      return chain;
    }),
    zrangebyscore: vi.fn(async () => []),
    zrem: vi.fn(async (_key: string, member: string) => {
      expirations.delete(member);
      return 1;
    }),
    eval: vi.fn(async (_script: string, _keyCount: number, key: string, userId: string, orgId: string) => {
      const stored = metadata.get(key);
      if (!stored || stored.userId !== userId || stored.organizationId !== orgId) {
        return null;
      }
      metadata.delete(key);
      return [stored.filename, stored.objectKey];
    }),
  };
  return { objects, metadata, expirations, redis, send };
});

vi.mock("@/server/redis", () => ({
  getRedisPublisher: () => mocks.redis,
}));

vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-s3")>();
  return {
    ...actual,
    S3Client: class {
      send = mocks.send;
    },
  };
});

import { consumeZip, storeZipBuffer } from "@/lib/imageExportStore";

describe("R2 image export artifacts", () => {
  beforeEach(() => {
    mocks.objects.clear();
    mocks.metadata.clear();
    mocks.expirations.clear();
    mocks.send.mockClear();
    mocks.redis.multi.mockClear();
    mocks.redis.eval.mockClear();
    mocks.redis.zrangebyscore.mockClear();
    mocks.redis.zrem.mockClear();
    vi.stubEnv("EXPORT_STORAGE_PROVIDER", "r2");
    vi.stubEnv("R2_ACCOUNT_ID", "hardening-account");
    vi.stubEnv("R2_ACCESS_KEY_ID", "hardening-key");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "hardening-secret");
    vi.stubEnv("R2_BUCKET_NAME", "hardening-bucket");
    vi.stubEnv("R2_ENDPOINT", "https://r2.invalid");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses private object storage plus owner-scoped atomic Redis metadata", async () => {
    const token = randomUUID();
    const owner = { userId: "r2-user", organizationId: "r2-org" };
    const payload = new TextEncoder().encode("durable-r2-zip");

    await storeZipBuffer(token, payload, "images-r2.zip", owner);
    expect([...mocks.objects.keys()]).toEqual([
      `private/image-exports/${owner.organizationId}/${token}.zip`,
    ]);
    expect(mocks.metadata.get(`image-export:${token}`)).toMatchObject(owner);
    expect(mocks.expirations.size).toBe(1);

    expect(
      await consumeZip(token, { userId: "other-user", organizationId: owner.organizationId }),
    ).toBeUndefined();
    expect(mocks.metadata.has(`image-export:${token}`)).toBe(true);

    const consumed = await consumeZip(token, owner);
    expect(consumed?.filename).toBe("images-r2.zip");
    expect(new Uint8Array(await new Response(consumed?.data).arrayBuffer())).toEqual(payload);
    expect(mocks.metadata.has(`image-export:${token}`)).toBe(false);
    expect(mocks.objects.size).toBe(0);
    expect(mocks.expirations.size).toBe(0);
    expect(await consumeZip(token, owner)).toBeUndefined();
  });
});
