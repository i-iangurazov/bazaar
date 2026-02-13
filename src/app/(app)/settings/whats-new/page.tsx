"use client";

import { useMemo } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const sectionIds = ["v14", "v15", "v16"] as const;

const WhatsNewPage = () => {
  const t = useTranslations("whatsNew");
  const tErrors = useTranslations("errors");
  const { data: session, status } = useSession();
  const isAdmin = session?.user?.role === "ADMIN";
  const isForbidden = status === "authenticated" && !isAdmin;

  const sections = useMemo(
    () =>
      sectionIds.map((id) => ({
        id,
        title: t(`sections.${id}.title`),
        items: (t.raw(`sections.${id}.items`) as string[] | undefined) ?? [],
      })),
    [t],
  );

  if (isForbidden) {
    return (
      <div>
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <p className="mt-4 text-sm text-danger">{tErrors("forbidden")}</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div className="mt-6 grid gap-4">
        {sections.map((section) => (
          <Card key={section.id}>
            <CardHeader>
              <CardTitle>{section.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              {section.items.map((item, index) => (
                <div key={`${section.id}-${index}`} className="flex gap-2">
                  <span className="text-foreground" aria-hidden>
                    •
                  </span>
                  <span>{item}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default WhatsNewPage;
