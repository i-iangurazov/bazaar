"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";
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

type RequestValues = {
  email: string;
  orgName?: string;
};

type SignupValues = {
  email: string;
  password: string;
  name: string;
  preferredLocale: "ru" | "kg";
};

const SignupPage = () => {
  const t = useTranslations("signup");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const { toast } = useToast();
  const router = useRouter();

  const [submitted, setSubmitted] = useState(false);
  const [requestValues, setRequestValues] = useState<RequestValues>({ email: "", orgName: "" });
  const [signupValues, setSignupValues] = useState<SignupValues>({
    email: "",
    password: "",
    name: "",
    preferredLocale: "ru",
  });
  const [requestFieldErrors, setRequestFieldErrors] = useState<Partial<Record<keyof RequestValues, string>>>({});
  const [signupFieldErrors, setSignupFieldErrors] = useState<Partial<Record<keyof SignupValues, string>>>({});

  const modeQuery = trpc.publicAuth.signupMode.useQuery();
  const mode = modeQuery.data?.mode ?? "invite_only";

  const requestSchema = useMemo(
    () =>
      z.object({
        email: z.string().email(t("emailInvalid")),
        orgName: z.string().optional(),
      }),
    [t],
  );

  const signupSchema = useMemo(
    () =>
      z.object({
        email: z.string().email(t("emailInvalid")),
        password: z.string().min(8, t("passwordMin")),
        name: z.string().min(2, t("nameRequired")),
        preferredLocale: z.enum(["ru", "kg"]),
      }),
    [t],
  );

  const buildFieldErrors = (issues: z.ZodIssue[]) => {
    const errors: Record<string, string> = {};
    for (const issue of issues) {
      const path = issue.path[0];
      if (typeof path === "string" && !errors[path]) {
        errors[path] = issue.message;
      }
    }
    return errors;
  };

  const requestMutation = trpc.publicAuth.requestAccess.useMutation({
    onSuccess: () => {
      setSubmitted(true);
      toast({ variant: "success", description: t("requestSuccess") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const signupMutation = trpc.publicAuth.signup.useMutation({
    onSuccess: async (result, variables) => {
      if (result.nextPath) {
        setSubmitted(true);
        await fetch("/api/locale", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locale: variables.preferredLocale }),
        });
        router.push(result.nextPath);
        return;
      }
      setSubmitted(true);
      await fetch("/api/locale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: variables.preferredLocale }),
      });
      toast({ variant: "success", description: t("signupSuccess") });
      if (result.verifyLink) {
        toast({ variant: "info", description: t("verifyHint") });
      }
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const handleRequestSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = requestSchema.safeParse(requestValues);
    if (!parsed.success) {
      setRequestFieldErrors(buildFieldErrors(parsed.error.issues));
      return;
    }
    setRequestFieldErrors({});
    requestMutation.mutate(parsed.data);
  };

  const handleSignupSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = signupSchema.safeParse(signupValues);
    if (!parsed.success) {
      setSignupFieldErrors(buildFieldErrors(parsed.error.issues));
      return;
    }
    setSignupFieldErrors({});
    signupMutation.mutate(parsed.data);
  };

  if (submitted) {
    return (
      <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-4 py-8 sm:py-12">
        <div className="flex justify-end">
          <LanguageSwitcher />
        </div>
        <Card>
          <CardHeader>
            <CardTitle>{t("submittedTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>{mode === "open" ? t("submittedVerify") : t("submittedRequest")}</p>
            <Link href="/login" className="text-sm font-semibold text-primary hover:text-primary/80">
              {t("backToLogin")}
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
          {mode === "invite_only" ? (
            <form onSubmit={handleRequestSubmit}>
              <FormStack>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-foreground" htmlFor="signup-email">
                    {t("email")}
                  </label>
                  <Input
                    id="signup-email"
                    type="email"
                    placeholder={t("emailPlaceholder")}
                    value={requestValues.email}
                    onChange={(event) => {
                      const next = event.target.value;
                      setRequestValues((prev) => ({ ...prev, email: next }));
                      if (requestFieldErrors.email) {
                        setRequestFieldErrors((prev) => ({ ...prev, email: undefined }));
                      }
                    }}
                  />
                  {requestFieldErrors.email ? (
                    <p className="text-xs font-medium text-danger">{requestFieldErrors.email}</p>
                  ) : null}
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-foreground" htmlFor="signup-org-name">
                    {t("orgName")}
                  </label>
                  <Input
                    id="signup-org-name"
                    placeholder={t("orgPlaceholder")}
                    value={requestValues.orgName ?? ""}
                    onChange={(event) => {
                      const next = event.target.value;
                      setRequestValues((prev) => ({ ...prev, orgName: next }));
                      if (requestFieldErrors.orgName) {
                        setRequestFieldErrors((prev) => ({ ...prev, orgName: undefined }));
                      }
                    }}
                  />
                  {requestFieldErrors.orgName ? (
                    <p className="text-xs font-medium text-danger">{requestFieldErrors.orgName}</p>
                  ) : null}
                </div>
                  <Button type="submit" className="w-full" disabled={requestMutation.isLoading}>
                    {requestMutation.isLoading ? tCommon("loading") : t("requestAccess")}
                  </Button>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>{t("inviteOnlyNote")}</span>
                    <Link href="/invite" className="font-semibold text-primary hover:text-primary/80">
                      {t("haveInvite")}
                    </Link>
                  </div>
              </FormStack>
            </form>
          ) : (
            <form onSubmit={handleSignupSubmit}>
              <FormStack>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-foreground" htmlFor="signup-name">
                    {t("name")}
                  </label>
                  <Input
                    id="signup-name"
                    placeholder={t("namePlaceholder")}
                    value={signupValues.name}
                    onChange={(event) => {
                      const next = event.target.value;
                      setSignupValues((prev) => ({ ...prev, name: next }));
                      if (signupFieldErrors.name) {
                        setSignupFieldErrors((prev) => ({ ...prev, name: undefined }));
                      }
                    }}
                  />
                  {signupFieldErrors.name ? (
                    <p className="text-xs font-medium text-danger">{signupFieldErrors.name}</p>
                  ) : null}
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-foreground" htmlFor="signup-open-email">
                    {t("email")}
                  </label>
                  <Input
                    id="signup-open-email"
                    type="email"
                    placeholder={t("emailPlaceholder")}
                    value={signupValues.email}
                    onChange={(event) => {
                      const next = event.target.value;
                      setSignupValues((prev) => ({ ...prev, email: next }));
                      if (signupFieldErrors.email) {
                        setSignupFieldErrors((prev) => ({ ...prev, email: undefined }));
                      }
                    }}
                  />
                  {signupFieldErrors.email ? (
                    <p className="text-xs font-medium text-danger">{signupFieldErrors.email}</p>
                  ) : null}
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-foreground" htmlFor="signup-password">
                    {t("password")}
                  </label>
                  <Input
                    id="signup-password"
                    type="password"
                    placeholder={t("passwordPlaceholder")}
                    value={signupValues.password}
                    onChange={(event) => {
                      const next = event.target.value;
                      setSignupValues((prev) => ({ ...prev, password: next }));
                      if (signupFieldErrors.password) {
                        setSignupFieldErrors((prev) => ({ ...prev, password: undefined }));
                      }
                    }}
                  />
                  {signupFieldErrors.password ? (
                    <p className="text-xs font-medium text-danger">{signupFieldErrors.password}</p>
                  ) : null}
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-foreground">{t("preferredLocale")}</label>
                  <Select
                    value={signupValues.preferredLocale}
                    onValueChange={(value) => {
                      setSignupValues((prev) => ({ ...prev, preferredLocale: value as "ru" | "kg" }));
                      if (signupFieldErrors.preferredLocale) {
                        setSignupFieldErrors((prev) => ({ ...prev, preferredLocale: undefined }));
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
                  {signupFieldErrors.preferredLocale ? (
                    <p className="text-xs font-medium text-danger">{signupFieldErrors.preferredLocale}</p>
                  ) : null}
                </div>
                  <Button type="submit" className="w-full" disabled={signupMutation.isLoading}>
                    {signupMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
                    {signupMutation.isLoading ? tCommon("loading") : t("createAccount")}
                  </Button>
              </FormStack>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default SignupPage;
