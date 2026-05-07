import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  BarChart3,
  Boxes,
  Building2,
  Camera,
  CheckCircle2,
  ClipboardList,
  FileSpreadsheet,
  Globe2,
  KeyRound,
  Layers3,
  LockKeyhole,
  PackageCheck,
  PlugZap,
  ReceiptText,
  ScanBarcode,
  ShieldCheck,
  ShoppingCart,
  Store,
} from "lucide-react";

import { Reveal } from "@/components/landing/Reveal";
import { StickyNav } from "@/components/landing/StickyNav";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getServerAuthToken } from "@/server/auth/token";

export const generateMetadata = async (): Promise<Metadata> => {
  const tMeta = await getTranslations("landing.meta");
  const title = tMeta("title");
  const description = tMeta("description");

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
    },
    robots: {
      index: true,
      follow: true,
    },
  };
};

const RootPage = async () => {
  const token = await getServerAuthToken();
  if (token) {
    redirect("/dashboard");
  }

  const t = await getTranslations("landing");
  const navLinks = [
    { href: "#platform", label: t("nav.platform") },
    { href: "#workflows", label: t("nav.workflows") },
    { href: "#integrations", label: t("nav.integrations") },
    { href: "#security", label: t("nav.security") },
    { href: "#faq", label: t("nav.faq") },
  ];

  const capabilities = [
    {
      title: t("capabilities.catalog.title"),
      description: t("capabilities.catalog.description"),
      icon: Layers3,
    },
    {
      title: t("capabilities.pos.title"),
      description: t("capabilities.pos.description"),
      icon: ReceiptText,
    },
    {
      title: t("capabilities.inventory.title"),
      description: t("capabilities.inventory.description"),
      icon: Boxes,
    },
    {
      title: t("capabilities.purchasing.title"),
      description: t("capabilities.purchasing.description"),
      icon: ShoppingCart,
    },
    {
      title: t("capabilities.labels.title"),
      description: t("capabilities.labels.description"),
      icon: ScanBarcode,
    },
    {
      title: t("capabilities.reports.title"),
      description: t("capabilities.reports.description"),
      icon: BarChart3,
    },
    {
      title: t("capabilities.stores.title"),
      description: t("capabilities.stores.description"),
      icon: Store,
    },
    {
      title: t("capabilities.imports.title"),
      description: t("capabilities.imports.description"),
      icon: FileSpreadsheet,
    },
  ];

  const workflowSteps = [
    {
      title: t("workflows.assortment.title"),
      description: t("workflows.assortment.description"),
      icon: PackageCheck,
      items: [
        t("workflows.assortment.item1"),
        t("workflows.assortment.item2"),
        t("workflows.assortment.item3"),
      ],
    },
    {
      title: t("workflows.sell.title"),
      description: t("workflows.sell.description"),
      icon: ReceiptText,
      items: [t("workflows.sell.item1"), t("workflows.sell.item2"), t("workflows.sell.item3")],
    },
    {
      title: t("workflows.control.title"),
      description: t("workflows.control.description"),
      icon: ClipboardList,
      items: [
        t("workflows.control.item1"),
        t("workflows.control.item2"),
        t("workflows.control.item3"),
      ],
    },
  ];

  const integrations = [
    {
      title: t("integrations.bazaarCatalog.title"),
      description: t("integrations.bazaarCatalog.description"),
      icon: Globe2,
    },
    {
      title: t("integrations.bazaarApi.title"),
      description: t("integrations.bazaarApi.description"),
      icon: KeyRound,
    },
    {
      title: t("integrations.mMarket.title"),
      description: t("integrations.mMarket.description"),
      icon: Building2,
    },
    {
      title: t("integrations.bakaiStore.title"),
      description: t("integrations.bakaiStore.description"),
      icon: Store,
    },
    {
      title: t("integrations.imageStudio.title"),
      description: t("integrations.imageStudio.description"),
      icon: Camera,
    },
    {
      title: t("integrations.connectors.title"),
      description: t("integrations.connectors.description"),
      icon: PlugZap,
    },
  ];

  const faqItems = [
    { question: t("faq.q1.question"), answer: t("faq.q1.answer") },
    { question: t("faq.q2.question"), answer: t("faq.q2.answer") },
    { question: t("faq.q3.question"), answer: t("faq.q3.answer") },
    { question: t("faq.q4.question"), answer: t("faq.q4.answer") },
    { question: t("faq.q5.question"), answer: t("faq.q5.answer") },
  ];

  const securityItems = [
    t("security.item1"),
    t("security.item2"),
    t("security.item3"),
    t("security.item4"),
  ];

  return (
    <main className="relative min-h-screen overflow-x-clip bg-background">
      <StickyNav
        links={navLinks}
        navAriaLabel={t("nav.ariaLabel")}
        leftSlot={
          <Link href="/" className="inline-flex items-center gap-2 font-semibold text-foreground">
            <Image
              src="/brand/logo.png"
              alt="BAZAAR"
              width={152}
              height={40}
              priority
              className="h-8 w-auto"
            />
          </Link>
        }
        rightSlot={
          <>
            <LanguageSwitcher compact />
            <Button asChild variant="ghost" className="hidden sm:inline-flex">
              <Link href="/login">{t("actions.signIn")}</Link>
            </Button>
            <Button asChild className="hidden sm:inline-flex">
              <Link href="/signup">{t("actions.startNow")}</Link>
            </Button>
          </>
        }
      />

      <section className="relative border-b border-border bg-[linear-gradient(180deg,hsl(var(--background)),hsl(var(--secondary)/0.28))]">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.42]"
          style={{
            backgroundImage:
              "linear-gradient(hsl(var(--border) / 0.5) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--border) / 0.5) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
          }}
          aria-hidden
        />
        <div className="relative mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 sm:px-6 sm:py-20 lg:min-h-[640px] lg:grid-cols-[0.78fr_1.22fr] lg:items-center lg:gap-12 lg:px-8">
          <Reveal className="min-w-0 space-y-5 sm:space-y-6">
          <Badge variant="muted" className="w-fit">
            {t("hero.badge")}
          </Badge>
          <div className="space-y-4">
            <h1 className="max-w-full break-words text-balance text-[28px] font-semibold leading-[1.08] tracking-tight sm:max-w-xl sm:text-5xl lg:text-[64px]">
              {t("hero.title")}
            </h1>
            <p className="max-w-full text-[15px] leading-7 text-muted-foreground sm:max-w-lg sm:text-lg">
              {t("hero.subtitle")}
            </p>
          </div>
          <div className="flex max-w-full flex-col gap-3 sm:max-w-none sm:flex-row">
            <Button asChild className="landing-cta-shine w-full sm:w-auto">
              <Link href="/signup">
                {t("actions.startNow")}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </Button>
            <Button asChild variant="secondary" className="w-full sm:w-auto">
              <Link href="/login">{t("actions.signInWorkspace")}</Link>
            </Button>
          </div>
          <div className="grid max-w-full gap-2 text-sm text-muted-foreground sm:max-w-xl sm:grid-cols-2">
            <span className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden />
              {t("hero.proof1")}
            </span>
            <span className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden />
              {t("hero.proof2")}
            </span>
          </div>
          </Reveal>

          <Reveal delayMs={120} className="min-w-0 max-w-full lg:-mr-12">
          <div className="landing-console relative w-full max-w-full min-w-0 overflow-hidden border border-border bg-card shadow-[0_28px_80px_-60px_hsl(var(--foreground)/0.55)]">
            <div className="landing-console-scan" aria-hidden />
            <div className="border-b border-border bg-background/95 px-4 py-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold">{t("console.title")}</p>
                  <p className="text-xs text-muted-foreground">{t("console.subtitle")}</p>
                </div>
                <Badge variant="muted" className="w-fit">
                  {t("console.storeScoped")}
                </Badge>
              </div>
            </div>
            <div className="grid gap-3 p-4 sm:grid-cols-5">
              <div className="landing-console-card space-y-4 border border-border bg-background p-4 sm:col-span-3 sm:row-span-2">
                <p className="text-xs font-semibold uppercase text-muted-foreground">
                  {t("console.products")}
                </p>
                <div className="space-y-3">
                  {[1, 2, 3, 4].map((item) => (
                    <div
                      key={item}
                      className="grid grid-cols-[36px_minmax(0,1fr)_44px] items-center gap-3 sm:grid-cols-[36px_minmax(0,1fr)_72px]"
                    >
                      <span className="h-9 w-9 border border-border bg-secondary" aria-hidden />
                      <span className="space-y-2" aria-hidden>
                        <span className="block h-2 w-11/12 bg-muted" />
                        <span className="block h-2 w-7/12 bg-muted/70" />
                      </span>
                      <span
                        className={item === 2 ? "h-2 bg-primary/35" : "h-2 bg-muted"}
                        aria-hidden
                      />
                    </div>
                  ))}
                </div>
              </div>
              <div className="landing-console-card landing-console-card-delay space-y-3 border border-border bg-background p-4 sm:col-span-2">
                <p className="text-xs font-semibold uppercase text-muted-foreground">
                  {t("console.pos")}
                </p>
                <div className="space-y-2">
                  <div className="flex flex-col items-start gap-2 border border-border bg-secondary/40 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                    <span className="min-w-0 truncate text-sm">{t("console.shift")}</span>
                    <Badge variant="success" className="shrink-0">
                      {t("console.open")}
                    </Badge>
                  </div>
                  <div className="h-16 border border-border bg-primary/5 p-3">
                    <div className="h-2 w-3/4 bg-primary/30" />
                    <div className="mt-3 h-2 w-1/2 bg-muted" />
                  </div>
                </div>
              </div>
              <div className="landing-console-card landing-console-card-delay-2 space-y-3 border border-border bg-background p-4 sm:col-span-2">
                <p className="text-xs font-semibold uppercase text-muted-foreground">
                  {t("console.inventory")}
                </p>
                <div className="grid gap-2 sm:grid-cols-3">
                  {[t("console.stock"), t("console.low"), t("console.transfer")].map((label) => (
                    <div key={label} className="border border-border bg-secondary/40 p-2">
                      <span className="block h-1.5 w-8 bg-primary/25" aria-hidden />
                      <span className="mt-2 block text-xs text-muted-foreground">{label}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="landing-console-card landing-console-card-delay-3 space-y-3 border border-border bg-background p-4 sm:col-span-5">
                <p className="text-xs font-semibold uppercase text-muted-foreground">
                  {t("console.integrations")}
                </p>
                <div className="grid gap-2 sm:grid-cols-3">
                  {[t("console.catalog"), t("console.api"), t("console.market")].map((label) => (
                    <div
                      key={label}
                      className="flex items-center justify-between border border-border bg-secondary/30 px-3 py-2"
                    >
                      <span className="text-sm">{label}</span>
                      <span className="h-2 w-2 bg-primary" aria-hidden />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          </Reveal>
        </div>
      </section>

      <section id="platform" className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <Reveal className="mb-8 max-w-2xl space-y-3">
          <p className="text-sm font-semibold uppercase text-primary">{t("capabilities.eyebrow")}</p>
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {t("capabilities.title")}
          </h2>
          <p className="text-muted-foreground">{t("capabilities.subtitle")}</p>
        </Reveal>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {capabilities.map((capability, index) => (
            <Reveal
              key={capability.title}
              delayMs={45 * index}
              className={index < 2 ? "lg:col-span-2" : ""}
            >
              <Card className="landing-feature-card h-full transition-[transform,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-md">
                <CardContent className={index < 2 ? "space-y-5 sm:p-8" : "space-y-4"}>
                  <capability.icon
                    className={index < 2 ? "h-6 w-6 text-primary" : "h-5 w-5 text-primary"}
                    aria-hidden
                  />
                  <div className="space-y-2">
                    <h3 className={index < 2 ? "text-xl font-semibold" : "text-base font-semibold"}>
                      {capability.title}
                    </h3>
                    <p className="text-sm leading-6 text-muted-foreground">
                      {capability.description}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Reveal>
          ))}
        </div>
      </section>

      <section id="workflows" className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <Reveal className="mb-8 max-w-2xl space-y-3">
          <p className="text-sm font-semibold uppercase text-primary">{t("workflows.eyebrow")}</p>
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t("workflows.title")}</h2>
          <p className="text-muted-foreground">{t("workflows.subtitle")}</p>
        </Reveal>
        <div className="grid gap-4 lg:grid-cols-3">
          {workflowSteps.map((step, index) => (
            <Reveal key={step.title} delayMs={70 * index}>
              <Card className="h-full">
                <CardHeader className="space-y-3">
                  <step.icon className="h-5 w-5 text-primary" aria-hidden />
                  <div>
                    <CardTitle>{step.title}</CardTitle>
                    <p className="mt-2 text-sm text-muted-foreground">{step.description}</p>
                  </div>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    {step.items.map((item) => (
                      <li key={item} className="flex items-start gap-2">
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 bg-primary" aria-hidden />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </Reveal>
          ))}
        </div>
      </section>

      <section id="integrations" className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <Reveal className="mb-8 max-w-2xl space-y-3">
          <p className="text-sm font-semibold uppercase text-primary">{t("integrations.eyebrow")}</p>
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {t("integrations.title")}
          </h2>
          <p className="text-muted-foreground">{t("integrations.subtitle")}</p>
        </Reveal>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {integrations.map((integration, index) => (
            <Reveal key={integration.title} delayMs={45 * index}>
              <Card className="h-full">
                <CardContent className="flex gap-4">
                  <integration.icon className="mt-1 h-5 w-5 shrink-0 text-primary" aria-hidden />
                  <div className="space-y-2">
                    <h3 className="font-semibold">{integration.title}</h3>
                    <p className="text-sm leading-6 text-muted-foreground">
                      {integration.description}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Reveal>
          ))}
        </div>
      </section>

      <section id="security" className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <Reveal>
          <Card className="overflow-hidden">
            <div className="grid lg:grid-cols-[0.85fr_1.15fr]">
              <CardHeader className="border-b border-border lg:border-b-0 lg:border-r">
                <LockKeyhole className="h-5 w-5 text-primary" aria-hidden />
                <CardTitle className="mt-4 text-2xl tracking-tight">{t("security.title")}</CardTitle>
                <p className="text-sm leading-6 text-muted-foreground">{t("security.subtitle")}</p>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 sm:grid-cols-2">
                  {securityItems.map((item) => (
                    <div key={item} className="flex items-start gap-3 border border-border bg-secondary/30 p-3">
                      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                      <p className="text-sm text-muted-foreground">{item}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </div>
          </Card>
        </Reveal>
      </section>

      <section id="faq" className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <Reveal className="mb-6 space-y-3">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t("faq.title")}</h2>
          <p className="text-muted-foreground">{t("faq.subtitle")}</p>
        </Reveal>
        <div className="space-y-3">
          {faqItems.map((item, index) => (
            <Reveal key={item.question} delayMs={45 * index}>
              <details className="group border border-border bg-card p-4 open:border-primary/40">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 pr-1 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
                  <span>{item.question}</span>
                  <ArrowRight
                    className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300 group-open:rotate-90"
                    aria-hidden
                  />
                </summary>
                <div className="grid grid-rows-[0fr] opacity-60 transition-[grid-template-rows,opacity] duration-300 ease-out group-open:grid-rows-[1fr] group-open:opacity-100">
                  <p className="overflow-hidden pt-3 text-sm text-muted-foreground">{item.answer}</p>
                </div>
              </details>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 pb-10 pt-6 sm:px-6 sm:pb-14 lg:px-8">
        <Reveal>
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="flex flex-col gap-4 py-8 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-2">
                <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">{t("finalCta.title")}</h2>
                <p className="text-sm text-muted-foreground">{t("finalCta.subtitle")}</p>
              </div>
              <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
                <Button asChild className="w-full sm:w-auto">
                  <Link href="/signup">{t("actions.startNow")}</Link>
                </Button>
                <Button asChild variant="secondary" className="w-full sm:w-auto">
                  <Link href="/login">{t("actions.signIn")}</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </Reveal>
      </section>

      <footer className="border-t border-border/80 bg-background">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-6 text-sm text-muted-foreground sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
          <p>{t("footer.copyright", { year: new Date().getFullYear() })}</p>
          <nav className="flex flex-wrap items-center gap-4">
            {navLinks.map((link) => (
              <a key={`footer-${link.href}`} href={link.href} className="hover:text-foreground">
                {link.label}
              </a>
            ))}
            <Link href="/login" className="hover:text-foreground">
              {t("footer.signIn")}
            </Link>
          </nav>
        </div>
      </footer>
    </main>
  );
};

export default RootPage;
