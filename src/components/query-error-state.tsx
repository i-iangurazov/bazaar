"use client";

import React from "react";
import { useTranslations } from "next-intl";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const QueryErrorState = ({
  onRetry,
  className,
}: {
  onRetry: () => void;
  className?: string;
}) => {
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");

  return (
    <Alert variant="destructive" className={cn("space-y-3", className)} role="alert">
      <div>
        <AlertTitle>{tErrors("genericTitle")}</AlertTitle>
        <AlertDescription>{tErrors("genericMessage")}</AlertDescription>
      </div>
      <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
        {tCommon("tryAgain")}
      </Button>
    </Alert>
  );
};
