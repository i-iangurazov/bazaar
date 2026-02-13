"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { LanguageSwitcher } from "@/components/language-switcher";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { FormStack } from "@/components/form-layout";
import { useToast } from "@/components/ui/toast";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";

const ResetTokenPage = () => {
  const params = useParams();
  const token = String(params?.token ?? "");
  const t = useTranslations("reset");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const { toast } = useToast();
  const [done, setDone] = useState(false);

  const schema = useMemo(
    () =>
      z.object({
        password: z.string().min(8, t("passwordMin")),
      }),
    [t],
  );

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { password: "" },
  });

  const resetMutation = trpc.publicAuth.resetPassword.useMutation({
    onSuccess: () => {
      setDone(true);
      toast({ variant: "success", description: t("resetSuccess") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-4 py-8 sm:py-12">
      <div className="flex justify-end">
        <LanguageSwitcher />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t("resetTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {done ? (
            <>
              <p className="text-sm text-muted-foreground">{t("resetSuccess")}</p>
              <Link href="/login" className="text-sm font-semibold text-primary hover:text-primary/80">
                {t("backToLogin")}
              </Link>
            </>
          ) : (
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit((values) => resetMutation.mutate({ token, ...values }))}
              >
                <FormStack>
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("newPassword")}</FormLabel>
                        <FormControl>
                          <Input {...field} type="password" placeholder={t("passwordPlaceholder")} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" className="w-full" disabled={resetMutation.isLoading}>
                    {resetMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
                    {resetMutation.isLoading ? tCommon("loading") : t("save")}
                  </Button>
                </FormStack>
              </form>
            </Form>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ResetTokenPage;
