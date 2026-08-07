import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { Readable } from "node:stream";
import { once } from "node:events";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { isProductionRuntime } from "@/server/config/runtime";
import { getRedisPublisher } from "@/server/redis";

type ZipOwner = { userId: string; organizationId: string };
type StoredZip = {
  data: ReadableStream<Uint8Array>;
  filename: string;
};

type LocalMetadata = ZipOwner & {
  filename: string;
  expiresAt: number;
  zipPath: string;
};

const ZIP_TTL_MS = 10 * 60 * 1000;
const TOKEN_PATTERN = /^[a-zA-Z0-9-]{16,128}$/;
const localRoot = () =>
  process.env.IMAGE_EXPORT_LOCAL_ROOT?.trim() || join(tmpdir(), "bazaar-image-exports");
const redisKey = (token: string) => `image-export:${token}`;
const redisExpirationKey = "image-export:expirations";
const isIsolatedPreview = () =>
  ["1", "true", "yes"].includes(
    process.env.HARDENING_PREVIEW_GUARD?.trim().toLowerCase() ?? "",
  );

const resolveR2Config = () => {
  const explicitExportProvider = process.env.EXPORT_STORAGE_PROVIDER?.trim().toLowerCase();
  const provider =
    explicitExportProvider || process.env.IMAGE_STORAGE_PROVIDER?.trim().toLowerCase();
  if (provider !== "r2") {
    return null;
  }
  const accountId = process.env.R2_ACCOUNT_ID?.trim() ?? "";
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim() ?? "";
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim() ?? "";
  const bucketName = process.env.R2_BUCKET_NAME?.trim() ?? "";
  const endpoint =
    process.env.R2_ENDPOINT?.trim() ||
    (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");
  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName || !endpoint) {
    return null;
  }
  return { accessKeyId, secretAccessKey, bucketName, endpoint };
};

const createR2Client = (config: NonNullable<ReturnType<typeof resolveR2Config>>) =>
  new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

const expirationMember = (token: string, objectKey: string) => `${token}|${objectKey}`;

const cleanupExpiredR2Artifacts = async (
  redis: NonNullable<ReturnType<typeof getRedisPublisher>>,
  client: S3Client,
  bucketName: string,
) => {
  const expired = await redis.zrangebyscore(redisExpirationKey, 0, Date.now(), "LIMIT", 0, 20);
  for (const member of expired) {
    const separator = member.indexOf("|");
    const objectKey = separator >= 0 ? member.slice(separator + 1) : "";
    if (objectKey) {
      await client
        .send(new DeleteObjectCommand({ Bucket: bucketName, Key: objectKey }))
        .catch(() => undefined);
    }
    await redis.zrem(redisExpirationKey, member);
  }
};

const safeToken = (token: string) => TOKEN_PATTERN.test(token);
const metadataPath = (token: string) => join(localRoot(), `${token}.json`);
const zipPath = (token: string) => join(localRoot(), `${token}.zip`);

const moveFile = async (from: string, to: string) => {
  try {
    await rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") {
      throw error;
    }
    await copyFile(from, to);
    await unlink(from);
  }
};

const streamFromNode = (stream: Readable) =>
  Readable.toWeb(stream) as ReadableStream<Uint8Array>;

export const storeZipFile = async (
  token: string,
  sourcePath: string,
  filename: string,
  owner: ZipOwner,
  options?: { ttlMs?: number },
) => {
  if (!safeToken(token)) {
    throw new Error("imageExportTokenInvalid");
  }
  const ttlMs = options?.ttlMs ?? ZIP_TTL_MS;
  const r2 = resolveR2Config();
  if (isProductionRuntime() && !isIsolatedPreview() && !r2) {
    throw new Error("imageExportStorageUnavailable");
  }

  if (r2) {
    const redis = getRedisPublisher();
    if (!redis) {
      throw new Error("imageExportStorageUnavailable");
    }
    const objectKey = `private/image-exports/${owner.organizationId}/${token}.zip`;
    const file = await stat(sourcePath);
    const client = createR2Client(r2);
    await cleanupExpiredR2Artifacts(redis, client, r2.bucketName).catch(() => undefined);
    await client.send(
      new PutObjectCommand({
        Bucket: r2.bucketName,
        Key: objectKey,
        Body: createReadStream(sourcePath),
        ContentLength: file.size,
        ContentType: "application/zip",
        CacheControl: "private, no-store",
      }),
    );
    try {
      const result = await redis
        .multi()
        .hset(
          redisKey(token),
          "userId",
          owner.userId,
          "organizationId",
          owner.organizationId,
          "filename",
          filename,
          "objectKey",
          objectKey,
        )
        .pexpire(redisKey(token), ttlMs)
        .zadd(redisExpirationKey, Date.now() + ttlMs, expirationMember(token, objectKey))
        .exec();
      if (!result) {
        throw new Error("imageExportStorageUnavailable");
      }
    } catch (error) {
      await client
        .send(new DeleteObjectCommand({ Bucket: r2.bucketName, Key: objectKey }))
        .catch(() => undefined);
      await redis.zrem(redisExpirationKey, expirationMember(token, objectKey)).catch(() => undefined);
      throw error;
    } finally {
      await unlink(sourcePath).catch(() => undefined);
    }
    return;
  }

  await mkdir(localRoot(), { recursive: true });
  const storedZipPath = zipPath(token);
  await moveFile(sourcePath, storedZipPath);
  const metadata: LocalMetadata = {
    ...owner,
    filename,
    expiresAt: Date.now() + ttlMs,
    zipPath: storedZipPath,
  };
  const pendingMetadata = join(localRoot(), `${token}.${randomUUID()}.tmp`);
  try {
    await writeFile(pendingMetadata, JSON.stringify(metadata), { flag: "wx" });
    await rename(pendingMetadata, metadataPath(token));
  } catch (error) {
    await Promise.all([
      unlink(pendingMetadata).catch(() => undefined),
      unlink(storedZipPath).catch(() => undefined),
    ]);
    throw error;
  }
};

export const storeZipBuffer = async (
  token: string,
  data: ArrayBuffer | Uint8Array,
  filename: string,
  owner: ZipOwner,
  options?: { ttlMs?: number },
) => {
  const directory = await mkdtemp(join(tmpdir(), "bazaar-image-export-buffer-"));
  const path = join(directory, "artifact.zip");
  try {
    await writeFile(path, new Uint8Array(data));
    await storeZipFile(token, path, filename, owner, options);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

const consumeR2Zip = async (
  token: string,
  owner: ZipOwner,
  r2: NonNullable<ReturnType<typeof resolveR2Config>>,
): Promise<StoredZip | undefined> => {
  const redis = getRedisPublisher();
  if (!redis) {
    throw new Error("imageExportStorageUnavailable");
  }
  const claimed = (await redis.eval(
    `
      local userId = redis.call('HGET', KEYS[1], 'userId')
      local organizationId = redis.call('HGET', KEYS[1], 'organizationId')
      if not userId or userId ~= ARGV[1] or organizationId ~= ARGV[2] then
        return nil
      end
      local result = redis.call('HMGET', KEYS[1], 'filename', 'objectKey')
      redis.call('DEL', KEYS[1])
      return result
    `,
    1,
    redisKey(token),
    owner.userId,
    owner.organizationId,
  )) as [string, string] | null;
  if (!claimed?.[0] || !claimed[1]) {
    return undefined;
  }
  const client = createR2Client(r2);
  try {
    const object = await client.send(
      new GetObjectCommand({ Bucket: r2.bucketName, Key: claimed[1] }),
    );
    if (!object.Body) {
      return undefined;
    }
    const body = object.Body as unknown as Readable & {
      transformToWebStream?: () => ReadableStream<Uint8Array>;
    };
    const data = body.transformToWebStream?.() ?? streamFromNode(body);
    await client.send(new DeleteObjectCommand({ Bucket: r2.bucketName, Key: claimed[1] }));
    await redis.zrem(redisExpirationKey, expirationMember(token, claimed[1]));
    return { data, filename: claimed[0] };
  } catch (error) {
    await redis
      .multi()
      .hset(
        redisKey(token),
        "userId",
        owner.userId,
        "organizationId",
        owner.organizationId,
        "filename",
        claimed[0],
        "objectKey",
        claimed[1],
      )
      .pexpire(redisKey(token), ZIP_TTL_MS)
      .zadd(
        redisExpirationKey,
        Date.now() + ZIP_TTL_MS,
        expirationMember(token, claimed[1]),
      )
      .exec()
      .catch(() => undefined);
    throw error;
  }
};

export const consumeZip = async (token: string, owner: ZipOwner): Promise<StoredZip | undefined> => {
  if (!safeToken(token)) {
    return undefined;
  }
  const r2 = resolveR2Config();
  if (isProductionRuntime() && !isIsolatedPreview() && !r2) {
    throw new Error("imageExportStorageUnavailable");
  }
  if (r2) {
    return consumeR2Zip(token, owner, r2);
  }

  let metadata: LocalMetadata;
  try {
    metadata = JSON.parse(await readFile(metadataPath(token), "utf8")) as LocalMetadata;
  } catch {
    return undefined;
  }
  if (metadata.expiresAt <= Date.now()) {
    await Promise.all([
      unlink(metadataPath(token)).catch(() => undefined),
      unlink(metadata.zipPath).catch(() => undefined),
    ]);
    return undefined;
  }
  if (metadata.userId !== owner.userId || metadata.organizationId !== owner.organizationId) {
    return undefined;
  }
  if (metadata.zipPath !== zipPath(token) || basename(metadata.zipPath) !== `${token}.zip`) {
    return undefined;
  }
  const claimPath = join(localRoot(), `${token}.${randomUUID()}.claim`);
  try {
    await rename(metadataPath(token), claimPath);
  } catch {
    return undefined;
  }
  try {
    const nodeStream = createReadStream(metadata.zipPath);
    await Promise.race([
      once(nodeStream, "open"),
      once(nodeStream, "error").then(([error]) => Promise.reject(error)),
    ]);
    await Promise.all([
      unlink(metadata.zipPath).catch(() => undefined),
      unlink(claimPath).catch(() => undefined),
    ]);
    return { data: streamFromNode(nodeStream), filename: metadata.filename };
  } catch (error) {
    await rename(claimPath, metadataPath(token)).catch(() => undefined);
    throw error;
  }
};

export const hasStoredZipForTests = async (token: string) => {
  try {
    await stat(metadataPath(token));
    return true;
  } catch {
    return false;
  }
};

export const clearImageExportStorageForTests = async () => {
  const root = localRoot();
  if (isProductionRuntime() || basename(root) !== "bazaar-image-exports") {
    throw new Error("imageExportTestCleanupDenied");
  }
  await rm(root, { recursive: true, force: true });
};
