"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { FormActions, FormGrid } from "@/components/form-layout";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { useLocaleChange } from "@/hooks/use-locale-change";
import { loginPhoneExample, normalizeLoginPhone } from "@/lib/loginPhone";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";

function LoginPhoneForm({ userId, savedPhone }: { userId: string; savedPhone: string | null }) {
  const t = useTranslations("profile.loginPhone");
  const tCommon = useTranslations("common");
  const tAuth = useTranslations("auth");
  const tErrors = useTranslations("errors");
  const { toast } = useToast();
  const settings = trpc.useUtils().userSettings;
  const schema = z.object({
    phone: z.string().trim().refine((phone) => phone === "" || normalizeLoginPhone(phone) !== null, tErrors("loginPhoneInvalid")),
    password: z.string().min(1, tAuth("passwordRequired")).max(1024),
  });
  const form = useForm<z.input<typeof schema>, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { phone: savedPhone ?? "", password: "" },
  });
  useLocaleChange(() => {
    const fields = Object.keys(form.formState.errors) as (keyof z.infer<typeof schema>)[];
    if (fields.length) void form.trigger(fields);
  });
  const update = trpc.userSettings.updateMyLoginPhone.useMutation({
    onSuccess: (result) => {
      if (result.userId !== userId) return;
      settings.getMyLoginPhone.setData(undefined, (previous) => previous?.userId === userId ? result : previous);
      form.reset({ phone: result.phone ?? "", password: "" });
      toast({ variant: "success", description: t(result.phone ? "saved" : "removed") });
    },
  });
  const phone = form.watch("phone").trim();

  return (
    <Form {...form}>
      <form method="post" className="space-y-4" onSubmit={form.handleSubmit(({ phone, password }) => {
        update.mutate({ phone: phone || null, password });
      })}>
        <FormGrid>
          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("number")}</FormLabel>
                <FormControl>
                  <Input {...field} type="tel" autoComplete="tel" maxLength={40} placeholder={loginPhoneExample} disabled={update.isLoading} />
                </FormControl>
                {savedPhone ? <FormDescription>{t("removeHint")}</FormDescription> : null}
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("currentPassword")}</FormLabel>
                <FormControl>
                  <PasswordInput
                    {...field}
                    autoComplete="current-password"
                    maxLength={1024}
                    disabled={update.isLoading}
                    showLabel={tCommon("showPassword")}
                    hideLabel={tCommon("hidePassword")}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </FormGrid>
        {update.error ? <Alert variant="destructive" role="alert">{translateError(tErrors, update.error)}</Alert> : null}
        <FormActions>
          <Button type="submit" disabled={update.isLoading || phone === (savedPhone ?? "")}>
            {update.isLoading ? <Spinner className="h-4 w-4" /> : null}
            {t(savedPhone && !phone ? "remove" : "save")}
          </Button>
        </FormActions>
      </form>
    </Form>
  );
}

export function LoginPhoneSettings({ userId }: { userId: string }) {
  const t = useTranslations("profile.loginPhone");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const query = trpc.userSettings.getMyLoginPhone.useQuery(undefined, { refetchOnMount: "always" });
  const data = query.data?.userId === userId ? query.data : undefined;

  return (
    <Card className="bazaar-admin-surface" data-login-phone-settings>
      <CardHeader className="border-b border-border/60 bg-muted/20">
        <CardTitle>{t("title")}</CardTitle>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </CardHeader>
      <CardContent>
        {data ? (
          <LoginPhoneForm key={JSON.stringify([userId, data.phone])} userId={userId} savedPhone={data.phone} />
        ) : query.error ? (
          <div className="space-y-3">
            <Alert variant="destructive" role="alert">{translateError(tErrors, query.error)}</Alert>
            <Button variant="outline" type="button" onClick={() => void query.refetch()}>{tCommon("tryAgain")}</Button>
          </div>
        ) : (
          <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="h-4 w-4" /> {tCommon("loading")}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
