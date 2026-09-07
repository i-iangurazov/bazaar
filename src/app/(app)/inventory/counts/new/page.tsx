"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { Spinner } from "@/components/ui/spinner";
import { appLinks } from "@/lib/appRoutes";

const InventoryCountCreateRedirectPage = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations("common");
  const href = appLinks.newCount(searchParams.get("storeId") || undefined);

  // Resolve the compatibility alias after hydration; a streamed server redirect
  // can race the destination's query synchronization in the App Router.
  useEffect(() => {
    router.replace(href);
  }, [href, router]);

  return (
    <div className="flex min-h-48 items-center justify-center" role="status">
      <Spinner className="h-5 w-5" />
      <span className="sr-only">{t("loading")}</span>
    </div>
  );
};

export default InventoryCountCreateRedirectPage;
