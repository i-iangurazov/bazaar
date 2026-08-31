"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { z } from "zod";

import { AuthBrand } from "@/components/auth-brand";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { LanguageSwitcher } from "@/components/language-switcher";
import { FormStack } from "@/components/form-layout";
import { useToast } from "@/components/ui/toast";
import { locales, type Locale } from "@/lib/locales";
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
  preferredLocale: Locale;
};

const SignupPage = () => {
  const t = useTranslations("signup");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const { toast } = useToast();
  const router = useRouter();
  const requestInFlightRef = useRef(false);
  const signupInFlightRef = useRef(false);

  const [submitted, setSubmitted] = useState(false);
  const [redirectingToBusiness, setRedirectingToBusiness] = useState(false);
  const [requestValues, setRequestValues] = useState<RequestValues>({ email: "", orgName: "" });
  const [signupValues, setSignupValues] = useState<SignupValues>({
    email: "",
    password: "",
    name: "",
    preferredLocale: "ru",
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [emailDeliveryFailed, setEmailDeliveryFailed] = useState(false);
  const [requestFieldErrors, setRequestFieldErrors] = useState<
    Partial<Record<keyof RequestValues, string>>
  >({});
  const [signupFieldErrors, setSignupFieldErrors] = useState<
    Partial<Record<keyof SignupValues, string>>
  >({});

  const modeQuery = trpc.publicAuth.signupMode.useQuery();
  const mode = modeQuery.data?.mode;

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
        preferredLocale: z.enum(locales),
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
      setFormError(null);
      setSubmitted(true);
      toast({ variant: "success", description: t("requestSuccess") });
    },
    onError: (error) => {
      const message = translateError(tErrors, error);
      setFormError(message);
      toast({ variant: "error", description: message });
    },
    onSettled: () => {
      requestInFlightRef.current = false;
    },
  });

  const signupMutation = trpc.publicAuth.signup.useMutation({
    onSuccess: async (result, variables) => {
      setFormError(null);
      if (result.nextPath) {
        setRedirectingToBusiness(true);
        try {
          await fetch("/api/locale", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ locale: variables.preferredLocale }),
          });
        } finally {
          router.replace(result.nextPath);
        }
        return;
      }
      await fetch("/api/locale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: variables.preferredLocale }),
      });
      const deliveryFailed = result.verificationEmailSent === false;
      setEmailDeliveryFailed(deliveryFailed);
      toast({
        variant: deliveryFailed ? "error" : "success",
        description: deliveryFailed ? t("verificationEmailFailed") : t("signupSuccess"),
      });
      if (deliveryFailed) {
        setSubmitted(true);
        return;
      }
      if (result.verifyLink) {
        setSubmitted(true);
        toast({ variant: "info", description: t("verifyHint") });
        return;
      }
      router.replace("/login");
    },
    onError: (error) => {
      setRedirectingToBusiness(false);
      const message = translateError(tErrors, error);
      setFormError(message);
      toast({ variant: "error", description: message });
    },
    onSettled: () => {
      signupInFlightRef.current = false;
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
    setFormError(null);
    if (requestInFlightRef.current) return;
    requestInFlightRef.current = true;
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
    setFormError(null);
    setEmailDeliveryFailed(false);
    if (signupInFlightRef.current) return;
    signupInFlightRef.current = true;
    signupMutation.mutate(parsed.data);
  };

  if (modeQuery.isLoading || redirectingToBusiness) {
    return (
      <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-4 py-8 sm:py-12">
        <div className="flex justify-center">
          <AuthBrand />
        </div>
        <div className="flex justify-end">
          <LanguageSwitcher />
        </div>
        <Card>
          <CardHeader>
            <CardTitle as="h1">{t("title")}</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="h-4 w-4" />
            {tCommon("loading")}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-4 py-8 sm:py-12">
        <div className="flex justify-center">
          <AuthBrand />
        </div>
        <div className="flex justify-end">
          <LanguageSwitcher />
        </div>
        <Card>
          <CardHeader>
            <CardTitle as="h1">{t("submittedTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              {mode === "open"
                ? emailDeliveryFailed
                  ? t("submittedVerifyEmailFailed")
                  : t("submittedVerify")
                : t("submittedRequest")}
            </p>
            <Link
              href="/login"
              className="text-sm font-semibold text-primary hover:text-primary/90"
            >
              {t("backToLogin")}
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-4 py-8 sm:py-12">
      <div className="flex justify-center">
        <AuthBrand />
      </div>
      <div className="flex justify-end">
        <LanguageSwitcher />
      </div>
      <Card>
        <CardHeader>
          <CardTitle as="h1">{t("title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {formError ? (
            <p className="text-sm font-medium text-danger" role="alert">
              {formError}
            </p>
          ) : null}
          {mode === "invite_only" ? (
            <form onSubmit={handleRequestSubmit} noValidate aria-live="polite">
              <FormStack>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-foreground" htmlFor="signup-email">
                    {t("email")}
                  </label>
                  <Input
                    id="signup-email"
                    type="email"
                    autoComplete="email"
                    aria-invalid={Boolean(requestFieldErrors.email)}
                    aria-describedby={requestFieldErrors.email ? "signup-email-error" : undefined}
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
                    <p id="signup-email-error" className="text-xs font-medium text-danger">
                      {requestFieldErrors.email}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-foreground" htmlFor="signup-org-name">
                    {t("orgName")}
                  </label>
                  <Input
                    id="signup-org-name"
                    autoComplete="organization"
                    aria-invalid={Boolean(requestFieldErrors.orgName)}
                    aria-describedby={
                      requestFieldErrors.orgName ? "signup-org-name-error" : undefined
                    }
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
                    <p id="signup-org-name-error" className="text-xs font-medium text-danger">
                      {requestFieldErrors.orgName}
                    </p>
                  ) : null}
                </div>
                <Button type="submit" className="w-full" disabled={requestMutation.isLoading}>
                  {requestMutation.isLoading ? tCommon("loading") : t("requestAccess")}
                </Button>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>{t("inviteOnlyNote")}</span>
                  <Link href="/invite" className="font-semibold text-primary hover:text-primary/90">
                    {t("haveInvite")}
                  </Link>
                </div>
              </FormStack>
            </form>
          ) : (
            <form onSubmit={handleSignupSubmit} noValidate aria-live="polite">
              <FormStack>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-foreground" htmlFor="signup-name">
                    {t("name")}
                  </label>
                  <Input
                    id="signup-name"
                    autoComplete="name"
                    aria-invalid={Boolean(signupFieldErrors.name)}
                    aria-describedby={signupFieldErrors.name ? "signup-name-error" : undefined}
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
                    <p id="signup-name-error" className="text-xs font-medium text-danger">
                      {signupFieldErrors.name}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-1">
                  <label
                    className="text-sm font-medium text-foreground"
                    htmlFor="signup-open-email"
                  >
                    {t("email")}
                  </label>
                  <Input
                    id="signup-open-email"
                    type="email"
                    autoComplete="email"
                    aria-invalid={Boolean(signupFieldErrors.email)}
                    aria-describedby={
                      signupFieldErrors.email ? "signup-open-email-error" : undefined
                    }
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
                    <p id="signup-open-email-error" className="text-xs font-medium text-danger">
                      {signupFieldErrors.email}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-foreground" htmlFor="signup-password">
                    {t("password")}
                  </label>
                  <PasswordInput
                    id="signup-password"
                    autoComplete="new-password"
                    aria-invalid={Boolean(signupFieldErrors.password)}
                    aria-describedby={
                      signupFieldErrors.password ? "signup-password-error" : undefined
                    }
                    placeholder={t("passwordPlaceholder")}
                    value={signupValues.password}
                    showLabel={tCommon("showPassword")}
                    hideLabel={tCommon("hidePassword")}
                    onChange={(event) => {
                      const next = event.target.value;
                      setSignupValues((prev) => ({ ...prev, password: next }));
                      if (signupFieldErrors.password) {
                        setSignupFieldErrors((prev) => ({ ...prev, password: undefined }));
                      }
                    }}
                  />
                  {signupFieldErrors.password ? (
                    <p id="signup-password-error" className="text-xs font-medium text-danger">
                      {signupFieldErrors.password}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-1">
                  <label
                    className="text-sm font-medium text-foreground"
                    htmlFor="signup-preferred-locale"
                  >
                    {t("preferredLocale")}
                  </label>
                  <Select
                    value={signupValues.preferredLocale}
                    onValueChange={(value) => {
                      setSignupValues((prev) => ({ ...prev, preferredLocale: value as Locale }));
                      if (signupFieldErrors.preferredLocale) {
                        setSignupFieldErrors((prev) => ({ ...prev, preferredLocale: undefined }));
                      }
                    }}
                  >
                    <SelectTrigger
                      id="signup-preferred-locale"
                      aria-invalid={Boolean(signupFieldErrors.preferredLocale)}
                      aria-describedby={
                        signupFieldErrors.preferredLocale
                          ? "signup-preferred-locale-error"
                          : undefined
                      }
                    >
                      <SelectValue placeholder={t("selectLocale")} />
                    </SelectTrigger>
                    <SelectContent>
                      {locales.map((availableLocale) => (
                        <SelectItem key={availableLocale} value={availableLocale}>
                          {tCommon(`locales.${availableLocale}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {signupFieldErrors.preferredLocale ? (
                    <p
                      id="signup-preferred-locale-error"
                      className="text-xs font-medium text-danger"
                    >
                      {signupFieldErrors.preferredLocale}
                    </p>
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
