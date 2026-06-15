"use client";
/* eslint-disable @next/next/no-img-element */

import {
  ProductDescriptionGenerationItemStatus,
  ProductDescriptionGenerationJobStatus,
} from "@prisma/client";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormActions } from "@/components/form-layout";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type ProductDescriptionGenerationJobView = {
  status: ProductDescriptionGenerationJobStatus;
  totalCount: number;
  processedCount: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  errorMessage?: string | null;
  progressPercent?: number;
  items: Array<{
    id: string;
    productId: string;
    status: ProductDescriptionGenerationItemStatus;
    errorMessage?: string | null;
    generatedDescription?: string | null;
    previousDescription?: string | null;
    imageUrl?: string | null;
    product: {
      sku: string;
      name: string;
    };
  }>;
};

type ProductDescriptionGenerationDisplayStatus = ProductDescriptionGenerationJobStatus | "TIMED_OUT";

type NormalizedProductDescriptionGenerationJobView = Omit<
  ProductDescriptionGenerationJobView,
  "status"
> & {
  status: ProductDescriptionGenerationJobStatus;
  displayStatus: ProductDescriptionGenerationDisplayStatus;
  progressPercent: number;
  descriptionGeneratedCount: number;
  descriptionOverwrittenCount: number;
};

const runningJobStatuses = new Set<ProductDescriptionGenerationJobStatus>([
  ProductDescriptionGenerationJobStatus.QUEUED,
  ProductDescriptionGenerationJobStatus.PROCESSING,
]);

const statusBadgeVariant = (
  status: ProductDescriptionGenerationItemStatus | ProductDescriptionGenerationJobStatus,
) => {
  const value = String(status);
  if (
    value === ProductDescriptionGenerationItemStatus.SUCCESS ||
    value === ProductDescriptionGenerationJobStatus.DONE
  ) {
    return "success" as const;
  }
  if (
    value === ProductDescriptionGenerationItemStatus.FAILED ||
    value === ProductDescriptionGenerationJobStatus.FAILED ||
    value === ProductDescriptionGenerationJobStatus.DONE_WITH_ERRORS
  ) {
    return "danger" as const;
  }
  if (
    value === ProductDescriptionGenerationItemStatus.PROCESSING ||
    value === ProductDescriptionGenerationJobStatus.PROCESSING
  ) {
    return "warning" as const;
  }
  return "muted" as const;
};

const ProductThumb = ({ imageUrl, name }: { imageUrl?: string | null; name: string }) => {
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={name}
        className="h-10 w-10 shrink-0 rounded-md border border-border object-cover"
      />
    );
  }
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-dashed border-border bg-secondary text-xs font-medium text-muted-foreground">
      {name.trim().charAt(0).toUpperCase() || "#"}
    </div>
  );
};

export const isDescriptionGenerationJobRunning = (
  status?: ProductDescriptionGenerationJobStatus | null,
) => Boolean(status && runningJobStatuses.has(status));

const countItemsByStatus = (
  items: ProductDescriptionGenerationJobView["items"],
  status: ProductDescriptionGenerationItemStatus,
) => items.filter((item) => item.status === status).length;

const getProgressPercent = (processedCount: number, totalCount: number) =>
  totalCount > 0 ? Math.min(100, Math.round((processedCount / totalCount) * 100)) : 0;

export const normalizeProductDescriptionGenerationJobView = (
  job: ProductDescriptionGenerationJobView,
): NormalizedProductDescriptionGenerationJobView => {
  const successCount = countItemsByStatus(job.items, ProductDescriptionGenerationItemStatus.SUCCESS);
  const failedCount = countItemsByStatus(job.items, ProductDescriptionGenerationItemStatus.FAILED);
  const skippedCount = countItemsByStatus(job.items, ProductDescriptionGenerationItemStatus.SKIPPED);
  const pendingCount = countItemsByStatus(job.items, ProductDescriptionGenerationItemStatus.PENDING);
  const processingCount = countItemsByStatus(
    job.items,
    ProductDescriptionGenerationItemStatus.PROCESSING,
  );
  const cancelledCount = countItemsByStatus(
    job.items,
    ProductDescriptionGenerationItemStatus.CANCELLED,
  );
  const descriptionGeneratedCount = job.items.filter(
    (item) =>
      item.status === ProductDescriptionGenerationItemStatus.SUCCESS &&
      Boolean(item.generatedDescription?.trim()) &&
      !item.previousDescription?.trim(),
  ).length;
  const descriptionOverwrittenCount = job.items.filter(
    (item) =>
      item.status === ProductDescriptionGenerationItemStatus.SUCCESS &&
      Boolean(item.generatedDescription?.trim()) &&
      Boolean(item.previousDescription?.trim()) &&
      item.generatedDescription?.trim() !== item.previousDescription?.trim(),
  ).length;
  const processedCount = successCount + failedCount + skippedCount;
  const totalCount = Math.max(job.totalCount, job.items.length, processedCount);
  const noActiveRows = pendingCount === 0 && processingCount === 0;
  const allRowsHandled = totalCount > 0 && processedCount + cancelledCount >= totalCount;
  const timedOut =
    job.errorMessage === "aiDescriptionJobTimedOut" || job.errorMessage === "aiDescriptionTimedOut";

  let status = job.status;
  if (
    status !== ProductDescriptionGenerationJobStatus.FAILED &&
    status !== ProductDescriptionGenerationJobStatus.CANCELLED &&
    noActiveRows &&
    allRowsHandled
  ) {
    status =
      failedCount > 0 || cancelledCount > 0
        ? ProductDescriptionGenerationJobStatus.DONE_WITH_ERRORS
        : ProductDescriptionGenerationJobStatus.DONE;
  } else if (status === ProductDescriptionGenerationJobStatus.DONE && failedCount > 0) {
    status = ProductDescriptionGenerationJobStatus.DONE_WITH_ERRORS;
  }

  return {
    ...job,
    status,
    displayStatus: timedOut ? "TIMED_OUT" : status,
    totalCount,
    processedCount,
    successCount,
    failedCount,
    skippedCount,
    progressPercent: getProgressPercent(processedCount, totalCount),
    descriptionGeneratedCount,
    descriptionOverwrittenCount,
  };
};

export const ProductDescriptionGenerationProgress = ({
  job,
  onClose,
  onRetryFailed,
  retryDisabled,
}: {
  job: ProductDescriptionGenerationJobView;
  onClose: () => void;
  onRetryFailed?: () => void;
  retryDisabled?: boolean;
}) => {
  const t = useTranslations("products");
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");
  const normalizedJob = normalizeProductDescriptionGenerationJobView(job);
  const running = isDescriptionGenerationJobRunning(normalizedJob.status);
  const formatErrorMessage = (message?: string | null) => {
    if (!message) {
      return "";
    }
    return tErrors.has?.(message) ? tErrors(message) : message;
  };
  const formatItemReason = (message?: string | null) => {
    if (!message) {
      return "";
    }
    switch (message) {
      case "aiDescriptionImageRequired":
        return t("aiDescriptionReasonNoPhoto");
      case "aiDescriptionNoUsableImages":
        return t("aiDescriptionReasonImageLoadFailed");
      case "descriptionAlreadyExists":
        return t("aiDescriptionReasonAlreadyExists");
      case "descriptionAndSpecsAlreadyExist":
        return t("aiDescriptionReasonDescriptionAndSpecsAlreadyExist");
      case "specsAlreadyExist":
        return t("aiDescriptionReasonSpecsAlreadyExist");
      case "missingCategory":
        return t("aiDescriptionReasonMissingCategory");
      case "missingSpecTemplate":
        return t("aiDescriptionReasonMissingSpecTemplate");
      case "noSupportedSpecFields":
        return t("aiDescriptionReasonNoSupportedSpecFields");
      case "noResolvedSpecValues":
        return t("aiDescriptionReasonNoResolvedSpecValues");
      case "aiSpecNoUsableImages":
        return t("aiDescriptionReasonSpecImageLoadFailed");
      case "productNotFound":
        return t("aiDescriptionReasonProductDataFailed");
      case "aiDescriptionTimedOut":
        return t("aiDescriptionReasonProviderTimeout");
      case "aiDescriptionJobTimedOut":
        return t("aiDescriptionReasonJobTimedOut");
      default:
        return formatErrorMessage(message);
    }
  };
  const renderItemResult = (item: ProductDescriptionGenerationJobView["items"][number]) => {
    if (item.errorMessage) {
      const reason = formatItemReason(item.errorMessage);
      const text =
        item.status === ProductDescriptionGenerationItemStatus.SKIPPED
          ? t("aiDescriptionSkippedReason", { reason })
          : item.status === ProductDescriptionGenerationItemStatus.FAILED
            ? t("aiDescriptionFailedReason", { reason })
            : reason;
      return (
        <p className="whitespace-normal break-words text-sm text-danger" title={text}>
          {text}
        </p>
      );
    }
    if (item.generatedDescription) {
      return (
        <p
          className="line-clamp-2 whitespace-normal break-words text-sm text-muted-foreground"
          title={item.generatedDescription}
        >
          {item.generatedDescription}
        </p>
      );
    }
    return <span className="text-sm text-muted-foreground">-</span>;
  };

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-3 text-sm">
          <p className="font-medium text-foreground">
            {t("bulkGenerateDescriptionsProgressLabel", {
              processed: normalizedJob.processedCount,
              total: normalizedJob.totalCount,
            })}
          </p>
          <span className="text-sm font-semibold text-foreground">
            {normalizedJob.progressPercent}%
          </span>
        </div>
        <div className="mt-3 h-2 rounded-md bg-border/70">
          <div
            className="h-2 rounded-md bg-primary transition-all duration-300"
            style={{ width: `${normalizedJob.progressPercent}%` }}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span>{t("aiDescriptionJobTotal", { count: normalizedJob.totalCount })}</span>
          <span>{t(`aiDescriptionJobStatus.${normalizedJob.displayStatus}`)}</span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">{t("aiDescriptionJobGenerated")}</p>
            <p className="mt-1 text-lg font-semibold text-foreground">
              {normalizedJob.descriptionGeneratedCount}
            </p>
          </div>
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">{t("aiDescriptionJobOverwritten")}</p>
            <p className="mt-1 text-lg font-semibold text-foreground">
              {normalizedJob.descriptionOverwrittenCount}
            </p>
          </div>
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">
              {t("bulkGenerateDescriptionsProgressSkipped")}
            </p>
            <p className="mt-1 text-lg font-semibold text-foreground">
              {normalizedJob.skippedCount}
            </p>
          </div>
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">
              {t("bulkGenerateDescriptionsProgressFailed")}
            </p>
            <p className="mt-1 text-lg font-semibold text-foreground">
              {normalizedJob.failedCount}
            </p>
          </div>
        </div>
      </div>

      {normalizedJob.errorMessage ? (
        <div className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          {formatErrorMessage(normalizedJob.errorMessage)}
        </div>
      ) : null}

      <div className="max-h-80 overflow-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("aiDescriptionJobProduct")}</TableHead>
              <TableHead className="w-16">{t("aiDescriptionJobPhoto")}</TableHead>
              <TableHead>{t("aiDescriptionJobItemStatus")}</TableHead>
              <TableHead>{t("aiDescriptionJobResult")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {normalizedJob.items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <p className="font-medium text-foreground">{item.product.name}</p>
                  {item.product.sku ? (
                    <p className="font-mono text-xs text-muted-foreground">{item.product.sku}</p>
                  ) : null}
                </TableCell>
                <TableCell>
                  <ProductThumb imageUrl={item.imageUrl} name={item.product.name} />
                </TableCell>
                <TableCell>
                  <Badge variant={statusBadgeVariant(item.status)}>
                    {t(`aiDescriptionItemStatus.${item.status}`)}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-md">{renderItemResult(item)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {!running ? (
        <FormActions>
          {normalizedJob.failedCount > 0 && onRetryFailed ? (
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={onRetryFailed}
              disabled={retryDisabled}
            >
              {t("aiDescriptionRetryFailed")}
            </Button>
          ) : null}
          <Button type="button" variant="secondary" className="w-full sm:w-auto" onClick={onClose}>
            {tCommon("close")}
          </Button>
        </FormActions>
      ) : null}
    </div>
  );
};
