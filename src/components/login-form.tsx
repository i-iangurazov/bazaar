"use client";

import { useEffect, useRef, useState } from "react";
import { getSession, signIn } from "next-auth/react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { normalizeLocale } from "@/lib/locales";
import { loginPhoneExample, normalizeLoginPhone } from "@/lib/loginPhone";
import { resolveSafeReturnTo } from "@/lib/safeReturnTo";
import { getRoleHomePath } from "@/lib/roleAccess";
import { MailIcon, PhoneIcon } from "@/components/icons";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Spinner } from "@/components/ui/spinner";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { FormStack } from "@/components/form-layout";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import { useHydrated } from "@/hooks/use-hydrated";
import { useLocaleChange } from "@/hooks/use-locale-change";

type LoginMethod = "email" | "phone";
const loginMethods = [
  { method: "email", message: "loginByEmail", Icon: MailIcon },
  { method: "phone", message: "loginByPhone", Icon: PhoneIcon },
] as const;
const credentialInputClass = "h-12 rounded-lg border-input/70 bg-muted/40 px-3.5 text-base sm:text-base";

export const LoginForm = () => {
  const hydrated = useHydrated();
  const [method, setMethod] = useState<LoginMethod>("email");
  const focusSelectedIdentifier = useRef(false);
  const identifierRef = useRef<HTMLInputElement | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verificationSent, setVerificationSent] = useState(false);
  const [verificationError, setVerificationError] = useState<Parameters<typeof translateError>[1]>(null);
  const t = useTranslations("auth");
  const tCommon = useTranslations("common");
  const tNav = useTranslations("nav");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const searchParams = useSearchParams();
  const resendVerification = trpc.publicAuth.resendVerification.useMutation({
    onSuccess: () => setVerificationSent(true),
    onError: (error) => setVerificationError(error),
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
    email: method === "email"
      ? z.string().trim().min(1, t("emailRequired")).email(t("emailInvalid"))
      : z.string(),
    phone: method === "phone"
      ? z.string().trim().min(1, t("phoneRequired")).refine((value) => !value || normalizeLoginPhone(value) !== null, t("phoneInvalid"))
      : z.string(),
    password: z.string().min(1, t("passwordRequired")),
  });

  const form = useForm<z.input<typeof schema>, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      email: "",
      phone: "",
      password: "",
    },
    mode: "onSubmit",
  });
  useEffect(() => {
    if (!focusSelectedIdentifier.current) return;
    focusSelectedIdentifier.current = false;
    identifierRef.current?.focus();
  }, [method]);
  useLocaleChange(() => {
    const fields = Object.keys(form.formState.errors) as (keyof z.infer<typeof schema>)[];
    if (fields.length) void form.trigger(fields);
  });

  const changeMethod = (next: LoginMethod) => {
    if (next === method) return;
    form.clearErrors(["email", "phone"]);
    setError(null);
    setVerificationSent(false);
    setVerificationError(null);
    focusSelectedIdentifier.current = true;
    setMethod(next);
  };

  const handleSubmit = async (values: z.infer<typeof schema>) => {
    setIsLoading(true);
    setError(null);
    setVerificationSent(false);
    setVerificationError(null);

    try {
      const result = await signIn("credentials", {
        ...(method === "email" ? { email: values.email } : { phone: values.phone }),
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
      if (!result?.ok) {
        setError("loginUnavailable");
        return;
      }

      const next = searchParams.get("next");
      const normalizedNext = normalizeNext(next);
      if (normalizedNext) {
        router.replace(normalizedNext);
        return;
      }

      const session = await getSession();
      if (!session?.user) {
        setError("loginUnavailable");
        return;
      }
      const destination = session.user.isPlatformOwner ? "/platform" : getRoleHomePath(session.user);
      router.replace(destination);
    } catch {
      setError("loginUnavailable");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Form {...form}>
      <form method="post" noValidate aria-busy={isLoading} onSubmit={form.handleSubmit(handleSubmit)}>
        <FormStack className="gap-3.5 sm:gap-4">
          <div role="group" aria-label={t("loginMethod")} className="grid grid-cols-2 gap-1 rounded-xl border border-primary/10 bg-primary/5 p-1">
            {loginMethods.map(({ method: option, message, Icon }) => (
              <Button
                key={option}
                type="button"
                variant="ghost"
                className="h-auto min-h-11 min-w-0 whitespace-normal rounded-lg px-2 py-1.5 text-sm leading-tight text-foreground/75 aria-pressed:border-primary/15 aria-pressed:bg-card aria-pressed:font-semibold aria-pressed:text-primary aria-pressed:shadow-sm"
                aria-pressed={method === option}
                disabled={!hydrated || isLoading || resendVerification.isLoading}
                onClick={() => changeMethod(option)}
              >
                <Icon className="size-4" aria-hidden />
                {t(message)}
              </Button>
            ))}
          </div>
          <FormField
            key={method}
            control={form.control}
            name={method}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t(method === "email" ? "email" : "loginPhone")}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    ref={(node) => {
                      field.ref(node);
                      identifierRef.current = node;
                    }}
                    className={credentialInputClass}
                    disabled={!hydrated}
                    type={method === "email" ? "email" : "tel"}
                    autoComplete={method === "email" ? "email" : "username"}
                    autoCapitalize="none"
                    spellCheck={false}
                    maxLength={method === "phone" ? 40 : undefined}
                    placeholder={method === "email" ? t("emailPlaceholder") : loginPhoneExample}
                  />
                </FormControl>
                {method === "phone" ? <FormDescription className="text-foreground/65">{t("phoneSetupHint")}</FormDescription> : null}
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 space-y-0">
                <FormLabel className="col-start-1 row-start-1">{t("password")}</FormLabel>
                <FormControl>
                  <PasswordInput
                    {...field}
                    className={`${credentialInputClass} pr-12`}
                    wrapperClassName="col-span-2 [&>button]:size-10"
                    disabled={!hydrated}
                    autoComplete="current-password"
                    placeholder={t("passwordPlaceholder")}
                    showLabel={tCommon("showPassword")}
                    hideLabel={tCommon("hidePassword")}
                  />
                </FormControl>
                <Link href="/reset" className="col-start-2 row-start-1 inline-flex min-h-8 max-w-[11rem] items-center rounded-sm py-1 text-right text-xs font-semibold leading-tight text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                  {t("forgotPassword")}
                </Link>
                <FormMessage className="col-span-2" />
              </FormItem>
            )}
          />
          {error ? (
            <Alert variant="destructive" role="alert">
              {t(error === "emailNotVerified" && method === "phone" ? "confirmEmailAfterPhoneLogin" : error)}
            </Alert>
          ) : null}
          {error === "emailNotVerified" && method === "email" ? (
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
              {verificationError ? <p className="text-sm text-danger">{translateError(tErrors, verificationError)}</p> : null}
            </div>
          ) : null}
          <Button className="min-h-12 w-full rounded-lg text-base font-semibold" type="submit" disabled={!hydrated || isLoading}>
            {isLoading ? <Spinner className="size-4" /> : null}
            {isLoading ? t("signingIn") : t("signIn")}
          </Button>
        </FormStack>
      </form>
    </Form>
  );
};
