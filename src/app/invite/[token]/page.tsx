"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { LanguageSwitcher } from "@/components/language-switcher";
import { FormStack } from "@/components/form-layout";
import { useToast } from "@/components/ui/toast";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";

const InvitePage = () => {
  const params = useParams();
  const token = String(params?.token ?? "");
  const t = useTranslations("invite");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const { toast } = useToast();
  const [accepted, setAccepted] = useState(false);
  const [values, setValues] = useState<{ name: string; password: string; preferredLocale: "ru" | "kg" }>({
    name: "",
    password: "",
    preferredLocale: "ru",
  });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<"name" | "password" | "preferredLocale", string>>>({});

  const inviteQuery = trpc.publicAuth.inviteDetails.useQuery({ token }, { enabled: Boolean(token) });

  const schema = z.object({
    name: z.string().min(2, t("nameRequired")),
    password: z.string().min(8, t("passwordMin")),
    preferredLocale: z.enum(["ru", "kg"]),
  });

  const acceptMutation = trpc.publicAuth.acceptInvite.useMutation({
    onSuccess: async (_, variables) => {
      await fetch("/api/locale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: variables.preferredLocale }),
      });
      toast({ variant: "success", description: t("accepted") });
      setAccepted(true);
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      const nextErrors: Partial<Record<"name" | "password" | "preferredLocale", string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === "string" && (key === "name" || key === "password" || key === "preferredLocale")) {
          nextErrors[key] = issue.message;
        }
      }
      setFieldErrors(nextErrors);
      return;
    }
    setFieldErrors({});
    acceptMutation.mutate({ token, ...parsed.data });
  };

  if (accepted) {
    return (
      <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-4 py-8 sm:py-12">
        <div className="flex justify-end">
          <LanguageSwitcher />
        </div>
        <Card>
          <CardHeader>
            <CardTitle>{t("acceptedTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>{t("acceptedHint")}</p>
            <Link href="/login" className="text-sm font-semibold text-primary hover:text-primary/80">
              {t("goToLogin")}
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-4 py-8 sm:py-12">
      <div className="flex justify-end">
        <LanguageSwitcher />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {inviteQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" />
              {tCommon("loading")}
            </div>
          ) : inviteQuery.data ? (
            <>
              <div className="rounded-md border border-border/70 bg-muted/30 p-3 text-sm text-muted-foreground">
                <p>{t("inviteFor", { org: inviteQuery.data.organizationName })}</p>
                <p>{t("inviteEmail", { email: inviteQuery.data.email })}</p>
                <p>{t("inviteRole", { role: inviteQuery.data.role })}</p>
              </div>
              <form onSubmit={handleSubmit}>
                <FormStack>
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-foreground" htmlFor="invite-name">
                      {t("name")}
                    </label>
                    <Input
                      id="invite-name"
                      placeholder={t("namePlaceholder")}
                      value={values.name}
                      onChange={(event) => {
                        const next = event.target.value;
                        setValues((prev) => ({ ...prev, name: next }));
                        if (fieldErrors.name) {
                          setFieldErrors((prev) => ({ ...prev, name: undefined }));
                        }
                      }}
                    />
                    {fieldErrors.name ? <p className="text-xs font-medium text-danger">{fieldErrors.name}</p> : null}
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-foreground" htmlFor="invite-password">
                      {t("password")}
                    </label>
                    <Input
                      id="invite-password"
                      type="password"
                      placeholder={t("passwordPlaceholder")}
                      value={values.password}
                      onChange={(event) => {
                        const next = event.target.value;
                        setValues((prev) => ({ ...prev, password: next }));
                        if (fieldErrors.password) {
                          setFieldErrors((prev) => ({ ...prev, password: undefined }));
                        }
                      }}
                    />
                    {fieldErrors.password ? (
                      <p className="text-xs font-medium text-danger">{fieldErrors.password}</p>
                    ) : null}
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-foreground">{t("preferredLocale")}</label>
                    <Select
                      value={values.preferredLocale}
                      onValueChange={(value) => {
                        setValues((prev) => ({ ...prev, preferredLocale: value as "ru" | "kg" }));
                        if (fieldErrors.preferredLocale) {
                          setFieldErrors((prev) => ({ ...prev, preferredLocale: undefined }));
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t("selectLocale")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ru">{tCommon("locales.ru")}</SelectItem>
                        <SelectItem value="kg">{tCommon("locales.kg")}</SelectItem>
                      </SelectContent>
                    </Select>
                    {fieldErrors.preferredLocale ? (
                      <p className="text-xs font-medium text-danger">{fieldErrors.preferredLocale}</p>
                    ) : null}
                  </div>
                  <Button type="submit" className="w-full" disabled={acceptMutation.isLoading}>
                    {acceptMutation.isLoading ? tCommon("loading") : t("accept")}
                  </Button>
                </FormStack>
              </form>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t("invalidInvite")}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default InvitePage;
