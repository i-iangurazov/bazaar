"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

const SignupPage = () => {
  const t = useTranslations("signup");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const { toast } = useToast();

  const [step, setStep] = useState<1 | 2>(1);
  const [submitted, setSubmitted] = useState(false);

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
        orgName: z.string().min(2, t("orgRequired")),
        storeName: z.string().min(2, t("storeRequired")),
        phone: z.string().optional(),
      }),
    [t],
  );

  const requestForm = useForm<z.infer<typeof requestSchema>>({
    resolver: zodResolver(requestSchema),
    defaultValues: { email: "", orgName: "" },
  });

  const signupForm = useForm<z.infer<typeof signupSchema>>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      email: "",
      password: "",
      name: "",
      preferredLocale: "ru",
      orgName: "",
      storeName: "",
      phone: "",
    },
  });

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
          <CardContent className="space-y-2 text-sm text-gray-600">
            <p>{mode === "open" ? t("submittedVerify") : t("submittedRequest")}</p>
            <a href="/login" className="text-sm font-semibold text-ink underline">
              {t("backToLogin")}
            </a>
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
            <Form {...requestForm}>
              <form
                onSubmit={requestForm.handleSubmit((values) => {
                  requestMutation.mutate(values);
                })}
              >
                <FormStack>
                  <FormField
                    control={requestForm.control}
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
                  <FormField
                    control={requestForm.control}
                    name="orgName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("orgName")}</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder={t("orgPlaceholder")} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" className="w-full" disabled={requestMutation.isLoading}>
                    {requestMutation.isLoading ? tCommon("loading") : t("requestAccess")}
                  </Button>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
                    <span>{t("inviteOnlyNote")}</span>
                    <a href="/invite" className="font-semibold text-ink underline">
                      {t("haveInvite")}
                    </a>
                  </div>
                </FormStack>
              </form>
            </Form>
          ) : (
            <Form {...signupForm}>
              <form
                onSubmit={signupForm.handleSubmit((values) => {
                  signupMutation.mutate(values);
                })}
              >
                <FormStack>
                  <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-gray-400">
                    <span className={step === 1 ? "text-ink" : ""}>{t("stepAccount")}</span>
                    <span>→</span>
                    <span className={step === 2 ? "text-ink" : ""}>{t("stepOrg")}</span>
                  </div>

                  {step === 1 ? (
                    <>
                      <FormField
                        control={signupForm.control}
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
                        control={signupForm.control}
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
                      <FormField
                        control={signupForm.control}
                        name="password"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("password")}</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                type="password"
                                placeholder={t("passwordPlaceholder")}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={signupForm.control}
                        name="preferredLocale"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("preferredLocale")}</FormLabel>
                            <FormControl>
                              <Select value={field.value} onValueChange={field.onChange}>
                                <SelectTrigger>
                                  <SelectValue placeholder={t("selectLocale")} />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="ru">{tCommon("locales.ru")}</SelectItem>
                                  <SelectItem value="kg">{tCommon("locales.kg")}</SelectItem>
                                </SelectContent>
                              </Select>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        className="w-full"
                        onClick={() => setStep(2)}
                      >
                        {t("continue")}
                      </Button>
                    </>
                  ) : (
                    <>
                      <FormField
                        control={signupForm.control}
                        name="orgName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("orgName")}</FormLabel>
                            <FormControl>
                              <Input {...field} placeholder={t("orgPlaceholder")} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={signupForm.control}
                        name="storeName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("storeName")}</FormLabel>
                            <FormControl>
                              <Input {...field} placeholder={t("storePlaceholder")} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={signupForm.control}
                        name="phone"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("phone")}</FormLabel>
                            <FormControl>
                              <Input {...field} placeholder={t("phonePlaceholder")} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          className="w-full"
                          onClick={() => setStep(1)}
                        >
                          {tCommon("back")}
                        </Button>
                        <Button type="submit" className="w-full" disabled={signupMutation.isLoading}>
                          {signupMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
                          {signupMutation.isLoading ? tCommon("loading") : t("createAccount")}
                        </Button>
                      </div>
                    </>
                  )}
                </FormStack>
              </form>
            </Form>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default SignupPage;
