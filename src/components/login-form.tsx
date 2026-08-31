"use client";

import { useRef, useState } from "react";
import { getSession, signIn } from "next-auth/react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { normalizeLocale } from "@/lib/locales";
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

export const LoginForm = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      email: "",
      password: "",
    },
    mode: "onSubmit",
  });

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

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} noValidate aria-live="polite">
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
          {error ? (
            <p className="text-sm text-danger" role="alert">
              {t(error)}
            </p>
          ) : null}
          <div className="text-right">
            <Link
              href="/reset"
              className="text-xs font-semibold text-primary hover:text-primary/90"
            >
              {t("forgotPassword")}
            </Link>
          </div>
          <Button className="w-full" type="submit" disabled={isLoading}>
            {isLoading ? t("signingIn") : t("signIn")}
          </Button>
        </FormStack>
      </form>
    </Form>
  );
};
