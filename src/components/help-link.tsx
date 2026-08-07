"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { HelpIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const legacyArticleRoutes: Record<string, string> = {
  gettingStarted: "/help/getting-started",
  importProducts: "/help/products/import-products",
  barcodeWorkflow: "/help/products/add-product",
  inventoryFlows: "/help/inventory/receiving",
  stockCounts: "/help/inventory/inventory-count",
  purchaseOrders: "/help/inventory/receiving",
  storePrices: "/help/products/edit-product",
  mMarketIntegration: "/help/integrations/connect-marketplace",
  mMarketSpecsSetup: "/help/integrations/connect-marketplace",
  priceTags: "/help/products/add-product",
  reorder: "/help/inventory/receiving",
  troubleshooting: "/help",
};

export const HelpLink = ({ articleId }: { articleId: string }) => {
  const tCommon = useTranslations("common");
  const tHelp = useTranslations("help");
  const articleTitle = tHelp(`articles.${articleId}.title`);
  const ariaLabel = tCommon("openHelpArticle", { article: articleTitle });
  const href = legacyArticleRoutes[articleId] ?? "/help";

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button asChild type="button" variant="ghost" size="icon" aria-label={ariaLabel}>
            <Link href={href} target="_blank" rel="noopener noreferrer">
              <HelpIcon className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{articleTitle}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
