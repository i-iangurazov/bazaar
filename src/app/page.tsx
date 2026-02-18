import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  BarChart3,
  ChevronDown,
  ClipboardList,
  FileText,
  Layers3,
  LockKeyhole,
  ShieldCheck,
  ShoppingCart,
  Store,
  Users,
} from "lucide-react";

import { CountUp } from "@/components/landing/CountUp";
import { PreviewTabs } from "@/components/landing/PreviewTabs";
import { Reveal } from "@/components/landing/Reveal";
import { StickyNav } from "@/components/landing/StickyNav";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getServerAuthToken } from "@/server/auth/token";

export const generateMetadata = async (): Promise<Metadata> => {
  const t = await getTranslations("landing.meta");
  const title = t("title");
  const description = t("description");

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
    { href: "#features", label: t("nav.features") },
    { href: "#modules", label: t("nav.modules") },
    { href: "#security", label: t("nav.security") },
    { href: "#faq", label: t("nav.faq") },
  ];

  const features = [
    {
      title: t("features.inventory.title"),
      description: t("features.inventory.description"),
      icon: Layers3,
    },
    {
      title: t("features.workflows.title"),
      description: t("features.workflows.description"),
      icon: ShoppingCart,
    },
    {
      title: t("features.rbac.title"),
      description: t("features.rbac.description"),
      icon: Users,
    },
    {
      title: t("features.stores.title"),
      description: t("features.stores.description"),
      icon: Store,
    },
    {
      title: t("features.exports.title"),
      description: t("features.exports.description"),
      icon: FileText,
    },
    {
      title: t("features.visibility.title"),
      description: t("features.visibility.description"),
      icon: BarChart3,
    },
  ];

  const howSteps = [
    {
      step: "1",
      title: t("how.step1.title"),
      description: t("how.step1.description"),
    },
    {
      step: "2",
      title: t("how.step2.title"),
      description: t("how.step2.description"),
    },
    {
      step: "3",
      title: t("how.step3.title"),
      description: t("how.step3.description"),
    },
  ];

  const moduleCards = [
    {
      title: t("modules.operations.title"),
      description: t("modules.operations.description"),
      points: [
        t("modules.operations.point1"),
        t("modules.operations.point2"),
        t("modules.operations.point3"),
      ],
    },
    {
      title: t("modules.sales.title"),
      description: t("modules.sales.description"),
      points: [t("modules.sales.point1"), t("modules.sales.point2"), t("modules.sales.point3")],
    },
    {
      title: t("modules.platform.title"),
      description: t("modules.platform.description"),
      points: [
        t("modules.platform.point1"),
        t("modules.platform.point2"),
        t("modules.platform.point3"),
      ],
    },
  ];

  const previewTabs = [
    {
      id: "operations",
      label: t("previewTabs.operations.label"),
      title: t("previewTabs.operations.title"),
      description: t("previewTabs.operations.description"),
      points: [
        t("previewTabs.operations.point1"),
        t("previewTabs.operations.point2"),
        t("previewTabs.operations.point3"),
      ],
    },
    {
      id: "sales",
      label: t("previewTabs.sales.label"),
      title: t("previewTabs.sales.title"),
      description: t("previewTabs.sales.description"),
      points: [t("previewTabs.sales.point1"), t("previewTabs.sales.point2"), t("previewTabs.sales.point3")],
    },
    {
      id: "visibility",
      label: t("previewTabs.visibility.label"),
      title: t("previewTabs.visibility.title"),
      description: t("previewTabs.visibility.description"),
      points: [
        t("previewTabs.visibility.point1"),
        t("previewTabs.visibility.point2"),
        t("previewTabs.visibility.point3"),
      ],
    },
  ];

  const stats = [
    { value: features.length, label: t("stats.features") },
    { value: howSteps.length, label: t("stats.workflows") },
    { value: 2, label: t("stats.languages") },
    { value: moduleCards.length, label: t("stats.valueBlocks") },
  ];

  const faqItems = [
    { question: t("faq.q1.question"), answer: t("faq.q1.answer") },
    { question: t("faq.q2.question"), answer: t("faq.q2.answer") },
    { question: t("faq.q3.question"), answer: t("faq.q3.answer") },
    { question: t("faq.q4.question"), answer: t("faq.q4.answer") },
    { question: t("faq.q5.question"), answer: t("faq.q5.answer") },
    { question: t("faq.q6.question"), answer: t("faq.q6.answer") },
  ];

  const securityAuthItems = [
    t("security.authItem1"),
    t("security.authItem2"),
    t("security.authItem3"),
    t("security.authItem4"),
  ];
  const securityOpsItems = [t("security.opsItem1"), t("security.opsItem2"), t("security.opsItem3")];

  return (
    <main className="relative min-h-screen overflow-x-clip bg-gradient-to-b from-background via-background to-secondary/30">
      <StickyNav
        links={navLinks}
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
            <LanguageSwitcher />
            <Button asChild variant="ghost" className="hidden sm:inline-flex">
              <Link href="/login">{t("actions.signIn")}</Link>
            </Button>
            <Button asChild>
              <Link href="/signup">{t("actions.bookDemo")}</Link>
            </Button>
          </>
        }
      />

      <section className="relative mx-auto grid w-full max-w-6xl gap-10 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-2 lg:items-center lg:gap-12 lg:px-8">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-8 -z-10 h-full overflow-hidden">
          <div className="landing-orb absolute -left-14 top-12 h-52 w-52 rounded-full bg-primary/15 blur-3xl" />
          <div className="landing-orb landing-orb-delay absolute right-0 top-4 h-44 w-44 rounded-full bg-primary/10 blur-3xl" />
        </div>

        <Reveal className="space-y-6">
          <Badge variant="muted" className="w-fit">
            {t("hero.badge")}
          </Badge>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl lg:text-5xl">
            <span className="landing-hero-title bg-gradient-to-r from-foreground via-primary to-foreground bg-[length:200%_100%] bg-clip-text text-transparent">
              {t("hero.title")}
            </span>
          </h1>
          <p className="max-w-xl text-base text-muted-foreground sm:text-lg">{t("hero.subtitle")}</p>
          <div className="flex flex-col gap-3 sm:flex-row">
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
          <p className="text-sm text-muted-foreground">{t("hero.trust")}</p>
        </Reveal>

        <Reveal delayMs={120}>
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle className="text-base">{t("preview.title")}</CardTitle>
            </CardHeader>
            <CardContent>
              <PreviewTabs tabs={previewTabs} />
            </CardContent>
          </Card>
        </Reveal>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 pb-4 sm:px-6 lg:px-8" aria-label={t("stats.ariaLabel")}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat, index) => (
            <Reveal key={stat.label} delayMs={80 * index}>
              <Card className="h-full">
                <CardContent className="space-y-1 py-5">
                  <CountUp value={stat.value} className="text-2xl font-semibold tracking-tight text-foreground" />
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                </CardContent>
              </Card>
            </Reveal>
          ))}
        </div>
      </section>

      <section id="features" className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
        <Reveal className="mb-8 max-w-2xl space-y-3">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t("features.title")}</h2>
          <p className="text-muted-foreground">{t("features.subtitle")}</p>
        </Reveal>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature, index) => (
            <Reveal key={feature.title} delayMs={70 * index}>
              <Card className="group h-full transition-transform duration-300 hover:-translate-y-1 hover:shadow-md">
                <CardContent className="space-y-3">
                  <feature.icon
                    className="h-5 w-5 text-primary transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:scale-110"
                    aria-hidden
                  />
                  <h3 className="text-base font-semibold">{feature.title}</h3>
                  <p className="text-sm text-muted-foreground">{feature.description}</p>
                </CardContent>
              </Card>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <Reveal>
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl tracking-tight">{t("how.title")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-3">
              {howSteps.map((item, index) => (
                <Reveal key={item.step} delayMs={70 * index} className="rounded-lg border border-border bg-secondary/30 p-4">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                    {item.step}
                  </span>
                  <h3 className="mt-3 text-base font-semibold">{item.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{item.description}</p>
                </Reveal>
              ))}
            </CardContent>
          </Card>
        </Reveal>
      </section>

      <section id="modules" className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <Reveal className="mb-8 space-y-3">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t("modules.title")}</h2>
          <p className="max-w-2xl text-muted-foreground">{t("modules.subtitle")}</p>
        </Reveal>
        <div className="grid gap-4 lg:grid-cols-3">
          {moduleCards.map((moduleCard, index) => (
            <Reveal key={moduleCard.title} delayMs={80 * index}>
              <Card className="h-full">
                <CardHeader>
                  <CardTitle>{moduleCard.title}</CardTitle>
                  <p className="text-sm text-muted-foreground">{moduleCard.description}</p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    {moduleCard.points.map((point) => (
                      <li key={point} className="flex items-start gap-2">
                        <ShieldCheck className="mt-0.5 h-4 w-4 text-primary" aria-hidden />
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </Reveal>
          ))}
        </div>
      </section>

      <section id="security" className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <Reveal>
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl tracking-tight">{t("security.title")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div className="space-y-3 rounded-lg border border-border p-4">
                <div className="flex items-center gap-2">
                  <LockKeyhole className="h-4 w-4 text-primary" aria-hidden />
                  <p className="text-sm font-semibold">{t("security.authAndAccess")}</p>
                </div>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  {securityAuthItems.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div className="space-y-3 rounded-lg border border-border p-4">
                <div className="flex items-center gap-2">
                  <ClipboardList className="h-4 w-4 text-primary" aria-hidden />
                  <p className="text-sm font-semibold">{t("security.operations")}</p>
                </div>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  {securityOpsItems.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </CardContent>
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
            <Reveal key={item.question} delayMs={50 * index}>
              <details className="group rounded-lg border border-border bg-card p-4 open:border-primary/40">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-md pr-1 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
                  <span>{item.question}</span>
                  <ChevronDown
                    className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300 group-open:rotate-180"
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
                  <Link href="/signup">{t("actions.bookDemo")}</Link>
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

