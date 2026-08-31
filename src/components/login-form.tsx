"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { getSession, signIn } from "next-auth/react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";

import { normalizeLocale } from "@/lib/locales";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { FormStack } from "@/components/form-layout";

export const LoginForm = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{
    email?: string;
    password?: string;
  }>({});
  const t = useTranslations("auth");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const searchParams = useSearchParams();
  const submitInFlightRef = useRef(false);

  const normalizeNext = (next: string | null) => {
    if (!next || !next.startsWith("/")) {
      return null;
    }
    const segment = next.split("/")[1];
    const normalized = normalizeLocale(segment);
    if (normalized) {
      const rest = next.split("/").slice(2).join("/");
      return rest ? `/${rest}` : "/";
    }
    return next;
  };

  const schema = z.object({
    email: z.string().min(1, t("emailRequired")).email(t("emailInvalid")),
    password: z.string().min(1, t("passwordRequired")),
  });

  useEffect(() => setIsHydrated(true), []);

  const handleSubmit = async (values: z.infer<typeof schema>) => {
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    setIsLoading(true);
    setError(null);
    let keepLockedForNavigation = false;

    try {
      const result = await signIn("credentials", {
        email: values.email,
        password: values.password,
        redirect: false,
      });

      if (result?.error) {
        if (result.error === "loginRateLimited") {
          setError("loginRateLimited");
        } else if (result.error === "loginLocked") {
          setError("loginLocked");
        } else if (result.error === "loginBackoff") {
          setError("loginBackoff");
        } else if (result.error === "emailNotVerified") {
          setError("emailNotVerified");
        } else if (result.error === "registrationNotCompleted") {
          setError("registrationNotCompleted");
        } else {
          setError("invalidCredentials");
        }
        return;
      }

      const next = searchParams.get("next");
      const normalizedNext = normalizeNext(next);
      if (normalizedNext) {
        keepLockedForNavigation = true;
        router.replace(normalizedNext);
        return;
      }

      const session = await getSession();
      const destination = session?.user?.isPlatformOwner ? "/platform" : "/dashboard";
      keepLockedForNavigation = true;
      router.replace(destination);
    } finally {
      if (!keepLockedForNavigation) {
        submitInFlightRef.current = false;
        setIsLoading(false);
      }
    }
  };

  const handleFormSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const visibleValues = new FormData(event.currentTarget);
    const parsed = schema.safeParse({
      email: String(visibleValues.get("email") ?? ""),
      password: String(visibleValues.get("password") ?? ""),
    });

    if (!parsed.success) {
      const errors = parsed.error.flatten().fieldErrors;
      setFieldErrors({
        email: errors.email?.[0],
        password: errors.password?.[0],
      });
      return;
    }

    setFieldErrors({});
    await handleSubmit(parsed.data);
  };

  return (
    <form
      data-login-form
      data-hydrated={isHydrated ? "true" : "false"}
      onSubmit={handleFormSubmit}
      noValidate
      aria-live="polite"
    >
      <FormStack>
        <div className="space-y-1">
          <Label className={fieldErrors.email ? "text-danger" : undefined} htmlFor="login-email">
            {t("email")}
          </Label>
          <Input
            id="login-email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder={t("emailPlaceholder")}
            aria-invalid={Boolean(fieldErrors.email)}
            aria-describedby={fieldErrors.email ? "login-email-error" : undefined}
          />
          {fieldErrors.email ? (
            <p
              id="login-email-error"
              role="alert"
              aria-live="assertive"
              className="text-xs font-medium text-danger"
            >
              {fieldErrors.email}
            </p>
          ) : null}
        </div>
        <div className="space-y-1">
          <Label
            className={fieldErrors.password ? "text-danger" : undefined}
            htmlFor="login-password"
          >
            {t("password")}
          </Label>
          <PasswordInput
            id="login-password"
            name="password"
            autoComplete="current-password"
            placeholder={t("passwordPlaceholder")}
            showLabel={tCommon("showPassword")}
            hideLabel={tCommon("hidePassword")}
            aria-invalid={Boolean(fieldErrors.password)}
            aria-describedby={fieldErrors.password ? "login-password-error" : undefined}
          />
          {fieldErrors.password ? (
            <p
              id="login-password-error"
              role="alert"
              aria-live="assertive"
              className="text-xs font-medium text-danger"
            >
              {fieldErrors.password}
            </p>
          ) : null}
        </div>
        {error ? (
          <p className="text-sm text-danger" role="alert">
            {t(error)}
          </p>
        ) : null}
        <div className="text-right">
          <Link href="/reset" className="text-xs font-semibold text-primary hover:text-primary/90">
            {t("forgotPassword")}
          </Link>
        </div>
        <Button className="w-full" type="submit" disabled={isLoading}>
          {isLoading ? t("signingIn") : t("signIn")}
        </Button>
      </FormStack>
    </form>
  );
};
