import { prisma } from "@/server/db/prisma";
import { resolveProductImageUrl } from "@/server/services/productImageStorage";

const parseBool = (value: string | undefined) => {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
};

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

const toPositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
};

const applyChanges = parseBool(process.env.APPLY);
const batchSize = toPositiveInt(process.env.BATCH_SIZE, 100);
const productConcurrency = toPositiveInt(process.env.PRODUCT_CONCURRENCY, 4);
const imageConcurrency = toPositiveInt(process.env.IMAGE_CONCURRENCY, 8);
const writeConcurrency = toPositiveInt(process.env.WRITE_CONCURRENCY, 4);
const progressEveryProducts = toPositiveInt(
  process.env.PROGRESS_EVERY_PRODUCTS ?? process.env.PROGRESS_EVERY,
  10,
);
const slowResolveMs = toPositiveInt(process.env.SLOW_IMAGE_LOG_MS, 3_000);
const verboseImages = parseBool(process.env.VERBOSE_IMAGES);
const resolveDryRunImages = parseBool(process.env.DRY_RUN_RESOLVE_IMAGES);
const requestedFastRemoteCopy = parseBool(
  process.env.FAST_REMOTE_IMAGE_COPY ?? process.env.PRODUCT_IMAGE_FAST_STREAM,
);
const prismaRetryCount = toPositiveInt(process.env.PRISMA_RETRIES, 3);
const transactionMaxWaitMs = toPositiveInt(process.env.PRISMA_TRANSACTION_MAX_WAIT_MS, 30_000);
const transactionTimeoutMs = toPositiveInt(process.env.PRISMA_TRANSACTION_TIMEOUT_MS, 60_000);
const organizationIdFilter = process.env.ORG_ID?.trim() || null;
const baseUrl = trimTrailingSlash((process.env.NEXTAUTH_URL ?? "").trim());
const r2BaseUrl = trimTrailingSlash((process.env.R2_PUBLIC_BASE_URL ?? "").trim());
const storageProvider = (process.env.IMAGE_STORAGE_PROVIDER ?? "local").trim().toLowerCase();
const allowLocalApply = parseBool(process.env.ALLOW_LOCAL_APPLY);

const log = (message: string) => {
  console.log(`[images-backfill] ${message}`);
};

const warn = (message: string) => {
  console.warn(`[images-backfill] WARN: ${message}`);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const formatElapsed = (startedAt: number) => `${Math.round((Date.now() - startedAt) / 1000)}s`;

const isCloudflareManagedUrl = (value: string) => Boolean(r2BaseUrl) && value.startsWith(r2BaseUrl);

const createConcurrencyLimiter = (concurrency: number) => {
  let active = 0;
  const queue: Array<{
    task: () => Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
  }> = [];

  const schedule = () => {
    while (active < concurrency && queue.length > 0) {
      const next = queue.shift();
      if (!next) {
        return;
      }
      active += 1;
      void next
        .task()
        .then(next.resolve, next.reject)
        .finally(() => {
          active -= 1;
          schedule();
        });
    }
  };

  const run = async <T>(task: () => Promise<T>) => {
    return new Promise<T>((resolve, reject) => {
      queue.push({
        task,
        resolve: (value) => resolve(value as T),
        reject,
      });
      schedule();
    });
  };

  return {
    run,
    stats: () => ({ active, queued: queue.length }),
  };
};

const runWithConcurrency = async <T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
) => {
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) {
          return;
        }
        await worker(items[index], index);
      }
    }),
  );
};

const getErrorText = (error: unknown) => {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}\n${error.stack ?? ""}`;
  }
  return String(error);
};

const getErrorCode = (error: unknown) => {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
};

const isDatabaseConnectionError = (error: unknown) => {
  const code = getErrorCode(error);
  if (code === "P1001" || code === "P1017") {
    return true;
  }

  const message = getErrorText(error);
  return (
    message.includes("kind: Closed") ||
    message.includes("Can't reach database server") ||
    /connection.*closed/i.test(message) ||
    /server has closed the connection/i.test(message) ||
    message.includes("ECONNRESET") ||
    message.includes("EPIPE")
  );
};

const isTransactionStartTimeout = (error: unknown) =>
  getErrorCode(error) === "P2028" &&
  getErrorText(error).includes("Unable to start a transaction");

const isPrismaPoolTimeout = (error: unknown) =>
  getErrorCode(error) === "P2024" ||
  getErrorText(error).includes("Timed out fetching a new connection from the connection pool");

const isRetriablePrismaError = (error: unknown) =>
  isDatabaseConnectionError(error) || isTransactionStartTimeout(error) || isPrismaPoolTimeout(error);

const runPrismaWithRetry = async <T>(label: string, task: () => Promise<T>) => {
  for (let attempt = 1; attempt <= prismaRetryCount + 1; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      if (!isRetriablePrismaError(error)) {
        throw error;
      }
      if (attempt > prismaRetryCount) {
        throw error;
      }

      const delayMs = Math.min(1_000 * 2 ** (attempt - 1), 5_000);
      if (isDatabaseConnectionError(error)) {
        warn(
          `PostgreSQL connection closed during ${label}; reconnecting and retrying (${attempt}/${prismaRetryCount})`,
        );
        await prisma.$disconnect().catch(() => undefined);
        await sleep(delayMs);
        try {
          await prisma.$connect();
        } catch (connectError) {
          warn(
            `PostgreSQL reconnect failed during ${label}; retrying (${attempt}/${prismaRetryCount})`,
          );
          if (attempt >= prismaRetryCount) {
            throw connectError;
          }
        }
        continue;
      } else if (isPrismaPoolTimeout(error)) {
        warn(
          `Prisma connection pool was busy during ${label}; retrying in ${delayMs}ms (${attempt}/${prismaRetryCount})`,
        );
      } else {
        warn(
          `PostgreSQL transaction queue was busy during ${label}; retrying in ${delayMs}ms (${attempt}/${prismaRetryCount})`,
        );
      }
      await sleep(delayMs);
    }
  }

  throw new Error(`Prisma retry loop exhausted during ${label}`);
};

const runWriteWithLimiter = async <T>(
  limiter: ReturnType<typeof createConcurrencyLimiter>,
  label: string,
  task: () => Promise<T>,
) => {
  return limiter.run(() =>
    runPrismaWithRetry(label, async () => {
      try {
        return await task();
      } catch (error) {
        if (isTransactionStartTimeout(error)) {
          warn(
            `${label} could not start a transaction within ${transactionMaxWaitMs}ms; consider lowering WRITE_CONCURRENCY`,
          );
        }
        throw error;
      }
    }),
  );
};

const cleanUrlCandidate = (value: string) =>
  value
    .trim()
    .replace(/^[\s"'`[\]{}()]+/g, "")
    .replace(/[\s"'`[\]{}()]+$/g, "");

const splitUrlCandidates = (value: string) => {
  const trimmed = cleanUrlCandidate(value);
  if (!trimmed) {
    return [];
  }
  if (trimmed.startsWith("data:image/")) {
    return [trimmed];
  }
  if (!/[,\n;]/.test(trimmed)) {
    return [trimmed];
  }

  const parts = trimmed
    .split(/[\n,;]+/)
    .map((part) => cleanUrlCandidate(part))
    .filter(Boolean);
  if (parts.length < 2) {
    return [trimmed];
  }
  const urlLikeParts = parts.filter(
    (part) =>
      part.startsWith("http://") ||
      part.startsWith("https://") ||
      part.startsWith("//") ||
      /^www\./i.test(part) ||
      part.startsWith("/uploads/") ||
      part.startsWith("data:image/"),
  );
  if (urlLikeParts.length >= 2) {
    return urlLikeParts;
  }
  return [trimmed];
};

const normalizeForMigration = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("data:image/")) {
    return trimmed;
  }

  if (trimmed.startsWith("/uploads/")) {
    if (!baseUrl) {
      return null;
    }
    return `${baseUrl}${trimmed}`;
  }

  return trimmed;
};

const toDryRunManagedUrl = (value: string) => `dry-run-managed:${value}`;

type ProductBatchRow = {
  id: string;
  organizationId: string;
  photoUrl: string | null;
  images: { id: string; url: string }[];
};

type ProductBackfillResult = {
  changed: boolean;
  scannedPhotoUrls: number;
  scannedImageUrls: number;
  migratedPhotoUrls: number;
  migratedImageUrls: number;
  skippedAlreadyCloudflare: number;
  skippedMissingBaseUrl: number;
  failedResolutions: number;
};

const main = async () => {
  const mode = applyChanges ? "apply" : "dry-run";
  log(`Starting product image backfill (${mode})`);
  if (applyChanges && storageProvider !== "r2" && !allowLocalApply) {
    throw new Error(
      "IMAGE_STORAGE_PROVIDER is not set to r2. To migrate into Cloudflare R2, run with IMAGE_STORAGE_PROVIDER=r2 (or set ALLOW_LOCAL_APPLY=1 to override).",
    );
  }
  if (storageProvider !== "r2") {
    warn(
      "IMAGE_STORAGE_PROVIDER is not r2; resolved images will be written to local /uploads paths",
    );
  }
  if (requestedFastRemoteCopy) {
    warn(
      "FAST_REMOTE_IMAGE_COPY=1 is disabled for backfill stability; using buffered uploads. Set FAST_REMOTE_IMAGE_COPY=force only for experiments.",
    );
  }
  if (!r2BaseUrl) {
    warn("R2_PUBLIC_BASE_URL is not set; cannot detect already-migrated Cloudflare URLs reliably");
  } else {
    log("Skipping products whose stored image URLs already point at the configured R2 base URL");
  }
  if (!baseUrl) {
    warn("NEXTAUTH_URL is not set; relative /uploads/* URLs cannot be re-downloaded");
  }
  if (organizationIdFilter) {
    log(`Filtering by organization: ${organizationIdFilter}`);
  }
  log(
    `Batch size ${batchSize}; product concurrency ${productConcurrency}; image concurrency ${imageConcurrency}; write concurrency ${writeConcurrency}`,
  );
  if (!applyChanges && !resolveDryRunImages) {
    log(
      "Dry-run fast scan enabled; set DRY_RUN_RESOLVE_IMAGES=1 to test actual downloads/uploads",
    );
  }
  log(
    `Progress logs every ${progressEveryProducts} products (set PROGRESS_EVERY=1 for every product)`,
  );

  const startedAt = Date.now();
  const imageLimiter = createConcurrencyLimiter(imageConcurrency);
  const writeLimiter = createConcurrencyLimiter(writeConcurrency);
  let processedProducts = 0;
  let scannedPhotoUrls = 0;
  let scannedImageUrls = 0;
  let migratedPhotoUrls = 0;
  let migratedImageUrls = 0;
  let skippedAlreadyCloudflare = 0;
  let skippedMissingBaseUrl = 0;
  let failedResolutions = 0;
  let changedProducts = 0;

  let cursor: string | null = null;
  let batchNumber = 0;

  const logProgress = (reason: string) => {
    const imageWorkers = imageLimiter.stats();
    const writeWorkers = writeLimiter.stats();
    const migratedProgressLabel =
      !applyChanges && !resolveDryRunImages ? "wouldMigrate" : "migrated";
    const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 1);
    const productsPerMinute = Math.round((processedProducts / elapsedSeconds) * 60);
    const attemptedImages = migratedPhotoUrls + migratedImageUrls + failedResolutions;
    const imagesPerMinute = Math.round((attemptedImages / elapsedSeconds) * 60);
    log(
      `${reason}: products=${processedProducts}, changed=${changedProducts}, photos=${scannedPhotoUrls}, images=${scannedImageUrls}, ${migratedProgressLabel}=${migratedPhotoUrls + migratedImageUrls}, failed=${failedResolutions}, productsPerMin=${productsPerMinute}, imagesPerMin=${imagesPerMinute}, imageWorkers=${imageWorkers.active}/${imageConcurrency}, imageQueued=${imageWorkers.queued}, writeWorkers=${writeWorkers.active}/${writeConcurrency}, writeQueued=${writeWorkers.queued}, elapsed=${formatElapsed(startedAt)}`,
    );
  };

  const processProduct = async (product: ProductBatchRow): Promise<ProductBackfillResult> => {
    const result: ProductBackfillResult = {
      changed: false,
      scannedPhotoUrls: 0,
      scannedImageUrls: 0,
      migratedPhotoUrls: 0,
      migratedImageUrls: 0,
      skippedAlreadyCloudflare: 0,
      skippedMissingBaseUrl: 0,
      failedResolutions: 0,
    };
    const cache = new Map<string, Awaited<ReturnType<typeof resolveProductImageUrl>>>();
    const nextImageUrls: string[] = [];
    const nextImageUrlSet = new Set<string>();
    let nextPhotoUrl: string | null | undefined;
    let hadMultiPhotoInput = false;

    const pushImageUrl = (value: string | null) => {
      if (!value) {
        return;
      }
      if (nextImageUrlSet.has(value)) {
        return;
      }
      nextImageUrlSet.add(value);
      nextImageUrls.push(value);
    };

    const resolveCandidate = async (
      rawValue: string,
      kind: "photo" | "image",
    ): Promise<string | null> => {
      const current = rawValue.trim();
      if (!current) {
        return null;
      }
      if (isCloudflareManagedUrl(current)) {
        result.skippedAlreadyCloudflare += 1;
        return current;
      }
      const candidate = normalizeForMigration(current);
      if (!candidate) {
        result.skippedMissingBaseUrl += 1;
        return current;
      }
      if (!applyChanges && !resolveDryRunImages) {
        if (kind === "photo") {
          result.migratedPhotoUrls += 1;
        } else {
          result.migratedImageUrls += 1;
        }
        return toDryRunManagedUrl(candidate);
      }

      return imageLimiter.run(async () => {
        if (verboseImages) {
          log(`Resolving ${kind} image for product ${product.id}: ${candidate}`);
        }
        const resolveStartedAt = Date.now();
        const resolved = await resolveProductImageUrl({
          value: candidate,
          organizationId: product.organizationId,
          productId: product.id,
          cache,
          fallbackToSource: false,
        });
        const resolveElapsedMs = Date.now() - resolveStartedAt;
        if (resolveElapsedMs >= slowResolveMs) {
          warn(
            `Slow ${kind} image resolution (${resolveElapsedMs}ms) for product ${product.id}: ${candidate}`,
          );
        }
        if (resolved.url && resolved.url !== current) {
          if (kind === "photo") {
            result.migratedPhotoUrls += 1;
          } else {
            result.migratedImageUrls += 1;
          }
        } else if (!resolved.url || !resolved.managed) {
          result.failedResolutions += 1;
          return current;
        }
        return resolved.managed ? (resolved.url ?? null) : null;
      });
    };

    if (product.photoUrl) {
      const photoCandidates = splitUrlCandidates(product.photoUrl);
      if (photoCandidates.length > 1) {
        hadMultiPhotoInput = true;
      }
      result.scannedPhotoUrls += photoCandidates.length;
      const resolvedPhotoUrls = (
        await Promise.all(photoCandidates.map((candidate) => resolveCandidate(candidate, "photo")))
      ).filter((url): url is string => Boolean(url));
      if (resolvedPhotoUrls.length) {
        const firstResolved = resolvedPhotoUrls[0];
        if (firstResolved !== product.photoUrl) {
          nextPhotoUrl = firstResolved;
        }
        if (hadMultiPhotoInput) {
          resolvedPhotoUrls.forEach((url) => pushImageUrl(url));
        }
      }
    }

    const imageResolutionTasks = product.images.flatMap((image) => {
      const imageCandidates = splitUrlCandidates(image.url);
      result.scannedImageUrls += imageCandidates.length;
      return imageCandidates.map((candidate) => resolveCandidate(candidate, "image"));
    });
    const resolvedImageUrls = await Promise.all(imageResolutionTasks);
    resolvedImageUrls.forEach((url) => pushImageUrl(url));

    if (!nextImageUrls.length && nextPhotoUrl) {
      pushImageUrl(nextPhotoUrl);
    }

    const currentImageUrls = product.images
      .flatMap((image) => splitUrlCandidates(image.url))
      .map((value) => value.trim())
      .filter(Boolean);
    const hasImageChange =
      nextImageUrls.length > 0 &&
      (currentImageUrls.length !== nextImageUrls.length ||
        currentImageUrls.some((value, index) => value !== nextImageUrls[index]));
    const hasPhotoChange = nextPhotoUrl !== undefined && nextPhotoUrl !== product.photoUrl;
    if (!hasPhotoChange && !hasImageChange) {
      return result;
    }

    result.changed = true;
    if (!applyChanges) {
      return result;
    }

    await runWriteWithLimiter(writeLimiter, `update product ${product.id}`, () =>
      prisma.$transaction(
        async (tx) => {
          if (hasPhotoChange) {
            await tx.product.update({
              where: { id: product.id },
              data: { photoUrl: nextPhotoUrl ?? null },
            });
          }
          if (hasImageChange) {
            await tx.productImage.deleteMany({ where: { productId: product.id } });
            await tx.productImage.createMany({
              data: nextImageUrls.map((url, position) => ({
                organizationId: product.organizationId,
                productId: product.id,
                url,
                position,
              })),
            });
          }
        },
        {
          maxWait: transactionMaxWaitMs,
          timeout: transactionTimeoutMs,
        },
      ),
    );

    return result;
  };

  const productWhere = {
    ...(organizationIdFilter ? { organizationId: organizationIdFilter } : {}),
    ...(r2BaseUrl
      ? {
          OR: [
            {
              AND: [
                { photoUrl: { not: null } },
                { NOT: { photoUrl: { startsWith: r2BaseUrl } } },
              ],
            },
            {
              images: {
                some: {
                  NOT: { url: { startsWith: r2BaseUrl } },
                },
              },
            },
          ],
        }
      : { OR: [{ photoUrl: { not: null } }, { images: { some: {} } }] }),
  };

  while (true) {
    const products: ProductBatchRow[] = await runPrismaWithRetry(
      `fetch product batch ${batchNumber + 1}`,
      () =>
        prisma.product.findMany({
          where: productWhere,
          select: {
            id: true,
            organizationId: true,
            photoUrl: true,
            images: {
              select: {
                id: true,
                url: true,
              },
            },
          },
          orderBy: { id: "asc" },
          take: batchSize,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
    );

    if (!products.length) {
      break;
    }

    batchNumber += 1;
    log(`Fetched batch ${batchNumber}: ${products.length} products`);

    await runWithConcurrency(products, productConcurrency, async (product) => {
      const result = await processProduct(product);
      processedProducts += 1;
      scannedPhotoUrls += result.scannedPhotoUrls;
      scannedImageUrls += result.scannedImageUrls;
      migratedPhotoUrls += result.migratedPhotoUrls;
      migratedImageUrls += result.migratedImageUrls;
      skippedAlreadyCloudflare += result.skippedAlreadyCloudflare;
      skippedMissingBaseUrl += result.skippedMissingBaseUrl;
      failedResolutions += result.failedResolutions;
      if (result.changed) {
        changedProducts += 1;
      }

      if (processedProducts % progressEveryProducts === 0) {
        logProgress("Progress");
      }
    });

    cursor = products[products.length - 1]?.id ?? null;
    logProgress(`Finished batch ${batchNumber}`);
  }

  log(`Done (${mode})`);
  log(`Products scanned: ${processedProducts}`);
  log(`Products with changes: ${changedProducts}`);
  log(`Photo URLs scanned: ${scannedPhotoUrls}`);
  log(`ProductImage URLs scanned: ${scannedImageUrls}`);
  const migratedLabel = !applyChanges && !resolveDryRunImages ? "would migrate" : "migrated";
  log(`Photo URLs ${migratedLabel}: ${migratedPhotoUrls}`);
  log(`ProductImage URLs ${migratedLabel}: ${migratedImageUrls}`);
  log(`Skipped already on Cloudflare: ${skippedAlreadyCloudflare}`);
  log(`Skipped (relative URL but NEXTAUTH_URL missing): ${skippedMissingBaseUrl}`);
  log(`Failed resolutions (kept original URL): ${failedResolutions}`);

  await prisma.$disconnect();
};

void main();
