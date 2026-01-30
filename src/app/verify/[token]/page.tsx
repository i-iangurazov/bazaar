"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { LanguageSwitcher } from "@/components/language-switcher";
import { trpc } from "@/lib/trpc";

const VerifyPage = () => {
  const params = useParams();
  const token = String(params?.token ?? "");
  const t = useTranslations("verify");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const [done, setDone] = useState(false);

  const verifyMutation = trpc.publicAuth.verifyEmail.useMutation({
    onSuccess: () => setDone(true),
    onError: () => setDone(true),
  });

  useEffect(() => {
    if (token) {
      verifyMutation.mutate({ token });
    }
  }, [token, verifyMutation]);

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-4 py-8 sm:py-12">
      <div className="flex justify-end">
        <LanguageSwitcher />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-gray-600">
          {verifyMutation.isLoading ? (
            <div className="flex items-center gap-2">
              <Spinner className="h-4 w-4" />
              {tCommon("loading")}
            </div>
          ) : done && verifyMutation.isError ? (
            <p>{tErrors("tokenInvalid")}</p>
          ) : (
            <p>{t("success")}</p>
          )}
          <a href="/login" className="text-sm font-semibold text-ink underline">
            {t("goToLogin")}
          </a>
        </CardContent>
      </Card>
    </div>
  );
};

export default VerifyPage;
