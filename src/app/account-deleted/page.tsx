import Link from "next/link";
import { getTranslations } from "next-intl/server";

export const metadata = { robots: { index: false, follow: false } };

export default async function AccountDeletedPage() {
  const t = await getTranslations("accountPrivacy");
  return <main className="flex min-h-screen items-center justify-center px-5 py-12">
    <div className="max-w-lg space-y-5 rounded-xl border border-border bg-card p-6">
      <h1 className="text-2xl font-semibold">{t("deletedTitle")}</h1>
      <p className="text-sm leading-6">{t("deletedBody")}</p>
      <p className="text-sm leading-6">{t("appleWarning")}</p>
      <a className="inline-flex min-h-11 items-center text-primary underline" href="https://apps.apple.com/account/subscriptions">{t("manageApple")}</a>
      <div><Link className="inline-flex min-h-11 items-center text-primary underline" href="/login">{t("backToLogin")}</Link></div>
    </div>
  </main>;
}
