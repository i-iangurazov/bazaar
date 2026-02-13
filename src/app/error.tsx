"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

const ErrorPage = ({ error, reset }: { error: Error; reset: () => void }) => {
  const t = useTranslations("errors");

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-muted/30 px-6 text-center">
      <h2 className="text-2xl font-semibold">{t("genericTitle")}</h2>
      <p className="max-w-md text-sm text-muted-foreground">{t("genericMessage")}</p>
      <Button onClick={reset}>{t("tryAgain")}</Button>
    </div>
  );
};

export default ErrorPage;
