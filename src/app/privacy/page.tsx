import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";

export const generateMetadata = async (): Promise<Metadata> => {
  const t = await getTranslations("privacy");
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: { canonical: "https://www.bazaar.kg/privacy" },
  };
};

const sections = ["data", "purpose", "permissions", "security", "sharing", "control"] as const;

const PrivacyPage = async () => {
  const t = await getTranslations("privacy");
  return (
    <main className="min-h-screen bg-background px-5 py-12 text-foreground sm:px-8 sm:py-16">
      <article className="mx-auto max-w-3xl">
        <Link
          href="/"
          className="inline-flex rounded-md text-sm font-semibold text-primary outline-none hover:text-primary/80 focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("back")}
        </Link>
        <p className="mt-10 text-sm font-semibold uppercase tracking-[0.2em] text-primary">
          {t("eyebrow")}
        </p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">{t("title")}</h1>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">{t("intro")}</p>
        <p className="mt-3 text-sm text-muted-foreground">{t("updated")}</p>

        <div className="mt-12 space-y-9">
          {sections.map((section) => (
            <section key={section}>
              <h2 className="text-xl font-semibold text-foreground">{t(`${section}Title`)}</h2>
              <p className="mt-2 leading-7 text-muted-foreground">{t(`${section}Body`)}</p>
            </section>
          ))}
        </div>

        <section className="mt-12 rounded-lg border border-border bg-card p-6">
          <h2 className="text-xl font-semibold">{t("supportTitle")}</h2>
          <p className="mt-2 leading-7 text-muted-foreground">{t("supportBody")}</p>
          <Button asChild className="mt-4 min-h-11 px-5"><Link href="/help">{t("supportAction")}</Link></Button>
        </section>
      </article>
    </main>
  );
};

export default PrivacyPage;
