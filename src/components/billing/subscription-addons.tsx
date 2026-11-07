import Link from "next/link";

import { StoresIcon, UsersIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ADDITIONAL_STORE_CAPS, EXTRA_MONTHLY_PRICES_MINOR } from "@/lib/billing/subscriptionPricing";
import { formatNumber } from "@/lib/i18nFormat";
import { cn } from "@/lib/utils";

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** The same published add-ons on the landing and in the subscription workspace. */
export function SubscriptionAddons({
  t,
  locale,
  className,
  manageHref,
}: {
  t: Translate;
  locale: string;
  className?: string;
  manageHref?: string;
}) {
  const price = (minor: number) => t("planPricePrimary", {
    amount: formatNumber(minor / 100, locale, { maximumFractionDigits: 2 }),
  });
  return (
    <section id="subscription-addons" aria-labelledby="subscription-addons-title"
      className={cn("space-y-5", className)} data-subscription-addons>
      <div className="space-y-2">
        <h3 id="subscription-addons-title" className="text-xl font-semibold text-foreground">
          {t("publicPricing.extras")}
        </h3>
        <p className="text-sm leading-relaxed text-muted-foreground">{t("publicPricing.extrasIntro")}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card data-addon="stores">
          <CardHeader>
            <CardTitle className="flex items-center gap-3 text-base">
              <StoresIcon className="h-5 w-5 shrink-0 text-primary" aria-hidden />
              {t("publicPricing.storeExtraTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xl font-semibold text-foreground">{price(EXTRA_MONTHLY_PRICES_MINOR.stores)}</p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t("publicPricing.storeExtraDescription", {
                businessMax: 1 + ADDITIONAL_STORE_CAPS.BUSINESS,
                enterpriseMax: 1 + ADDITIONAL_STORE_CAPS.ENTERPRISE,
              })}
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">{t("publicPricing.storeCountingNote")}</p>
          </CardContent>
        </Card>
        <Card data-addon="reserve">
          <CardHeader>
            <CardTitle className="flex items-center gap-3 text-base">
              <UsersIcon className="h-5 w-5 shrink-0 text-primary" aria-hidden />
              {t("publicPricing.reserveExtraTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xl font-semibold text-foreground">{price(EXTRA_MONTHLY_PRICES_MINOR.productPacks)}</p>
            <p className="text-sm leading-relaxed text-muted-foreground">{t("publicPricing.reserveExtraDescription")}</p>
            <p className="text-xs leading-relaxed text-muted-foreground">{t("publicPricing.reserveExtraNote")}</p>
          </CardContent>
        </Card>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{t("publicPricing.quotaNote")}</p>
      {manageHref ? <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">{t("publicPricing.extrasManageHint")}</p>
        <Button asChild variant="secondary"><Link href={manageHref}>{t("publicPricing.extrasManage")}</Link></Button>
      </div> : null}
    </section>
  );
}
