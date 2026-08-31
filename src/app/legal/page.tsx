import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

export const generateMetadata = async (): Promise<Metadata> => {
  const t = await getTranslations("legal");
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: { canonical: "https://www.bazaar.kg/legal" },
    robots: { index: true, follow: true },
  };
};

const LegalPage = async () => {
  const t = await getTranslations("legal");

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

        <div className="mt-12 grid gap-5 sm:grid-cols-2">
          <section className="rounded-2xl border border-slate-700 bg-slate-900 p-6">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-sky-300">
              {t("publishedEyebrow")}
            </p>
            <h2 className="mt-3 text-xl font-semibold text-white">{t("privacyTitle")}</h2>
            <p className="mt-2 leading-7 text-slate-300">{t("privacyBody")}</p>
            <Link
              href="/privacy"
              className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-sky-700 px-5 font-semibold text-white outline-none hover:bg-sky-800 focus-visible:ring-2 focus-visible:ring-sky-300"
            >
              {t("privacyAction")}
            </Link>
          </section>

          <section className="rounded-2xl border border-slate-700 bg-slate-900 p-6">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-sky-300">
              {t("contactEyebrow")}
            </p>
            <h2 className="mt-3 text-xl font-semibold text-white">{t("contactTitle")}</h2>
            <p className="mt-2 leading-7 text-slate-300">{t("contactBody")}</p>
            <a
              href="mailto:support@bazaar.kg"
              className="mt-5 inline-flex min-h-11 items-center rounded-xl border border-sky-400/40 px-5 font-semibold text-sky-200 outline-none hover:border-sky-300 hover:text-white focus-visible:ring-2 focus-visible:ring-sky-300"
            >
              {t("contactAction")}
            </a>
          </section>
        </div>

        <div className="mt-10 flex flex-wrap gap-x-6 gap-y-3 border-t border-slate-800 pt-8 text-sm font-semibold">
          <Link
            href="/help"
            className="rounded-md text-sky-300 outline-none hover:text-sky-200 focus-visible:ring-2 focus-visible:ring-sky-400"
          >
            {t("guideAction")}
          </Link>
          <Link
            href="/developers/bazaar-api"
            className="rounded-md text-sky-300 outline-none hover:text-sky-200 focus-visible:ring-2 focus-visible:ring-sky-400"
          >
            {t("apiAction")}
          </Link>
        </div>
      </article>
    </main>
  );
};

export default LegalPage;
