"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { AuthBrand } from "@/components/auth-brand";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { LanguageSwitcher } from "@/components/language-switcher";
import { trpc } from "@/lib/trpc";
import { QueryErrorState } from "@/components/query-error-state";
import { Alert } from "@/components/ui/alert";

const VerifyPage = () => {
  const params = useParams();
  const router = useRouter();
  const token = String(params?.token ?? "");
  const t = useTranslations("verify");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const [status, setStatus] = useState<"loading" | "success" | "invalid" | "error">("loading");
  const [nextPath, setNextPath] = useState("/login");
  const requestedTokenRef = useRef<string | null>(null);

  const verifyMutation = trpc.publicAuth.verifyEmail.useMutation({
    onSuccess: (result) => {
      setNextPath(result.nextPath ?? "/login");
      setStatus("success");
    },
    onError: (error) => {
      const code = error.data?.code;
      setStatus(code === "NOT_FOUND" || code === "BAD_REQUEST" || code === "CONFLICT" ? "invalid" : "error");
    },
  });

  useEffect(() => {
    if (!token || requestedTokenRef.current === token) {
      return;
    }
    requestedTokenRef.current = token;
    setStatus("loading");
    setNextPath("/login");
    verifyMutation.mutate({ token });
  }, [token, verifyMutation]);

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
          <CardTitle>{t("title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          {status === "loading" ? (
            <div className="flex items-center gap-2">
              <Spinner className="h-4 w-4" />
              {tCommon("loading")}
            </div>
          ) : status === "error" ? (
            <QueryErrorState onRetry={() => {
              setStatus("loading");
              verifyMutation.mutate({ token });
            }} />
          ) : status === "invalid" ? (
            <Alert variant="destructive" role="alert">{tErrors("tokenInvalid")}</Alert>
          ) : (
            <p>{t("success")}</p>
          )}
          {status !== "loading" ? (
            <Button
              type="button"
              variant="secondary"
              className="w-full sm:w-auto"
              onClick={() => router.push(nextPath)}
            >
              {nextPath.startsWith("/register-business") ? t("goToRegisterBusiness") : t("goToLogin")}
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
};

export default VerifyPage;
