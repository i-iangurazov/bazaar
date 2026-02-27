"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { HelpTourLauncher } from "@/components/guidance/help-tour-launcher";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronDownIcon } from "@/components/icons";

const articleIds = [
  "gettingStarted",
  "importProducts",
  "barcodeWorkflow",
  "inventoryFlows",
  "stockCounts",
  "purchaseOrders",
  "storePrices",
  "mMarketIntegration",
  "mMarketSpecsSetup",
  "priceTags",
  "reorder",
  "troubleshooting",
] as const;

type ArticleId = (typeof articleIds)[number];

const HelpPage = () => {
  const t = useTranslations("help");
  const [openId, setOpenId] = useState<ArticleId | null>(null);

  const articles = useMemo(
    () =>
      articleIds.map((id) => ({
        id,
        title: t(`articles.${id}.title`),
        summary: t(`articles.${id}.summary`),
        body: (t.raw(`articles.${id}.body`) as string[] | undefined) ?? [],
      })),
    [t],
  );

  useEffect(() => {
    const resolveHash = () => {
      const hash = window.location.hash.replace("#", "");
      if (!hash) {
        setOpenId((current) => current ?? articleIds[0]);
        return;
      }
      if (articleIds.includes(hash as ArticleId)) {
        setOpenId(hash as ArticleId);
      }
    };

    resolveHash();
    window.addEventListener("hashchange", resolveHash);
    return () => window.removeEventListener("hashchange", resolveHash);
  }, []);

  useEffect(() => {
    if (!openId) {
      return;
    }
    const hash = window.location.hash.replace("#", "");
    if (!hash || hash !== openId) {
      return;
    }
    const target = document.getElementById(openId);
    if (!target) {
      return;
    }
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [openId]);

  return (
    <div>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <HelpTourLauncher />

      <div className="mt-6 space-y-4">
        {articles.map((article) => {
          const isOpen = openId === article.id;
          return (
            <Card key={article.id} id={article.id}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle>{article.title}</CardTitle>
                    <p className="text-sm text-muted-foreground">{article.summary}</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t("toggleArticle", { title: article.title })}
                    onClick={() => setOpenId(isOpen ? null : article.id)}
                  >
                    <ChevronDownIcon
                      className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
                      aria-hidden
                    />
                  </Button>
                </div>
              </CardHeader>
              {isOpen ? (
                <CardContent className="space-y-3 text-sm text-muted-foreground">
                  {article.body.map((paragraph, index) => (
                    <p key={`${article.id}-${index}`}>{paragraph}</p>
                  ))}
                </CardContent>
              ) : null}
            </Card>
          );
        })}
      </div>
    </div>
  );
};

export default HelpPage;
