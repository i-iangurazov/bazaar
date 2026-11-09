"use client";

import React from "react";
import { useTranslations } from "next-intl";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { translateError } from "@/lib/translateError";
import { featureFromErrorDetails, featureLockError } from "@/lib/billing/featureLocks";
import { SubscriptionFeatureError } from "@/components/billing/subscription-feature-lock";

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

  if (error?.message && featureLockError(error.message)) {
    return <div className={className}><SubscriptionFeatureError message={error.message}
      feature={featureFromErrorDetails(error.data?.details)} /></div>;
  }

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
