"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ResponsiveDataList } from "@/components/responsive-data-list";
import { RowActions } from "@/components/row-actions";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { FormActions } from "@/components/form-layout";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { AddIcon, EmptyIcon, ViewIcon } from "@/components/icons";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/i18nFormat";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";

const statusVariants: Record<string, "default" | "warning" | "success" | "danger"> = {
  DRAFT: "default",
  IN_PROGRESS: "warning",
  APPLIED: "success",
  CANCELLED: "danger",
};

const StockCountsPage = () => {
  const t = useTranslations("stockCounts");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const { data: session } = useSession();
  const role = session?.user?.role;
  const canManage = role === "ADMIN" || role === "MANAGER";
  const { toast } = useToast();

  const storesQuery = trpc.stores.list.useQuery();
  const [storeId, setStoreId] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if (!storeId && storesQuery.data?.[0]) {
      setStoreId(storesQuery.data[0].id);
    }
  }, [storeId, storesQuery.data]);

  const countsQuery = trpc.stockCounts.list.useQuery(
    {
      storeId: storeId ?? "",
      status:
        statusFilter === "ALL"
          ? undefined
          : (statusFilter as "DRAFT" | "IN_PROGRESS" | "APPLIED" | "CANCELLED"),
    },
    { enabled: Boolean(storeId) },
  );

  type CountRow = NonNullable<typeof countsQuery.data>[number];
  const counts: CountRow[] = countsQuery.data ?? [];

  const createSchema = useMemo(
    () =>
      z.object({
        notes: z.string().optional(),
      }),
    [],
  );

  const createForm = useForm<z.infer<typeof createSchema>>({
    resolver: zodResolver(createSchema),
    defaultValues: { notes: "" },
  });

  const createMutation = trpc.stockCounts.create.useMutation({
    onSuccess: (count) => {
      toast({ variant: "success", description: t("createSuccess") });
      setDialogOpen(false);
      createForm.reset();
      countsQuery.refetch();
      if (count?.id) {
        window.location.href = `/inventory/counts/${count.id}`;
      }
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const statusLabel = (status: string) => {
    switch (status) {
      case "DRAFT":
        return t("statusDraft");
      case "IN_PROGRESS":
        return t("statusInProgress");
      case "APPLIED":
        return t("statusApplied");
      case "CANCELLED":
        return t("statusCancelled");
      default:
        return status;
    }
  };

  return (
    <div>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        action={
          <Button
            data-tour="stock-count-create"
            className="w-full sm:w-auto"
            onClick={() => setDialogOpen(true)}
            disabled={!storeId || createMutation.isLoading}
          >
            <AddIcon className="h-4 w-4" aria-hidden />
            {t("create")}
          </Button>
        }
        filters={
          <div className="flex w-full flex-col gap-3 sm:flex-row">
            <div className="w-full sm:max-w-xs">
              <Select value={storeId} onValueChange={setStoreId}>
                <SelectTrigger>
                  <SelectValue placeholder={tCommon("selectStore")} />
                </SelectTrigger>
                <SelectContent>
                  {storesQuery.data?.map((store) => (
                    <SelectItem key={store.id} value={store.id}>
                      {store.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-full sm:max-w-xs">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder={t("statusAll")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">{t("statusAll")}</SelectItem>
                  <SelectItem value="DRAFT">{t("statusDraft")}</SelectItem>
                  <SelectItem value="IN_PROGRESS">{t("statusInProgress")}</SelectItem>
                  <SelectItem value="APPLIED">{t("statusApplied")}</SelectItem>
                  <SelectItem value="CANCELLED">{t("statusCancelled")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        }
      />

      {countsQuery.error ? (
        <p className="mb-4 text-sm text-danger">
          {translateError(tErrors, countsQuery.error)}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("listTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {countsQuery.isLoading ? (
            <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" />
              {tCommon("loading")}
            </div>
          ) : counts.length ? (
            <ResponsiveDataList
              items={counts}
              getKey={(count) => count.id}
              renderDesktop={(visibleItems) => (
                <div className="overflow-x-auto">
                  <Table className="min-w-[720px]" data-tour="stock-count-table">
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("code")}</TableHead>
                        <TableHead>{t("status")}</TableHead>
                        <TableHead>{t("lines")}</TableHead>
                        <TableHead className="hidden md:table-cell">{t("startedAt")}</TableHead>
                        <TableHead className="hidden md:table-cell">{t("appliedAt")}</TableHead>
                        <TableHead>{tCommon("actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleItems.map((count) => (
                        <TableRow key={count.id}>
                          <TableCell className="font-medium">{count.code}</TableCell>
                          <TableCell>
                            <Badge variant={statusVariants[count.status] ?? "default"}>
                              {statusLabel(count.status)}
                            </Badge>
                          </TableCell>
                          <TableCell>{count._count.lines}</TableCell>
                          <TableCell className="hidden md:table-cell">
                            {count.startedAt
                              ? formatDateTime(count.startedAt, locale)
                              : tCommon("notAvailable")}
                          </TableCell>
                          <TableCell className="hidden md:table-cell">
                            {count.appliedAt
                              ? formatDateTime(count.appliedAt, locale)
                              : tCommon("notAvailable")}
                          </TableCell>
                          <TableCell>
                            <Button variant="ghost" size="icon" asChild aria-label={tCommon("view")}>
                              <Link href={`/inventory/counts/${count.id}`}>
                                <ViewIcon className="h-4 w-4" aria-hidden />
                              </Link>
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              renderMobile={(count) => (
                <div className="rounded-md border border-border bg-card p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-foreground">{count.code}</p>
                      <Badge variant={statusVariants[count.status] ?? "default"}>
                        {statusLabel(count.status)}
                      </Badge>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("lines")}: {count._count.lines}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t("startedAt")}:{" "}
                        {count.startedAt
                          ? formatDateTime(count.startedAt, locale)
                          : tCommon("notAvailable")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t("appliedAt")}:{" "}
                        {count.appliedAt
                          ? formatDateTime(count.appliedAt, locale)
                          : tCommon("notAvailable")}
                      </p>
                    </div>
                    <RowActions
                      actions={[
                        {
                          key: "view",
                          label: tCommon("view"),
                          icon: ViewIcon,
                          href: `/inventory/counts/${count.id}`,
                        },
                      ]}
                      maxInline={1}
                      moreLabel={tCommon("tooltips.moreActions")}
                    />
                  </div>
                </div>
              )}
            />
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <EmptyIcon className="h-4 w-4" aria-hidden />
              {t("empty")}
            </div>
          )}
        </CardContent>
      </Card>

      <Modal
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDialogOpen(false);
            createForm.reset();
          }
        }}
        title={t("create")}
        subtitle={canManage ? t("createSubtitle") : t("createSubtitleStaff")}
      >
        <Form {...createForm}>
          <form
            className="space-y-4"
            onSubmit={createForm.handleSubmit((values) => {
              if (!storeId) {
                return;
              }
              createMutation.mutate({ storeId, notes: values.notes });
            })}
          >
            <FormField
              control={createForm.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("notes")}</FormLabel>
                  <FormControl>
                    <Textarea {...field} placeholder={t("notesPlaceholder")} rows={4} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormActions>
              <Button
                type="button"
                variant="secondary"
                className="w-full sm:w-auto"
                onClick={() => setDialogOpen(false)}
              >
                {tCommon("cancel")}
              </Button>
              <Button
                type="submit"
                className="w-full sm:w-auto"
                disabled={createMutation.isLoading}
              >
                {createMutation.isLoading ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <AddIcon className="h-4 w-4" aria-hidden />
                )}
                {createMutation.isLoading ? tCommon("loading") : t("create")}
              </Button>
            </FormActions>
          </form>
        </Form>
      </Modal>
    </div>
  );
};

export default StockCountsPage;
