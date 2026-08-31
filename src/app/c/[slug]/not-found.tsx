import { getTranslations } from "next-intl/server";
import Link from "next/link";

const CatalogNotFound = async () => {
  const t = await getTranslations("catalogPublic");
  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-xl flex-col items-center justify-center gap-4 px-4 text-center sm:px-6">
      <h1 className="text-xl font-semibold text-foreground">{t("notFoundTitle")}</h1>
      <p className="text-sm text-muted-foreground">{t("notFoundDescription")}</p>
      <Link
        href="/"
        className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {t("backHome")}
      </Link>
    </main>
  );
};

export default CatalogNotFound;
