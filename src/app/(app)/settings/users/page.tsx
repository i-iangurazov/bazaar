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
import { Spinner } from "@/components/ui/spinner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ResponsiveDataList } from "@/components/responsive-data-list";
import { RowActions } from "@/components/row-actions";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  Field,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { FormActions, FormGrid } from "@/components/form-layout";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import {
  ArchiveIcon,
  EditIcon,
  EmptyIcon,
  MoreIcon,
  RestoreIcon,
  StatusDangerIcon,
  StatusSuccessIcon,
} from "@/components/icons";
import { IconButton } from "@/components/ui/icon-button";
import { defaultLocale, normalizeLocale } from "@/lib/locales";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import { formatDateTime } from "@/lib/i18nFormat";
import { useConfirmDialog } from "@/components/ui/use-confirm-dialog";

const UsersPage = () => {
  const t = useTranslations("users");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const { data: session, status } = useSession();
  const currentUserId = session?.user?.id;
  const role = session?.user?.role;
  const isAdmin = role === "ADMIN";
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirmDialog();
  const isForbidden = status === "authenticated" && !isAdmin;
  const usersQuery = trpc.users.list.useQuery(undefined, { enabled: isAdmin });

  type UserRow = NonNullable<typeof usersQuery.data>[number];

  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const [isDialogOpen, setDialogOpen] = useState(false);
  const [resetUser, setResetUser] = useState<UserRow | null>(null);

  const isEditing = Boolean(editingUser);
  const isSelf = editingUser?.id === currentUserId;

  const schema = useMemo(
    () =>
      z.object({
        name: z.string().min(2, t("nameRequired")),
        email: z.string().email(t("emailInvalid")),
        role: z.enum(["ADMIN", "MANAGER", "STAFF", "CASHIER"]),
        preferredLocale: z.enum(["ru", "kg"]),
        isActive: z.boolean(),
        password: isEditing
          ? z.string().optional()
          : z.string().min(8, t("passwordRequired")),
      }),
    [t, isEditing],
  );

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      email: "",
      role: "STAFF",
      preferredLocale: "ru",
      isActive: true,
      password: "",
    },
  });

  const resetSchema = useMemo(
    () =>
      z
        .object({
          password: z.string().min(8, t("passwordRequired")),
          confirmPassword: z.string().min(8, t("passwordRequired")),
        })
        .refine((values) => values.password === values.confirmPassword, {
          message: t("passwordMismatch"),
          path: ["confirmPassword"],
        }),
    [t],
  );

  const resetForm = useForm<z.infer<typeof resetSchema>>({
    resolver: zodResolver(resetSchema),
    defaultValues: {
      password: "",
      confirmPassword: "",
    },
  });

  const inviteSchema = useMemo(
    () =>
      z.object({
        email: z.string().email(t("emailInvalid")),
        role: z.enum(["ADMIN", "MANAGER", "STAFF", "CASHIER"]),
      }),
    [t],
  );

  const inviteForm = useForm<z.infer<typeof inviteSchema>>({
    resolver: zodResolver(inviteSchema),
    defaultValues: {
      email: "",
      role: "STAFF",
    },
  });

  const createMutation = trpc.users.create.useMutation({
    onSuccess: () => {
      usersQuery.refetch();
      toast({ variant: "success", description: t("createSuccess") });
      form.reset();
      setDialogOpen(false);
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const invitesQuery = trpc.invites.list.useQuery(undefined, { enabled: isAdmin });
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  const inviteMutation = trpc.invites.create.useMutation({
    onSuccess: (result) => {
      invitesQuery.refetch();
      inviteForm.reset({ email: "", role: "STAFF" });
      if (typeof window !== "undefined") {
        setInviteLink(`${window.location.origin}/invite/${result.token}`);
      }
      toast({ variant: "success", description: t("inviteCreated") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const handleCopyInvite = async () => {
    if (!inviteLink) {
      return;
    }
    try {
      await navigator.clipboard.writeText(inviteLink);
      toast({ variant: "success", description: t("inviteCopied") });
    } catch {
      toast({ variant: "error", description: t("inviteCopyFailed") });
    }
  };

  const updateMutation = trpc.users.update.useMutation({
    onSuccess: () => {
      usersQuery.refetch();
      toast({ variant: "success", description: t("updateSuccess") });
      form.reset();
      setEditingUser(null);
      setDialogOpen(false);
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const setActiveMutation = trpc.users.setActive.useMutation({
    onSuccess: () => {
      usersQuery.refetch();
      toast({ variant: "success", description: t("statusUpdated") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const resetPasswordMutation = trpc.users.resetPassword.useMutation({
    onSuccess: () => {
      usersQuery.refetch();
      toast({ variant: "success", description: t("resetSuccess") });
      resetForm.reset();
      setResetUser(null);
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const isSaving =
    createMutation.isLoading || updateMutation.isLoading || setActiveMutation.isLoading;

  const openCreateDialog = () => {
    setEditingUser(null);
    form.reset({
      name: "",
      email: "",
      role: "STAFF",
      preferredLocale: "ru",
      isActive: true,
      password: "",
    });
    setDialogOpen(true);
  };

  const openEditDialog = (user: UserRow) => {
    setEditingUser(user);
    form.reset({
      name: user.name,
      email: user.email,
      role: user.role,
      preferredLocale: normalizeLocale(user.preferredLocale) ?? defaultLocale,
      isActive: user.isActive,
      password: "",
    });
    setDialogOpen(true);
  };

  const roleLabel = (role: string) => {
    switch (role) {
      case "ADMIN":
        return tCommon("roles.admin");
      case "MANAGER":
        return tCommon("roles.manager");
      case "STAFF":
        return tCommon("roles.staff");
      case "CASHIER":
        return tCommon("roles.cashier");
      default:
        return role;
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
          <Button className="w-full sm:w-auto" onClick={openCreateDialog}>
            {t("addUser")}
          </Button>
        }
      />

      <div className="mt-6 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{t("title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <ResponsiveDataList
              items={usersQuery.data ?? []}
              getKey={(user) => user.id}
              renderDesktop={(visibleItems) => (
                <div className="overflow-x-auto">
                  <Table className="min-w-[720px]" data-tour="users-table">
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("name")}</TableHead>
                        <TableHead className="hidden sm:table-cell">{t("email")}</TableHead>
                        <TableHead>{t("role")}</TableHead>
                        <TableHead>{t("locale")}</TableHead>
                        <TableHead>{t("status")}</TableHead>
                        <TableHead>{tCommon("actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleItems.map((user) => {
                        const isUpdating =
                          (setActiveMutation.isLoading &&
                            setActiveMutation.variables?.userId === user.id) ||
                          (updateMutation.isLoading && updateMutation.variables?.userId === user.id);
                        const isStatusUpdating =
                          setActiveMutation.isLoading && setActiveMutation.variables?.userId === user.id;
                        return (
                          <TableRow key={user.id}>
                            <TableCell className="font-medium">{user.name}</TableCell>
                            <TableCell className="text-xs text-muted-foreground hidden sm:table-cell">
                              {user.email}
                            </TableCell>
                            <TableCell>{roleLabel(user.role)}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {tCommon(`locales.${user.preferredLocale}`)}
                            </TableCell>
                            <TableCell>
                              <Badge variant={user.isActive ? "success" : "danger"}>
                                {user.isActive ? (
                                  <StatusSuccessIcon className="h-3 w-3" aria-hidden />
                                ) : (
                                  <StatusDangerIcon className="h-3 w-3" aria-hidden />
                                )}
                                {user.isActive ? t("active") : t("inactive")}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <span>
                                    <IconButton
                                      icon={MoreIcon}
                                      label={tCommon("tooltips.moreActions")}
                                      variant="ghost"
                                      disabled={isUpdating}
                                    />
                                  </span>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onSelect={() => openEditDialog(user)}>
                                    <span className="flex items-center gap-2">
                                      <EditIcon className="h-4 w-4" aria-hidden />
                                      {t("edit")}
                                    </span>
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onSelect={() => setResetUser(user)}>
                                    <span className="flex items-center gap-2">
                                      <RestoreIcon className="h-4 w-4" aria-hidden />
                                      {t("resetPassword")}
                                    </span>
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onSelect={async () => {
                                      const nextActive = !user.isActive;
                                      if (
                                        !(await confirm({
                                          description: t(nextActive ? "confirmEnable" : "confirmDisable"),
                                          confirmVariant: "danger",
                                        }))
                                      ) {
                                        return;
                                      }
                                      setActiveMutation.mutate({
                                        userId: user.id,
                                        isActive: nextActive,
                                      });
                                    }}
                                    disabled={user.id === currentUserId || isStatusUpdating}
                                  >
                                    <span className="flex items-center gap-2">
                                      {isStatusUpdating ? <Spinner className="h-3 w-3" /> : null}
                                      {!isStatusUpdating ? (
                                        user.isActive ? (
                                          <ArchiveIcon className="h-4 w-4" aria-hidden />
                                        ) : (
                                          <StatusSuccessIcon className="h-4 w-4" aria-hidden />
                                        )
                                      ) : null}
                                      {isStatusUpdating
                                        ? tCommon("loading")
                                        : user.isActive
                                          ? t("disable")
                                          : t("enable")}
                                    </span>
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
              renderMobile={(user) => {
                const isUpdating =
                  (setActiveMutation.isLoading &&
                    setActiveMutation.variables?.userId === user.id) ||
                  (updateMutation.isLoading && updateMutation.variables?.userId === user.id);
                const isStatusUpdating =
                  setActiveMutation.isLoading && setActiveMutation.variables?.userId === user.id;
                const actions = [
                  {
                    key: "edit",
                    label: t("edit"),
                    icon: EditIcon,
                    onSelect: () => openEditDialog(user),
                    disabled: isUpdating,
                  },
                  {
                    key: "reset",
                    label: t("resetPassword"),
                    icon: RestoreIcon,
                    onSelect: () => setResetUser(user),
                    disabled: isUpdating,
                  },
                  {
                    key: "toggle",
                    label: user.isActive ? t("disable") : t("enable"),
                    icon: user.isActive ? ArchiveIcon : StatusSuccessIcon,
                    onSelect: async () => {
                      const nextActive = !user.isActive;
                      if (
                        !(await confirm({
                          description: t(nextActive ? "confirmEnable" : "confirmDisable"),
                          confirmVariant: "danger",
                        }))
                      ) {
                        return;
                      }
                      setActiveMutation.mutate({ userId: user.id, isActive: nextActive });
                    },
                    disabled: user.id === currentUserId || isStatusUpdating || isUpdating,
                    variant: user.isActive ? "danger" : "secondary",
                  },
                ];

                return (
                  <div className="rounded-md border border-border bg-card p-3 shadow-sm">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-semibold text-foreground">{user.name}</p>
                          <Badge variant={user.isActive ? "success" : "danger"}>
                            {user.isActive ? (
                              <StatusSuccessIcon className="h-3 w-3" aria-hidden />
                            ) : (
                              <StatusDangerIcon className="h-3 w-3" aria-hidden />
                            )}
                            {user.isActive ? t("active") : t("inactive")}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">{user.email}</p>
                        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                          <span>
                            {t("role")}:{" "}
                            <span className="text-foreground">{roleLabel(user.role)}</span>
                          </span>
                          <span>
                            {t("locale")}:{" "}
                            <span className="text-foreground">
                              {tCommon(`locales.${user.preferredLocale}`)}
                            </span>
                          </span>
                        </div>
                      </div>
                      <RowActions
                        actions={actions}
                        maxInline={2}
                        moreLabel={tCommon("tooltips.moreActions")}
                      />
                    </div>
                  </div>
                );
              }}
            />
            {usersQuery.isLoading ? (
              <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" />
              {tCommon("loading")}
            </div>
            ) : !usersQuery.data?.length ? (
              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <EmptyIcon className="h-4 w-4" aria-hidden />
                  {t("noUsers")}
                </div>
              </div>
            ) : null}
            {usersQuery.error ? (
              <div className="flex flex-wrap items-center gap-2 text-sm text-danger">
                <span>{translateError(tErrors, usersQuery.error)}</span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => usersQuery.refetch()}
                >
                  {tErrors("tryAgain")}
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("inviteTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <Form {...inviteForm}>
              <form
                className="space-y-4"
                onSubmit={inviteForm.handleSubmit((values) => inviteMutation.mutate(values))}
              >
                <FormGrid>
                  <FormField
                    control={inviteForm.control}
                    name="email"
                    render={({ field }) => (
                      <Field label={t("inviteEmail")}>
                        <FormControl>
                          <Input {...field} type="email" placeholder={t("emailPlaceholder")} />
                        </FormControl>
                      </Field>
                    )}
                  />
                  <FormField
                    control={inviteForm.control}
                    name="role"
                    render={({ field }) => (
                      <Field label={t("inviteRole")}>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder={t("rolePlaceholder")} />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="ADMIN">{tCommon("roles.admin")}</SelectItem>
                            <SelectItem value="MANAGER">{tCommon("roles.manager")}</SelectItem>
                            <SelectItem value="CASHIER">{tCommon("roles.cashier")}</SelectItem>
                            <SelectItem value="STAFF">{tCommon("roles.staff")}</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                    )}
                  />
                </FormGrid>
                <FormActions>
                  <Button
                    type="submit"
                    disabled={inviteMutation.isLoading}
                    data-tour="users-invite"
                  >
                    {inviteMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
                    {inviteMutation.isLoading ? tCommon("loading") : t("inviteSend")}
                  </Button>
                </FormActions>
              </form>
            </Form>

            {inviteLink ? (
              <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{t("inviteLinkReady")}</span>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <code className="break-all rounded bg-card px-2 py-1">{inviteLink}</code>
                  <Button type="button" variant="secondary" onClick={handleCopyInvite}>
                    {t("inviteCopy")}
                  </Button>
                </div>
              </div>
            ) : null}

            <ResponsiveDataList
              items={invitesQuery.data ?? []}
              getKey={(invite) => invite.id}
              renderDesktop={(visibleItems) => (
                <div className="overflow-x-auto">
                  <Table className="min-w-[640px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("inviteEmail")}</TableHead>
                        <TableHead>{t("inviteRole")}</TableHead>
                        <TableHead>{t("inviteStatus")}</TableHead>
                        <TableHead>{t("inviteExpires")}</TableHead>
                        <TableHead>{t("inviteCreatedBy")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleItems.map((invite) => {
                        const isExpired = invite.expiresAt < new Date();
                        const status = invite.acceptedAt
                          ? t("inviteAccepted")
                          : isExpired
                            ? t("inviteExpired")
                            : t("invitePending");
                        return (
                          <TableRow key={invite.id}>
                            <TableCell className="font-medium">{invite.email}</TableCell>
                            <TableCell>{roleLabel(invite.role)}</TableCell>
                            <TableCell>{status}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {formatDateTime(invite.expiresAt, locale)}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {invite.createdBy?.name ??
                                invite.createdBy?.email ??
                                tCommon("notAvailable")}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
              renderMobile={(invite) => {
                const isExpired = invite.expiresAt < new Date();
                const status = invite.acceptedAt
                  ? t("inviteAccepted")
                  : isExpired
                    ? t("inviteExpired")
                    : t("invitePending");

                return (
                  <div className="rounded-md border border-border bg-card p-3 shadow-sm">
                    <div className="space-y-2">
                      <p className="truncate text-sm font-semibold text-foreground">{invite.email}</p>
                      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                        <span>
                          {t("inviteRole")}:{" "}
                          <span className="text-foreground">{roleLabel(invite.role)}</span>
                        </span>
                        <span>
                          {t("inviteStatus")}: <span className="text-foreground">{status}</span>
                        </span>
                        <span>
                          {t("inviteExpires")}:{" "}
                          <span className="text-foreground">
                            {formatDateTime(invite.expiresAt, locale)}
                          </span>
                        </span>
                        <span>
                          {t("inviteCreatedBy")}:{" "}
                          <span className="text-foreground">
                            {invite.createdBy?.name ??
                              invite.createdBy?.email ??
                              tCommon("notAvailable")}
                          </span>
                        </span>
                      </div>
                    </div>
                  </div>
                );
              }}
            />
            {invitesQuery.isLoading ? (
              <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" />
              {tCommon("loading")}
            </div>
            ) : !invitesQuery.data?.length ? (
              <p className="text-sm text-muted-foreground">{t("inviteEmpty")}</p>
            ) : null}
            {invitesQuery.error ? (
              <div className="flex flex-wrap items-center gap-2 text-sm text-danger">
                <span>{translateError(tErrors, invitesQuery.error)}</span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => invitesQuery.refetch()}
                >
                  {tErrors("tryAgain")}
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Modal
        open={isDialogOpen}
        onOpenChange={setDialogOpen}
        title={isEditing ? t("editUser") : t("addUser")}
        subtitle={isEditing ? editingUser?.email : t("addUserSubtitle")}
      >
        <Form {...form}>
          <form
            className="flex flex-col gap-3 sm:gap-4"
            onSubmit={form.handleSubmit(async (values) => {
              if (isEditing && editingUser) {
                try {
                  await updateMutation.mutateAsync({
                    userId: editingUser.id,
                    name: values.name,
                    email: values.email,
                    role: values.role,
                    preferredLocale: values.preferredLocale,
                  });
                  if (values.isActive !== editingUser.isActive) {
                    await setActiveMutation.mutateAsync({
                      userId: editingUser.id,
                      isActive: values.isActive,
                    });
                  }
                } catch {
                  // Errors are handled by mutation onError toasts.
                }
                return;
              }

              try {
                const created = await createMutation.mutateAsync({
                  name: values.name,
                  email: values.email,
                  role: values.role,
                  preferredLocale: values.preferredLocale,
                  password: values.password ?? "",
                });
                if (!values.isActive) {
                  await setActiveMutation.mutateAsync({
                    userId: created.id,
                    isActive: false,
                  });
                }
              } catch {
                // Errors are handled by mutation onError toasts.
              }
            })}
          >
            <FormGrid>
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("name")}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder={t("namePlaceholder")} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("email")}</FormLabel>
                    <FormControl>
                      <Input {...field} type="email" placeholder={t("emailPlaceholder")} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </FormGrid>
            <FormGrid>
              <FormField
                control={form.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("role")}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={t("rolePlaceholder")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="ADMIN">{tCommon("roles.admin")}</SelectItem>
                        <SelectItem value="MANAGER">{tCommon("roles.manager")}</SelectItem>
                        <SelectItem value="CASHIER">{tCommon("roles.cashier")}</SelectItem>
                        <SelectItem value="STAFF">{tCommon("roles.staff")}</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription>{t("roleHint")}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="preferredLocale"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("locale")}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={t("localePlaceholder")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="ru">{tCommon("locales.ru")}</SelectItem>
                        <SelectItem value="kg">{tCommon("locales.kg")}</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription>{t("localeHint")}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </FormGrid>
            <FormField
              control={form.control}
              name="isActive"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
                    <div className="space-y-1">
                      <FormLabel>{t("status")}</FormLabel>
                      <FormDescription>{t("statusHint")}</FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={Boolean(isSelf)}
                      />
                    </FormControl>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
            {!isEditing ? (
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("password")}</FormLabel>
                    <FormControl>
                      <Input {...field} type="password" placeholder={t("passwordPlaceholder")} />
                    </FormControl>
                    <FormDescription>{t("passwordHint")}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}
            <FormActions>
              <Button type="button" variant="secondary" onClick={() => setDialogOpen(false)}>
                {tCommon("cancel")}
              </Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving ? <Spinner className="h-4 w-4" /> : null}
                {isSaving
                  ? tCommon("loading")
                  : isEditing
                    ? t("save")
                    : t("create")}
              </Button>
            </FormActions>
          </form>
        </Form>
      </Modal>

      <Modal
        open={Boolean(resetUser)}
        onOpenChange={(open) => {
          if (!open) {
            setResetUser(null);
          }
        }}
        title={t("resetPassword")}
        subtitle={resetUser?.email}
      >
        <Form {...resetForm}>
          <form
            className="flex flex-col gap-3 sm:gap-4"
            onSubmit={resetForm.handleSubmit((values) => {
              if (!resetUser) {
                return;
              }
              resetPasswordMutation.mutate({
                userId: resetUser.id,
                password: values.password,
              });
            })}
          >
            <FormGrid>
              <FormField
                control={resetForm.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("password")}</FormLabel>
                    <FormControl>
                      <Input {...field} type="password" placeholder={t("passwordPlaceholder")} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={resetForm.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("confirmPassword")}</FormLabel>
                    <FormControl>
                      <Input {...field} type="password" placeholder={t("passwordPlaceholder")} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </FormGrid>
            <FormActions>
              <Button type="button" variant="secondary" onClick={() => setResetUser(null)}>
                {tCommon("cancel")}
              </Button>
              <Button type="submit" disabled={resetPasswordMutation.isLoading}>
                {resetPasswordMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
                {resetPasswordMutation.isLoading ? tCommon("loading") : t("resetPassword")}
              </Button>
            </FormActions>
          </form>
        </Form>
      </Modal>
      {confirmDialog}
    </div>
  );
};

export default UsersPage;
