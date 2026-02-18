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

const isCloudflareManagedUrl = (value: string) =>
  Boolean(r2BaseUrl) && value.startsWith(r2BaseUrl);

const splitUrlCandidates = (value: string) => {
  const trimmed = value.trim();
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
    .map((part) => part.trim())
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

type ProductBatchRow = {
  id: string;
  organizationId: string;
  photoUrl: string | null;
  images: { id: string; url: string }[];
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
  if (!r2BaseUrl) {
    warn("R2_PUBLIC_BASE_URL is not set; cannot detect already-migrated Cloudflare URLs reliably");
  }
  if (!baseUrl) {
    warn("NEXTAUTH_URL is not set; relative /uploads/* URLs cannot be re-downloaded");
  }
  if (organizationIdFilter) {
    log(`Filtering by organization: ${organizationIdFilter}`);
  }

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

  while (true) {
    const products: ProductBatchRow[] = await prisma.product.findMany({
      where: {
        ...(organizationIdFilter ? { organizationId: organizationIdFilter } : {}),
      },
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
    });

    if (!products.length) {
      break;
    }

    for (const product of products) {
      processedProducts += 1;
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
          skippedAlreadyCloudflare += 1;
          return current;
        }
        const candidate = normalizeForMigration(current);
        if (!candidate) {
          skippedMissingBaseUrl += 1;
          return null;
        }
        const resolved = await resolveProductImageUrl({
          value: candidate,
          organizationId: product.organizationId,
          productId: product.id,
          cache,
        });
        if (resolved.url && resolved.url !== current) {
          if (kind === "photo") {
            migratedPhotoUrls += 1;
          } else {
            migratedImageUrls += 1;
          }
        } else if (!resolved.url) {
          failedResolutions += 1;
        }
        return resolved.url ?? null;
      };

      if (product.photoUrl) {
        const photoCandidates = splitUrlCandidates(product.photoUrl);
        if (photoCandidates.length > 1) {
          hadMultiPhotoInput = true;
        }
        scannedPhotoUrls += photoCandidates.length;
        const resolvedPhotoUrls: string[] = [];
        for (const candidate of photoCandidates) {
          const resolved = await resolveCandidate(candidate, "photo");
          if (resolved) {
            resolvedPhotoUrls.push(resolved);
          }
        }
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

      for (const image of product.images) {
        const imageCandidates = splitUrlCandidates(image.url);
        scannedImageUrls += imageCandidates.length;
        for (const candidate of imageCandidates) {
          const resolved = await resolveCandidate(candidate, "image");
          pushImageUrl(resolved);
        }
      }

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
        continue;
      }

      changedProducts += 1;
      if (!applyChanges) {
        continue;
      }

      await prisma.$transaction(async (tx) => {
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
      });
    }

    cursor = products[products.length - 1]?.id ?? null;
    log(`Processed ${processedProducts} products...`);
  }

  log(`Done (${mode})`);
  log(`Products scanned: ${processedProducts}`);
  log(`Products with changes: ${changedProducts}`);
  log(`Photo URLs scanned: ${scannedPhotoUrls}`);
  log(`ProductImage URLs scanned: ${scannedImageUrls}`);
  log(`Photo URLs migrated: ${migratedPhotoUrls}`);
  log(`ProductImage URLs migrated: ${migratedImageUrls}`);
  log(`Skipped already on Cloudflare: ${skippedAlreadyCloudflare}`);
  log(`Skipped (relative URL but NEXTAUTH_URL missing): ${skippedMissingBaseUrl}`);
  log(`Failed resolutions (kept original URL): ${failedResolutions}`);

  await prisma.$disconnect();
};

void main();
