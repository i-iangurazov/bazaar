"use client";

import { useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
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
import { Switch } from "@/components/ui/switch";
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
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { FormActions, FormGrid, FormRow, FormSection } from "@/components/form-layout";
import { useToast } from "@/components/ui/toast";
import { AddIcon, CloseIcon, DeleteIcon, EditIcon, EmptyIcon } from "@/components/icons";
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
import { useConfirmDialog } from "@/components/ui/use-confirm-dialog";

const AttributesPage = () => {
  const t = useTranslations("attributes");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const { data: session, status } = useSession();
  const isAdmin = session?.user?.role === "ADMIN";
  const isForbidden = status === "authenticated" && !isAdmin;
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirmDialog();

  const attributesQuery = trpc.attributes.list.useQuery(undefined, { enabled: isAdmin });
  const templatesQuery = trpc.categoryTemplates.list.useQuery(undefined, { enabled: isAdmin });
  const categoriesQuery = trpc.categoryTemplates.categories.useQuery(undefined, { enabled: isAdmin });

  type AttributeRow = NonNullable<typeof attributesQuery.data>[number];
  type TemplateRow = NonNullable<typeof templatesQuery.data>[number];

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AttributeRow | null>(null);
  const [optionRuInput, setOptionRuInput] = useState("");
  const [optionKgInput, setOptionKgInput] = useState("");
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [templateCategory, setTemplateCategory] = useState("");
  const [templateAttributes, setTemplateAttributes] = useState<string[]>([]);
  const [templateDraftKey, setTemplateDraftKey] = useState("");

  const schema = useMemo(
    () =>
      z
        .object({
          key: z.string().min(1, t("keyRequired")),
          labelRu: z.string().min(1, t("labelRequired")),
          labelKg: z.string().min(1, t("labelRequired")),
          type: z.enum(["TEXT", "NUMBER", "SELECT", "MULTI_SELECT"]),
          optionsRu: z.array(z.string()).optional(),
          optionsKg: z.array(z.string()).optional(),
          required: z.boolean().optional(),
        })
        .superRefine((values, ctx) => {
          const needsOptions = values.type === "SELECT" || values.type === "MULTI_SELECT";
          const hasRu = (values.optionsRu?.length ?? 0) > 0;
          const hasKg = (values.optionsKg?.length ?? 0) > 0;
          if (needsOptions && (!hasRu || !hasKg)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: t("optionsRequired"),
              path: ["optionsRu"],
            });
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: t("optionsRequired"),
              path: ["optionsKg"],
            });
          }
        }),
    [t],
  );

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      key: "",
      labelRu: "",
      labelKg: "",
      type: "TEXT",
      optionsRu: [],
      optionsKg: [],
      required: false,
    },
  });

  const typeValue = form.watch("type");
  const showOptions = typeValue === "SELECT" || typeValue === "MULTI_SELECT";
  const definitionMap = useMemo(
    () =>
      new Map((attributesQuery.data ?? []).map((attribute) => [attribute.key, attribute])),
    [attributesQuery.data],
  );
  const resolveLabel = (attribute?: AttributeRow, fallbackKey?: string) => {
    if (!attribute) {
      return fallbackKey ?? "";
    }
    return locale === "kg" ? attribute.labelKg : attribute.labelRu;
  };

  const templateGroups = useMemo(() => {
    const groups = new Map<string, { category: string; items: TemplateRow[] }>();
    (templatesQuery.data ?? []).forEach((item) => {
      const group = groups.get(item.category) ?? { category: item.category, items: [] };
      group.items.push(item);
      groups.set(item.category, group);
    });
    return Array.from(groups.values())
      .map((group) => ({
        category: group.category,
        items: [...group.items].sort((a, b) => a.order - b.order),
      }))
      .sort((a, b) => a.category.localeCompare(b.category));
  }, [templatesQuery.data]);

  const templateMap = useMemo(() => {
    const map = new Map<string, string[]>();
    templateGroups.forEach((group) => {
      map.set(
        group.category,
        group.items.map((item) => item.attributeKey),
      );
    });
    return map;
  }, [templateGroups]);

  const availableTemplateDefinitions = useMemo(
    () =>
      (attributesQuery.data ?? []).filter(
        (definition) => !templateAttributes.includes(definition.key),
      ),
    [attributesQuery.data, templateAttributes],
  );

  const createMutation = trpc.attributes.create.useMutation({
    onSuccess: () => {
      attributesQuery.refetch();
      toast({ variant: "success", description: t("createSuccess") });
      form.reset();
      setDialogOpen(false);
      setOptionRuInput("");
      setOptionKgInput("");
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const updateMutation = trpc.attributes.update.useMutation({
    onSuccess: () => {
      attributesQuery.refetch();
      toast({ variant: "success", description: t("updateSuccess") });
      form.reset();
      setEditing(null);
      setDialogOpen(false);
      setOptionRuInput("");
      setOptionKgInput("");
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const removeMutation = trpc.attributes.remove.useMutation({
    onSuccess: () => {
      attributesQuery.refetch();
      toast({ variant: "success", description: t("removeSuccess") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const setTemplateMutation = trpc.categoryTemplates.set.useMutation({
    onSuccess: () => {
      templatesQuery.refetch();
      categoriesQuery.refetch();
      toast({ variant: "success", description: t("templateSaved") });
      setTemplateDialogOpen(false);
      setEditingCategory(null);
      setTemplateCategory("");
      setTemplateAttributes([]);
      setTemplateDraftKey("");
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const removeTemplateMutation = trpc.categoryTemplates.remove.useMutation({
    onSuccess: () => {
      templatesQuery.refetch();
      categoriesQuery.refetch();
      toast({ variant: "success", description: t("templateRemoved") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const isSaving = createMutation.isLoading || updateMutation.isLoading;

  const openCreate = () => {
    setEditing(null);
    form.reset({
      key: "",
      labelRu: "",
      labelKg: "",
      type: "TEXT",
      optionsRu: [],
      optionsKg: [],
      required: false,
    });
    setOptionRuInput("");
    setOptionKgInput("");
    setDialogOpen(true);
  };

  const openEdit = (attribute: AttributeRow) => {
    setEditing(attribute);
    form.reset({
      key: attribute.key,
      labelRu: attribute.labelRu,
      labelKg: attribute.labelKg,
      type: attribute.type,
      optionsRu: Array.isArray(attribute.optionsRu) ? (attribute.optionsRu as string[]) : [],
      optionsKg: Array.isArray(attribute.optionsKg) ? (attribute.optionsKg as string[]) : [],
      required: attribute.required ?? false,
    });
    setOptionRuInput("");
    setOptionKgInput("");
    setDialogOpen(true);
  };

  const openTemplateCreate = () => {
    setEditingCategory(null);
    setTemplateCategory("");
    setTemplateAttributes([]);
    setTemplateDraftKey("");
    setTemplateDialogOpen(true);
  };

  const openTemplateEdit = (category: string) => {
    setEditingCategory(category);
    setTemplateCategory(category);
    setTemplateAttributes(templateMap.get(category) ?? []);
    setTemplateDraftKey("");
    setTemplateDialogOpen(true);
  };

  const submitTemplate = () => {
    const category = templateCategory.trim();
    if (!category) {
      toast({ variant: "error", description: t("templateCategoryRequired") });
      return;
    }
    if (!templateAttributes.length) {
      toast({ variant: "error", description: t("templateAttributesRequired") });
      return;
    }
    setTemplateMutation.mutate({
      category,
      attributeKeys: templateAttributes,
    });
  };

  const onSubmit = (values: z.infer<typeof schema>) => {
    const payload = {
      key: values.key.trim(),
      labelRu: values.labelRu.trim(),
      labelKg: values.labelKg.trim(),
      type: values.type,
      optionsRu: values.optionsRu?.map((value) => value.trim()).filter(Boolean),
      optionsKg: values.optionsKg?.map((value) => value.trim()).filter(Boolean),
      required: values.required ?? false,
    };
    if (editing) {
      updateMutation.mutate({ id: editing.id, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  if (isForbidden) {
    return (
      <div>
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <p className="mt-4 text-sm text-danger">{tErrors("forbidden")}</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        action={
          <Button className="w-full sm:w-auto" onClick={openCreate} disabled={!isAdmin}>
            <AddIcon className="h-4 w-4" aria-hidden />
            {t("addAttribute")}
          </Button>
        }
      />

      {attributesQuery.isLoading ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" />
              {tCommon("loading")}
            </div>
      ) : attributesQuery.error ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-danger">
          <span>{translateError(tErrors, attributesQuery.error)}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => attributesQuery.refetch()}
          >
            {tErrors("tryAgain")}
          </Button>
        </div>
      ) : attributesQuery.data?.length ? (
        <div className="mt-4">
          <ResponsiveDataList
            items={attributesQuery.data}
            getKey={(attribute) => attribute.id}
            renderDesktop={(visibleItems) => (
              <div className="overflow-x-auto">
                <Table className="min-w-[640px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("key")}</TableHead>
                      <TableHead>{t("labelRu")}</TableHead>
                      <TableHead>{t("labelKg")}</TableHead>
                      <TableHead>{t("type")}</TableHead>
                      <TableHead>{t("required")}</TableHead>
                      <TableHead>{tCommon("actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleItems.map((attribute: AttributeRow) => (
                      <TableRow key={attribute.id}>
                        <TableCell className="font-mono text-xs">{attribute.key}</TableCell>
                        <TableCell>{attribute.labelRu}</TableCell>
                        <TableCell>{attribute.labelKg}</TableCell>
                        <TableCell>{t(`types.${attribute.type}`)}</TableCell>
                        <TableCell>
                          {attribute.required ? (
                            <Badge variant="muted">{t("requiredYes")}</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">{t("requiredNo")}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8"
                                    aria-label={t("edit")}
                                    onClick={() => openEdit(attribute)}
                                  >
                                    <EditIcon className="h-4 w-4" aria-hidden />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>{t("edit")}</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8 text-danger hover:text-danger"
                                    aria-label={t("remove")}
                                    onClick={async () => {
                                      if (!(await confirm({ description: t("confirmRemove"), confirmVariant: "danger" }))) {
                                        return;
                                      }
                                      removeMutation.mutate({ id: attribute.id });
                                    }}
                                    disabled={removeMutation.isLoading}
                                  >
                                    <DeleteIcon className="h-4 w-4" aria-hidden />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>{t("remove")}</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            renderMobile={(attribute) => (
              <div className="rounded-md border border-border bg-card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-muted-foreground">{attribute.key}</p>
                    <p className="text-sm font-medium text-foreground">{attribute.labelRu}</p>
                    <p className="text-xs text-muted-foreground">{attribute.labelKg}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{t(`types.${attribute.type}`)}</p>
                    <div className="mt-1">
                      {attribute.required ? (
                        <Badge variant="muted">{t("requiredYes")}</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">{t("requiredNo")}</span>
                      )}
                    </div>
                  </div>
                  <RowActions
                    actions={[
                      {
                        key: "edit",
                        label: t("edit"),
                        icon: EditIcon,
                        onSelect: () => openEdit(attribute),
                      },
                      {
                        key: "remove",
                        label: t("remove"),
                        icon: DeleteIcon,
                        variant: "danger",
                        disabled: removeMutation.isLoading,
                        onSelect: async () => {
                          if (!(await confirm({ description: t("confirmRemove"), confirmVariant: "danger" }))) {
                            return;
                          }
                          removeMutation.mutate({ id: attribute.id });
                        },
                      },
                    ]}
                    maxInline={1}
                    moreLabel={tCommon("tooltips.moreActions")}
                  />
                </div>
              </div>
            )}
          />
        </div>
      ) : (
        <div className="mt-6 rounded-lg border border-dashed border-border p-6 text-center">
          <EmptyIcon className="mx-auto h-6 w-6 text-muted-foreground/80" aria-hidden />
          <p className="mt-2 text-sm font-semibold text-foreground">{t("emptyTitle")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("emptySubtitle")}</p>
        </div>
      )}

      <Card className="mt-8">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>{t("templatesTitle")}</CardTitle>
            <p className="text-xs text-muted-foreground">{t("templatesSubtitle")}</p>
          </div>
          <Button
            type="button"
            className="w-full sm:w-auto"
            onClick={openTemplateCreate}
            disabled={!isAdmin || !(attributesQuery.data ?? []).length}
          >
            <AddIcon className="h-4 w-4" aria-hidden />
            {t("templateCreate")}
          </Button>
        </CardHeader>
        <CardContent>
          {templatesQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" />
              {tCommon("loading")}
            </div>
          ) : templatesQuery.error ? (
            <div className="flex flex-wrap items-center gap-2 text-sm text-danger">
              <span>{translateError(tErrors, templatesQuery.error)}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => templatesQuery.refetch()}
              >
                {tErrors("tryAgain")}
              </Button>
            </div>
          ) : templateGroups.length ? (
            <div className="space-y-3">
              {templateGroups.map((group) => (
                <div
                  key={group.category}
                  className="rounded-lg border border-border/70 bg-card p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{group.category}</p>
                      <p className="text-xs text-muted-foreground">
                        {t("templateCount", { count: group.items.length })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              aria-label={tCommon("edit")}
                              onClick={() => openTemplateEdit(group.category)}
                            >
                              <EditIcon className="h-4 w-4" aria-hidden />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{tCommon("edit")}</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-danger hover:text-danger"
                              aria-label={tCommon("delete")}
                              onClick={async () => {
                                if (
                                  !(await confirm({
                                    description: t("templateRemoveConfirm"),
                                    confirmVariant: "danger",
                                  }))
                                ) {
                                  return;
                                }
                                removeTemplateMutation.mutate({ category: group.category });
                              }}
                              disabled={removeTemplateMutation.isLoading}
                            >
                              <DeleteIcon className="h-4 w-4" aria-hidden />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{tCommon("delete")}</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {group.items.map((item) => (
                      <Badge key={item.attributeKey} variant="muted">
                        {resolveLabel(definitionMap.get(item.attributeKey), item.attributeKey)}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <EmptyIcon className="h-4 w-4" aria-hidden />
              {t("templateEmpty")}
            </div>
          )}
          {!attributesQuery.data?.length ? (
            <p className="mt-3 text-xs text-muted-foreground">{t("templateNoDefinitions")}</p>
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
        subtitle={editing ? t("editSubtitle") : t("createSubtitle")}
      >
        <Form {...form}>
          <form className="space-y-5" onSubmit={form.handleSubmit(onSubmit)}>
            <FormSection>
              <FormGrid>
                <FormField
                  control={form.control}
                  name="key"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("key")}</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder={t("keyPlaceholder")} disabled={isSaving} />
                      </FormControl>
                      <FormDescription>{t("keyHint")}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("type")}</FormLabel>
                      <FormControl>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger>
                            <SelectValue placeholder={t("selectType")} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="TEXT">{t("types.TEXT")}</SelectItem>
                            <SelectItem value="NUMBER">{t("types.NUMBER")}</SelectItem>
                            <SelectItem value="SELECT">{t("types.SELECT")}</SelectItem>
                            <SelectItem value="MULTI_SELECT">{t("types.MULTI_SELECT")}</SelectItem>
                          </SelectContent>
                        </Select>
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
                        <Input {...field} placeholder={t("labelPlaceholder")} disabled={isSaving} />
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
                        <Input {...field} placeholder={t("labelPlaceholder")} disabled={isSaving} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </FormGrid>

              <FormField
                control={form.control}
                name="required"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between gap-3 rounded-md border border-border/70 p-3">
                      <div>
                        <FormLabel>{t("required")}</FormLabel>
                        <FormDescription>{t("requiredHint")}</FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </div>
                  </FormItem>
                )}
              />

              {showOptions ? (
                <div className="space-y-4">
                  <FormField
                    control={form.control}
                    name="optionsRu"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("optionsRu")}</FormLabel>
                        <FormRow className="flex-col items-stretch sm:flex-row sm:items-end">
                          <FormControl>
                            <Input
                              value={optionRuInput}
                              onChange={(event) => setOptionRuInput(event.target.value)}
                              placeholder={t("optionPlaceholder")}
                              disabled={isSaving}
                            />
                          </FormControl>
                          <Button
                            type="button"
                            variant="secondary"
                            className="w-full sm:w-auto"
                            onClick={() => {
                              const value = optionRuInput.trim();
                              if (!value) {
                                return;
                              }
                              if (field.value?.includes(value)) {
                                form.setError("optionsRu", { message: t("optionDuplicate") });
                                return;
                              }
                              form.clearErrors("optionsRu");
                              const next = [...(field.value ?? []), value];
                              form.setValue("optionsRu", next, { shouldValidate: true });
                              setOptionRuInput("");
                            }}
                          >
                            <AddIcon className="h-4 w-4" aria-hidden />
                            {t("addOption")}
                          </Button>
                        </FormRow>
                        <div className="flex min-h-[36px] flex-wrap gap-2">
                          {field.value?.length ? (
                            field.value.map((option, index) => (
                              <Badge key={`${option}-${index}`} variant="muted" className="gap-1 pr-1">
                                <span>{option}</span>
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6 shadow-none"
                                  aria-label={t("removeOption")}
                                  onClick={() => {
                                    const next = (field.value ?? []).filter((_, i) => i !== index);
                                    form.setValue("optionsRu", next, { shouldValidate: true });
                                  }}
                                >
                                  <DeleteIcon className="h-3 w-3" aria-hidden />
                                </Button>
                              </Badge>
                            ))
                          ) : (
                            <p className="text-xs text-muted-foreground">{t("optionsEmpty")}</p>
                          )}
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="optionsKg"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("optionsKg")}</FormLabel>
                        <FormRow className="flex-col items-stretch sm:flex-row sm:items-end">
                          <FormControl>
                            <Input
                              value={optionKgInput}
                              onChange={(event) => setOptionKgInput(event.target.value)}
                              placeholder={t("optionPlaceholder")}
                              disabled={isSaving}
                            />
                          </FormControl>
                          <Button
                            type="button"
                            variant="secondary"
                            className="w-full sm:w-auto"
                            onClick={() => {
                              const value = optionKgInput.trim();
                              if (!value) {
                                return;
                              }
                              if (field.value?.includes(value)) {
                                form.setError("optionsKg", { message: t("optionDuplicate") });
                                return;
                              }
                              form.clearErrors("optionsKg");
                              const next = [...(field.value ?? []), value];
                              form.setValue("optionsKg", next, { shouldValidate: true });
                              setOptionKgInput("");
                            }}
                          >
                            <AddIcon className="h-4 w-4" aria-hidden />
                            {t("addOption")}
                          </Button>
                        </FormRow>
                        <div className="flex min-h-[36px] flex-wrap gap-2">
                          {field.value?.length ? (
                            field.value.map((option, index) => (
                              <Badge key={`${option}-${index}`} variant="muted" className="gap-1 pr-1">
                                <span>{option}</span>
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6 shadow-none"
                                  aria-label={t("removeOption")}
                                  onClick={() => {
                                    const next = (field.value ?? []).filter((_, i) => i !== index);
                                    form.setValue("optionsKg", next, { shouldValidate: true });
                                  }}
                                >
                                  <DeleteIcon className="h-3 w-3" aria-hidden />
                                </Button>
                              </Badge>
                            ))
                          ) : (
                            <p className="text-xs text-muted-foreground">{t("optionsEmpty")}</p>
                          )}
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              ) : null}
            </FormSection>

            <FormActions>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setDialogOpen(false)}
                disabled={isSaving}
              >
                {tCommon("cancel")}
              </Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving ? <Spinner className="h-4 w-4" /> : null}
                {isSaving ? tCommon("saving") : tCommon("save")}
              </Button>
            </FormActions>
          </form>
        </Form>
      </Modal>

      <Modal
        open={templateDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setTemplateDialogOpen(false);
            setEditingCategory(null);
            setTemplateCategory("");
            setTemplateAttributes([]);
            setTemplateDraftKey("");
          }
        }}
        title={editingCategory ? t("templateEditTitle") : t("templateCreateTitle")}
        subtitle={editingCategory ?? t("templateCreateSubtitle")}
      >
        <div className="space-y-5">
          <FormSection>
            <FormGrid>
              <FormItem>
                <FormLabel>{t("templateCategory")}</FormLabel>
                <FormControl>
                  <Input
                    value={templateCategory}
                    onChange={(event) => setTemplateCategory(event.target.value)}
                    placeholder={t("templateCategoryPlaceholder")}
                    list="category-options"
                    disabled={Boolean(editingCategory)}
                  />
                </FormControl>
                <datalist id="category-options">
                  {(categoriesQuery.data ?? []).map((category) => (
                    <option key={category} value={category} />
                  ))}
                </datalist>
                <FormDescription>{t("templateCategoryHint")}</FormDescription>
              </FormItem>
            </FormGrid>
          </FormSection>

          <FormSection title={t("templateAttributes")}>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={templateDraftKey}
                onValueChange={(value) => setTemplateDraftKey(value)}
                disabled={!availableTemplateDefinitions.length}
              >
                <SelectTrigger className="min-w-[220px]">
                  <SelectValue placeholder={t("templateAddAttribute")} />
                </SelectTrigger>
                <SelectContent>
                  {availableTemplateDefinitions.map((definition) => (
                    <SelectItem key={definition.key} value={definition.key}>
                      {resolveLabel(definition, definition.key)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="secondary"
                className="h-9"
                onClick={() => {
                  if (!templateDraftKey) {
                    return;
                  }
                  setTemplateAttributes((prev) =>
                    prev.includes(templateDraftKey) ? prev : [...prev, templateDraftKey],
                  );
                  setTemplateDraftKey("");
                }}
                disabled={!templateDraftKey}
              >
                <AddIcon className="h-4 w-4" aria-hidden />
                {t("templateAddAttribute")}
              </Button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {templateAttributes.length ? (
                templateAttributes.map((key) => (
                  <Badge key={key} variant="muted" className="gap-1 pr-1">
                    <span>{resolveLabel(definitionMap.get(key), key)}</span>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      aria-label={t("remove")}
                      onClick={() =>
                        setTemplateAttributes((prev) => prev.filter((entry) => entry !== key))
                      }
                    >
                      <CloseIcon className="h-3 w-3" aria-hidden />
                    </Button>
                  </Badge>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">{t("templateAttributesEmpty")}</p>
              )}
            </div>
            <FormDescription>{t("templateAttributesHint")}</FormDescription>
          </FormSection>

          <FormActions>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setTemplateDialogOpen(false)}
              disabled={setTemplateMutation.isLoading}
            >
              {tCommon("cancel")}
            </Button>
            <Button
              type="button"
              onClick={submitTemplate}
              disabled={setTemplateMutation.isLoading}
            >
              {setTemplateMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
              {setTemplateMutation.isLoading ? tCommon("saving") : tCommon("save")}
            </Button>
          </FormActions>
        </div>
      </Modal>
      {confirmDialog}
    </div>
  );
};

export default AttributesPage;
