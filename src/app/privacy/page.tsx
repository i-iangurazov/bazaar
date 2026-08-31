import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

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
    <main className="min-h-screen bg-slate-950 px-5 py-12 text-slate-100 sm:px-8 sm:py-16">
      <article className="mx-auto max-w-3xl">
        <Link
          href="/"
          className="inline-flex rounded-lg text-sm font-semibold text-sky-300 outline-none hover:text-sky-200 focus-visible:ring-2 focus-visible:ring-sky-400"
        >
          {t("back")}
        </Link>
        <p className="mt-10 text-sm font-semibold uppercase tracking-[0.2em] text-sky-300">
          {t("eyebrow")}
        </p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">{t("title")}</h1>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-300">{t("intro")}</p>
        <p className="mt-3 text-sm text-slate-400">{t("updated")}</p>

        <div className="mt-12 space-y-9">
          {sections.map((section) => (
            <section key={section}>
              <h2 className="text-xl font-semibold text-white">{t(`${section}Title`)}</h2>
              <p className="mt-2 leading-7 text-slate-300">{t(`${section}Body`)}</p>
            </section>
          ))}
        </div>

        <section className="mt-12 rounded-2xl border border-sky-400/20 bg-sky-400/5 p-6">
          <h2 className="text-xl font-semibold">{t("supportTitle")}</h2>
          <p className="mt-2 leading-7 text-slate-300">{t("supportBody")}</p>
          <Link
            href="/help"
            className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-sky-700 px-5 font-semibold text-white outline-none hover:bg-sky-800 focus-visible:ring-2 focus-visible:ring-sky-300"
          >
            {t("supportAction")}
          </Link>
        </section>
      </article>
    </main>
  );
};

export default PrivacyPage;
