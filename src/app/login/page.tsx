import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { AuthBrand } from "@/components/auth-brand";
import { LanguageSwitcher } from "@/components/language-switcher";
import { LoginForm } from "@/components/login-form";

const accountLink = "inline-flex min-h-11 items-center justify-center rounded-md px-2 text-center text-sm font-semibold leading-snug text-primary hover:bg-primary/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export const generateMetadata = async (): Promise<Metadata> => {
  const t = await getTranslations("auth");
  return {
    title: { absolute: t("loginTitle") },
    robots: { index: false, follow: true },
  };
};

const LoginPage = async () => {
  const [t, tMeta] = await Promise.all([getTranslations("auth"), getTranslations("meta")]);
  const mode = process.env.SIGNUP_MODE ?? "invite_only";
  const isOpenMode = mode === "open";

  return (
    <main className="min-h-svh bg-muted/60 pb-[calc(1.25rem+var(--mobile-bottom-safe-area))] pt-[calc(0.75rem+var(--mobile-top-safe-area))] sm:py-8">
      <div className="mx-auto flex min-h-[calc(100svh-2rem)] max-w-[72rem] flex-col px-4 sm:min-h-[calc(100svh-4rem)] sm:px-8">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <AuthBrand className="min-h-11 rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&_img]:h-7 sm:[&_img]:h-9" />
          <LanguageSwitcher compact className="shrink-0 bg-card shadow-none" buttonClassName="h-8 min-w-8 px-1.5 sm:h-9 sm:min-w-9" />
        </header>

        <div className="flex flex-1 justify-center pt-5 sm:items-center sm:py-12 lg:grid lg:grid-cols-[1.15fr_1fr] lg:gap-10">
          <div aria-hidden className="relative hidden min-h-[34rem] overflow-hidden rounded-[1.75rem] bg-[#103776] lg:block">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,#2b63d9_0%,transparent_67%)]" />
            <div className="absolute -bottom-[50%] -left-1/4 size-[33rem] rounded-full border border-white/20" />
            <div className="absolute -bottom-[35%] -left-1/4 size-[33rem] rounded-full border border-white/20" />
            <Image src="/brand/icon.png" alt="" width={195} height={183} className="absolute left-10 top-10 size-16 rounded-2xl bg-white object-contain shadow-lg" />
            <div className="absolute left-11 right-[-16%] top-[28%] -rotate-6 overflow-hidden rounded-xl border border-white/25 bg-white shadow-[0_28px_70px_-28px_#000]">
              <Image src="/marketing/captures/products-wide.webp" alt="" width={1920} height={1080} sizes="(min-width: 1024px) 660px, 1px" className="h-auto w-full" />
            </div>
          </div>

          <section aria-labelledby="bazaar-login-title" className="w-full max-w-[28rem] self-start rounded-2xl border border-border bg-card px-5 pb-5 pt-6 shadow-sm sm:self-auto sm:p-8 lg:justify-self-center">
            <div className="mb-5 space-y-1.5 sm:mb-6">
              <h1 id="bazaar-login-title" className="text-balance text-[1.75rem] font-semibold leading-tight tracking-[-0.035em] text-foreground sm:text-[2rem]">
                {t("loginTitle")}
              </h1>
              <p className="text-sm leading-5 text-foreground/70 sm:leading-6">{tMeta("description")}</p>
            </div>

            <LoginForm />

            <div className={`mt-4 grid gap-1 border-t border-border pt-2 ${isOpenMode ? "grid-cols-1" : "grid-cols-2"}`}>
              <Link href="/signup" className={accountLink}>{t(isOpenMode ? "createAccount" : "requestAccess")}</Link>
              {isOpenMode ? null : <Link href="/invite" className={accountLink}>{t("acceptInvite")}</Link>}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
};

export default LoginPage;
