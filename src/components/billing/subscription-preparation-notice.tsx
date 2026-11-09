"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { PlanFeature } from "@/lib/billing/plans";

const preparationPages: Readonly<Record<string, { feature: PlanFeature; href: string }>> = {
  expiryLots: { feature: "expiryLots", href: "/stores" },
  bundles: { feature: "bundles", href: "/products" },
  loyalty: { feature: "loyalty", href: "/settings/loyalty" },
  loyaltyReservations: { feature: "loyalty", href: "/settings/loyalty" },
  marketingAutomation: { feature: "marketingAutomation", href: "/operations/integrations/email-marketing" },
  marketingQueue: { feature: "emailMarketing", href: "/operations/integrations/email-marketing" },
  ownSender: { feature: "ownSender", href: "/operations/integrations/email-marketing" },
  mMarket: { feature: "marketplaces", href: "/operations/integrations/m-market" },
  mMarketQueue: { feature: "marketplaces", href: "/operations/integrations/m-market" },
  bakaiStore: { feature: "marketplaces", href: "/operations/integrations/bakai-store" },
  bakaiStoreApiQueue: { feature: "marketplaces", href: "/operations/integrations/bakai-store" },
  oMarket: { feature: "marketplaces", href: "/operations/integrations/o-market" },
  oMarketQueue: { feature: "marketplaces", href: "/operations/integrations/o-market" },
};

/** Describe only known server preparation requirements; never display raw identifiers. */
export function SubscriptionPreparationNotice({ modules, trial = false }: { modules: unknown; trial?: boolean }) {
  const t = useTranslations("billing");
  const rows = Array.isArray(modules)
    ? [...new Set(modules.filter((value): value is string => typeof value === "string" && Object.hasOwn(preparationPages, value)))]
    : [];
  return (
    <Alert variant="warning" data-subscription-preparation>
      <AlertTitle>{t("featureLock.preparationTitle")}</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>{t(trial ? "trialPreparation.description" : "featureLock.preparationDescription")}</p>
        {rows.length ? <ul className="space-y-2">
          {rows.map(key => <li key={key} className="space-y-1">
            {trial ? <p>{t(`features.${preparationPages[key]!.feature}`)}</p> : <><p>{t(`featureLock.preparation.${key}`)}</p>
            <Link className="inline-flex min-h-10 items-center font-medium text-primary underline-offset-4 hover:underline"
              href={preparationPages[key]!.href}>{t(`features.${preparationPages[key]!.feature}`)} →</Link>
            </>}
          </li>)}
        </ul> : null}
      </AlertDescription>
    </Alert>
  );
}
