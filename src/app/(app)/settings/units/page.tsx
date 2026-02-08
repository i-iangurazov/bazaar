"use client";

import { useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { FormActions, FormGrid } from "@/components/form-layout";
import { useToast } from "@/components/ui/toast";
import { AddIcon, DeleteIcon, EditIcon, EmptyIcon } from "@/components/icons";
import { ResponsiveDataList } from "@/components/responsive-data-list";
import { RowActions } from "@/components/row-actions";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";

const UnitsPage = () => {
  const t = useTranslations("units");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const { data: session, status } = useSession();
  const isAdmin = session?.user?.role === "ADMIN";
  const isForbidden = status === "authenticated" && !isAdmin;
  const { toast } = useToast();

  const unitsQuery = trpc.units.list.useQuery(undefined, { enabled: isAdmin });
  type UnitRow = NonNullable<typeof unitsQuery.data>[number];

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<UnitRow | null>(null);

  const schema = useMemo(
    () =>
      z.object({
        code: z.string().min(1, t("codeRequired")),
        labelRu: z.string().min(1, t("labelRequired")),
        labelKg: z.string().min(1, t("labelRequired")),
      }),
    [t],
  );

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      code: "",
      labelRu: "",
      labelKg: "",
    },
  });

  const createMutation = trpc.units.create.useMutation({
    onSuccess: () => {
      unitsQuery.refetch();
      toast({ variant: "success", description: t("createSuccess") });
      setDialogOpen(false);
      setEditing(null);
      form.reset();
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const updateMutation = trpc.units.update.useMutation({
    onSuccess: () => {
      unitsQuery.refetch();
      toast({ variant: "success", description: t("updateSuccess") });
      setDialogOpen(false);
      setEditing(null);
      form.reset();
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const removeMutation = trpc.units.remove.useMutation({
    onSuccess: () => {
      unitsQuery.refetch();
      toast({ variant: "success", description: t("removeSuccess") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const isSaving = createMutation.isLoading || updateMutation.isLoading;

  const openCreate = () => {
    setEditing(null);
    form.reset({ code: "", labelRu: "", labelKg: "" });
    setDialogOpen(true);
  };

  const openEdit = (unit: UnitRow) => {
    setEditing(unit);
    form.reset({ code: unit.code, labelRu: unit.labelRu, labelKg: unit.labelKg });
    setDialogOpen(true);
  };

  const onSubmit = (values: z.infer<typeof schema>) => {
    if (editing) {
      updateMutation.mutate({
        unitId: editing.id,
        labelRu: values.labelRu.trim(),
        labelKg: values.labelKg.trim(),
      });
      return;
    }
    createMutation.mutate({
      code: values.code.trim(),
      labelRu: values.labelRu.trim(),
      labelKg: values.labelKg.trim(),
    });
  };

  if (isForbidden) {
    return (
      <div>
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <p className="mt-4 text-sm text-red-500">{tErrors("forbidden")}</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        action={
          <Button onClick={openCreate} className="w-full sm:w-auto">
            <AddIcon className="h-4 w-4" aria-hidden />
            {t("create")}
          </Button>
        }
      />

      <Card className="mt-6">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>{t("title")}</CardTitle>
          <Badge variant="muted">
            {t("count", { count: unitsQuery.data?.length ?? 0 })}
          </Badge>
        </CardHeader>
        <CardContent>
          {unitsQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Spinner className="h-4 w-4" />
              {tCommon("loading")}
            </div>
          ) : !unitsQuery.data?.length ? (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <EmptyIcon className="h-4 w-4" aria-hidden />
              {t("empty")}
            </div>
          ) : (
            <ResponsiveDataList
              items={unitsQuery.data}
              getKey={(unit) => unit.id}
              renderDesktop={(visibleItems) => (
                <div className="overflow-x-auto">
                  <TooltipProvider>
                    <Table className="min-w-[520px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("code")}</TableHead>
                          <TableHead>{t("labelRu")}</TableHead>
                          <TableHead>{t("labelKg")}</TableHead>
                          <TableHead className="text-right">{tCommon("actions")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {visibleItems.map((unit) => (
                          <TableRow key={unit.id}>
                            <TableCell className="font-medium">{unit.code}</TableCell>
                            <TableCell>{unit.labelRu}</TableCell>
                            <TableCell>{unit.labelKg}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-2">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8"
                                      aria-label={tCommon("edit")}
                                      onClick={() => openEdit(unit)}
                                    >
                                      <EditIcon className="h-4 w-4" aria-hidden />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>{tCommon("edit")}</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8 text-danger"
                                      aria-label={tCommon("delete")}
                                      onClick={() => removeMutation.mutate({ unitId: unit.id })}
                                      disabled={removeMutation.isLoading}
                                    >
                                      <DeleteIcon className="h-4 w-4" aria-hidden />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>{tCommon("delete")}</TooltipContent>
                                </Tooltip>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TooltipProvider>
                </div>
              )}
              renderMobile={(unit) => (
                <div className="rounded-md border border-gray-200 bg-white p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink">{unit.code}</p>
                      <p className="text-xs text-gray-500">{unit.labelRu}</p>
                      <p className="text-xs text-gray-500">{unit.labelKg}</p>
                    </div>
                    <RowActions
                      actions={[
                        {
                          key: "edit",
                          label: tCommon("edit"),
                          icon: EditIcon,
                          onSelect: () => openEdit(unit),
                        },
                        {
                          key: "delete",
                          label: tCommon("delete"),
                          icon: DeleteIcon,
                          variant: "danger",
                          disabled: removeMutation.isLoading,
                          onSelect: () => removeMutation.mutate({ unitId: unit.id }),
                        },
                      ]}
                      maxInline={1}
                      moreLabel={tCommon("tooltips.moreActions")}
                    />
                  </div>
                </div>
              )}
            />
          )}
          {unitsQuery.error ? (
            <p className="mt-3 text-sm text-red-500">
              {translateError(tErrors, unitsQuery.error)}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Modal
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDialogOpen(false);
            setEditing(null);
          }
        }}
        title={editing ? t("editTitle") : t("createTitle")}
        subtitle={editing ? editing.code : t("createSubtitle")}
      >
        <Form {...form}>
          <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
            <FormGrid>
              <FormField
                control={form.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("code")}</FormLabel>
                    <FormControl>
                      <Input {...field} disabled={Boolean(editing)} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="labelRu"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("labelRu")}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="labelKg"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("labelKg")}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </FormGrid>
            <FormActions>
              <Button
                type="button"
                variant="secondary"
                className="w-full sm:w-auto"
                onClick={() => setDialogOpen(false)}
              >
                {tCommon("cancel")}
              </Button>
              <Button type="submit" className="w-full sm:w-auto" disabled={isSaving}>
                {isSaving ? <Spinner className="h-4 w-4" /> : null}
                {isSaving ? tCommon("loading") : tCommon("save")}
              </Button>
            </FormActions>
          </form>
        </Form>
      </Modal>
    </div>
  );
};

export default UnitsPage;
