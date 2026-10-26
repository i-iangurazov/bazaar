"use client";

import React from "react";
import { useTranslations } from "next-intl";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { translateError } from "@/lib/translateError";

export const QueryErrorState = ({
  onRetry,
  className,
  error,
}: {
  onRetry: () => void;
  className?: string;
  error?: Parameters<typeof translateError>[1];
}) => {
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");

  return (
    <Alert variant="destructive" className={cn("space-y-3", className)} role="alert">
      <div>
        <AlertTitle>{tErrors("genericTitle")}</AlertTitle>
        <AlertDescription>
          {error ? translateError(tErrors, error) : tErrors("genericMessage")}
        </AlertDescription>
      </div>
      <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
        {tCommon("tryAgain")}
      </Button>
    </Alert>
  );
};
