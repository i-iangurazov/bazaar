"use client";

import { useState } from "react";
import { getSession, signIn } from "next-auth/react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { normalizeLocale } from "@/lib/locales";
import { resolveSafeReturnTo } from "@/lib/safeReturnTo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { FormStack } from "@/components/form-layout";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import { useHydrated } from "@/hooks/use-hydrated";

export const LoginForm = () => {
  const hydrated = useHydrated();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verificationSent, setVerificationSent] = useState(false);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const t = useTranslations("auth");
  const tCommon = useTranslations("common");
  const tNav = useTranslations("nav");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const searchParams = useSearchParams();
  const resendVerification = trpc.publicAuth.resendVerification.useMutation({
    onSuccess: () => setVerificationSent(true),
    onError: (error) => setVerificationError(translateError(tErrors, error)),
  });

  const normalizeNext = (next: string | null) => {
    const safeNext = resolveSafeReturnTo(next, "");
    if (!safeNext) {
      return null;
    }
    const segment = safeNext.split("/")[1];
    const normalized = normalizeLocale(segment);
    if (normalized) {
      const rest = safeNext.split("/").slice(2).join("/");
      return resolveSafeReturnTo(rest ? `/${rest}` : "/", "") || null;
    }
    return safeNext;
  };

  const schema = z.object({
    email: z
      .string()
      .min(1, t("emailRequired"))
      .email(t("emailInvalid")),
    password: z.string().min(1, t("passwordRequired")),
  });

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      email: "",
      password: "",
    },
    mode: "onSubmit",
  });

  const handleSubmit = async (values: z.infer<typeof schema>) => {
    setIsLoading(true);
    setError(null);
    setVerificationSent(false);
    setVerificationError(null);

    const result = await signIn("credentials", {
      email: values.email,
      password: values.password,
      redirect: false,
    });

    setIsLoading(false);

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
      router.replace(normalizedNext);
      return;
    }

    const session = await getSession();
    const destination = session?.user?.isPlatformOwner ? "/platform" : "/dashboard";
    router.replace(destination);
  };

  return (
    <Form {...form}>
      <form method="post" onSubmit={form.handleSubmit(handleSubmit)}>
        <FormStack>
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("email")}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    disabled={!hydrated}
                    type="email"
                    autoComplete="email"
                    placeholder={t("emailPlaceholder")}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("password")}</FormLabel>
                <FormControl>
                  <PasswordInput
                    {...field}
                    disabled={!hydrated}
                    autoComplete="current-password"
                    placeholder={t("passwordPlaceholder")}
                    showLabel={tCommon("showPassword")}
                    hideLabel={tCommon("hidePassword")}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {error ? <p className="text-sm text-danger">{t(error)}</p> : null}
          {error === "emailNotVerified" ? (
            <div className="space-y-2" aria-live="polite">
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                disabled={resendVerification.isLoading || verificationSent}
                onClick={async () => {
                  if (!(await form.trigger("email"))) return;
                  setVerificationError(null);
                  resendVerification.mutate({ email: form.getValues("email") });
                }}
              >
                {resendVerification.isLoading
                  ? tNav("emailVerificationSending")
                  : verificationSent
                    ? tNav("emailVerificationSent")
                    : tNav("emailVerificationResend")}
              </Button>
              {verificationError ? <p className="text-sm text-danger">{verificationError}</p> : null}
            </div>
          ) : null}
          <div className="text-right">
            <Link href="/reset" className="text-xs font-semibold text-primary hover:text-primary/80">
              {t("forgotPassword")}
            </Link>
          </div>
          <Button className="w-full" type="submit" disabled={!hydrated || isLoading}>
            {isLoading ? t("signingIn") : t("signIn")}
          </Button>
        </FormStack>
      </form>
    </Form>
  );
};
