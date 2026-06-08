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

type ProductDescriptionGenerationJobView = {
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
    imageUrl?: string | null;
    product: {
      sku: string;
      name: string;
    };
  }>;
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
  const tCommon = useTranslations("common");
  const running = isDescriptionGenerationJobRunning(job.status);
  const progressPercent =
    typeof job.progressPercent === "number"
      ? job.progressPercent
      : job.totalCount > 0
        ? Math.round((job.processedCount / job.totalCount) * 100)
        : 0;

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-muted/30 p-4">
        <div className="flex items-center justify-between gap-3 text-sm">
          <p className="font-medium text-foreground">
            {t("bulkGenerateDescriptionsProgressLabel", {
              processed: job.processedCount,
              total: job.totalCount,
            })}
          </p>
          <span className="text-sm font-semibold text-foreground">{progressPercent}%</span>
        </div>
        <div className="mt-3 h-2 rounded-md bg-border/70">
          <div
            className="h-2 rounded-md bg-primary transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span>{t("aiDescriptionJobTotal", { count: job.totalCount })}</span>
          <span>{t(`aiDescriptionJobStatus.${job.status}`)}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-md border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">{t("aiDescriptionJobSuccess")}</p>
          <p className="mt-1 text-lg font-semibold text-foreground">{job.successCount}</p>
        </div>
        <div className="rounded-md border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">
            {t("bulkGenerateDescriptionsProgressSkipped")}
          </p>
          <p className="mt-1 text-lg font-semibold text-foreground">{job.skippedCount}</p>
        </div>
        <div className="rounded-md border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">
            {t("bulkGenerateDescriptionsProgressFailed")}
          </p>
          <p className="mt-1 text-lg font-semibold text-foreground">{job.failedCount}</p>
        </div>
        <div className="rounded-md border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">{t("aiDescriptionJobProcessed")}</p>
          <p className="mt-1 text-lg font-semibold text-foreground">{job.processedCount}</p>
        </div>
      </div>

      {job.errorMessage ? (
        <div className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          {job.errorMessage}
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
            {job.items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <p className="font-medium text-foreground">{item.product.name}</p>
                  <p className="font-mono text-xs text-muted-foreground">{item.product.sku}</p>
                </TableCell>
                <TableCell>
                  <ProductThumb imageUrl={item.imageUrl} name={item.product.name} />
                </TableCell>
                <TableCell>
                  <Badge variant={statusBadgeVariant(item.status)}>
                    {t(`aiDescriptionItemStatus.${item.status}`)}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-md">
                  {item.errorMessage ? (
                    <p className="text-sm text-danger">{item.errorMessage}</p>
                  ) : item.generatedDescription ? (
                    <p className="line-clamp-2 text-sm text-muted-foreground">
                      {item.generatedDescription}
                    </p>
                  ) : (
                    <span className="text-sm text-muted-foreground">-</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {!running ? (
        <FormActions>
          {job.failedCount > 0 && onRetryFailed ? (
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
