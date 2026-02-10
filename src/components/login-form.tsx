"use client";

import { useState } from "react";
import { getSession, signIn } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { normalizeLocale } from "@/lib/locales";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  const router = useRouter();
  const searchParams = useSearchParams();

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

    const result = await signIn("credentials", {
      email: values.email,
      password: values.password,
      redirect: false,
    });

    setIsLoading(false);

    if (result?.error) {
      if (result.error === "loginRateLimited") {
        setError("loginRateLimited");
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
      <form onSubmit={form.handleSubmit(handleSubmit)}>
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
                  <Input
                    {...field}
                    type="password"
                    autoComplete="current-password"
                    placeholder={t("passwordPlaceholder")}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {error ? <p className="text-sm text-red-500">{t(error)}</p> : null}
          <div className="text-right">
            <a href="/reset" className="text-xs font-semibold text-ink underline">
              {t("forgotPassword")}
            </a>
          </div>
          <Button className="w-full" type="submit" disabled={isLoading}>
            {isLoading ? t("signingIn") : t("signIn")}
          </Button>
        </FormStack>
      </form>
    </Form>
  );
};
