import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRightIcon,
  BarcodeIcon,
  BillingIcon,
  InventoryIcon,
  MailIcon,
  MobilePreviewIcon,
  PrintIcon,
  ProductsIcon,
  SalesOrdersIcon,
  SearchIcon,
  SealCheckIcon,
  SpreadsheetIcon,
  StatusSuccessIcon,
  StoresIcon,
  TruckIcon,
  UsersIcon,
} from "@/components/icons-ssr";

import { ForceLightTheme } from "@/components/landing/ForceLightTheme";
import { Reveal } from "@/components/landing/Reveal";
import { StickyNav } from "@/components/landing/StickyNav";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Button } from "@/components/ui/button";
import { getServerAuthToken } from "@/server/auth/token";
import { getPlanLimits, getPlanMonthlyPriceKgs } from "@/server/billing/planCatalog";

const siteUrl = "https://www.bazaar.kg";
const whatsappUrl = "https://wa.me/996709911300";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Bazaar — касса, товары и склад для розничного магазина",
  description:
    "Bazaar помогает магазинам продавать, вести остатки, управлять товарами, клиентами, чеками и штрихкодами в одной системе.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Bazaar — касса, товары и склад для розничного магазина",
    description:
      "POS, товары, склад, клиенты, чеки, штрихкоды, импорт и мобильная работа для розничных магазинов.",
    url: siteUrl,
    siteName: "Bazaar",
    type: "website",
    locale: "ru_KG",
    images: [
      {
        url: "/brand/logo.png",
        width: 724,
        height: 181,
        alt: "Bazaar",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Bazaar — касса, товары и склад для розничного магазина",
    description:
      "Современная касса и учёт товаров для магазинов: продажи, остатки, клиенты, чеки и импорт.",
    images: ["/brand/logo.png"],
  },
  robots: {
    index: true,
    follow: true,
  },
};

const formatKgs = (value: number) =>
  new Intl.NumberFormat("ru-KG", {
    style: "currency",
    currency: "KGS",
    maximumFractionDigits: 0,
  }).format(value);

const navLinks = [
  { href: "#features", label: "Возможности" },
  { href: "#pos", label: "Касса" },
  { href: "#inventory", label: "Запасы" },
  { href: "#products", label: "Товары" },
  { href: "#pricing", label: "Цены" },
  { href: "#faq", label: "FAQ" },
];

const benefits = [
  {
    title: "Быстрая касса",
    text: "Добавляйте товары, выбирайте клиента, принимайте оплату и завершайте продажу без лишних действий.",
    icon: SalesOrdersIcon,
  },
  {
    title: "Точные остатки",
    text: "Оприходование, корректировки, перемещения и минимальные остатки помогают держать склад под контролем.",
    icon: InventoryIcon,
  },
  {
    title: "Товары без хаоса",
    text: "Импортируйте товары, управляйте категориями, фото, SKU и штрихкодами.",
    icon: ProductsIcon,
  },
  {
    title: "Клиентская база",
    text: "Сохраняйте покупателей, связывайте продажи с клиентами и используйте базу для повторных продаж.",
    icon: UsersIcon,
  },
];

const faqItems = [
  {
    question: "Можно ли использовать Bazaar на телефоне?",
    answer:
      "Да. Bazaar открывается в браузере и может быть установлен как PWA-приложение на телефон.",
  },
  {
    question: "Можно ли импортировать товары из Excel?",
    answer:
      "Да. В Bazaar есть импорт товаров и клиентов, включая сопоставление по SKU и штрихкоду, если эти поля используются в магазине.",
  },
  {
    question: "Можно ли печатать чеки и штрихкоды?",
    answer:
      "Да. Поддерживаются PDF-чеки, шаблоны печати и ценники/штрихкоды с настройками под принтер.",
  },
  {
    question: "Подходит ли Bazaar для нескольких магазинов?",
    answer:
      "Да. В тарифах с несколькими точками можно разделять магазины, остатки, пользователей и доступы.",
  },
  {
    question: "Можно ли вести клиентскую базу?",
    answer:
      "Да. Клиенты сохраняются с именем, телефоном, email, источником и связью с продажами, где это доступно.",
  },
  {
    question: "Нужно ли устанавливать программу на компьютер?",
    answer:
      "Нет. Bazaar работает в браузере. Для некоторых сценариев печати может понадобиться настройка печатного коннектора.",
  },
  {
    question: "Можно ли использовать сканер штрихкода?",
    answer:
      "Да. Сканер можно использовать в кассе и при работе с товарами, если штрихкоды включены в настройках магазина.",
  },
];

const planCards = [
  {
    code: "STARTER" as const,
    name: "Новичок",
    for: "Для одного магазина, который наводит порядок в товарах и продажах.",
    features: ["1 магазин", "до 1 000 товаров", "до 5 пользователей", "ценники и клиентские заказы"],
    cta: "Попробовать",
    href: "/signup",
  },
  {
    code: "BUSINESS" as const,
    name: "Бизнесмен",
    for: "Для растущего магазина с кассой, импортом, аналитикой и складом.",
    features: ["до 5 магазинов", "до 5 000 товаров", "касса, импорт и отчёты", "цены по магазинам"],
    cta: "Начать",
    href: "/signup",
    featured: true,
  },
  {
    code: "ENTERPRISE" as const,
    name: "Монополист",
    for: "Для сети магазинов, расширенных процессов и дополнительного контроля.",
    features: ["до 15 магазинов", "до 20 000 товаров", "комплаенс и поддержка", "ККМ при настройке"],
    cta: "Запросить демо",
    href: whatsappUrl,
  },
];

const SectionEyebrow = ({ children }: { children: React.ReactNode }) => (
  <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">{children}</p>
);

const CtaButtons = ({ compact = false }: { compact?: boolean }) => (
  <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
    <Button
      asChild
      className="h-12 w-full rounded-md bg-primary px-6 text-primary-foreground shadow-[0_18px_34px_-24px_hsl(var(--primary)/0.7)] hover:bg-primary/90 sm:w-auto"
    >
      <Link href="/signup">
        Попробовать Bazaar
        <ArrowRightIcon className="h-4 w-4" aria-hidden />
      </Link>
    </Button>
    <Button
      asChild
      variant="secondary"
      className="h-12 w-full rounded-md border-border bg-white/85 px-6 text-foreground hover:bg-white sm:w-auto"
    >
      <a href={compact ? whatsappUrl : "#features"}>{compact ? "Связаться" : "Посмотреть возможности"}</a>
    </Button>
  </div>
);

const HeroProductScene = () => (
  <div className="relative mx-auto w-full min-w-0 max-w-[720px] overflow-hidden lg:max-w-none xl:overflow-visible" aria-label="Интерфейс Bazaar POS">
    <div className="rounded-md border border-border bg-white p-4 shadow-[0_22px_70px_-56px_rgba(15,23,42,0.35)] md:hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
        <div>
          <p className="text-sm font-semibold text-primary">Bazaar POS</p>
          <p className="text-xs text-slate-500">Сегодня · Bishkek Center</p>
        </div>
        <span className="rounded-md bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">Смена открыта</span>
      </div>
      <div className="grid grid-cols-3 gap-2 py-4">
        {[
          ["24 800", "сом"],
          ["18", "чеков"],
          ["7", "остатков"],
        ].map(([value, label]) => (
          <div key={label} className="rounded-md border border-border bg-muted/35 p-3">
            <p className="text-lg font-semibold tracking-tight text-foreground">{value}</p>
            <p className="text-[11px] font-medium text-slate-500">{label}</p>
          </div>
        ))}
      </div>
      <div className="rounded-md border border-border bg-muted/30 p-3">
        <div className="mb-3 flex items-center gap-2 rounded-md bg-white px-3 py-2 text-sm text-slate-500">
          <SearchIcon className="h-4 w-4 text-slate-400" />
          Поиск или сканер
        </div>
        {[
          ["Чехол MagSafe", "1 490 сом"],
          ["Кабель Type-C", "690 сом"],
          ["Power Bank", "3 500 сом"],
        ].map(([name, price]) => (
          <div key={name} className="flex items-center justify-between border-t border-border py-2 text-sm">
            <span className="font-medium text-foreground">{name}</span>
            <span className="font-semibold text-primary">{price}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[11px] font-semibold text-slate-600">
        {["Касса", "Товары", "Запасы"].map((item) => (
          <span key={item} className="rounded-md border border-border bg-white px-2 py-2">
            {item}
          </span>
        ))}
      </div>
    </div>
    <div className="hidden overflow-hidden rounded-md border border-border bg-white shadow-[0_34px_95px_-70px_rgba(37,99,235,0.22)] md:block">
      <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-primary">Bazaar POS</p>
          <p className="text-xs text-slate-500">Магазин: Bishkek Center</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-md bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">Смена открыта</span>
          <span className="rounded-md bg-warning/15 px-3 py-1 text-xs font-semibold text-warning-foreground">3 низких остатка</span>
        </div>
      </div>
      <div className="grid gap-4 p-4 md:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-4">
          <div className="rounded-md border border-border bg-muted/30 p-3 sm:p-4">
            <div className="mb-3 flex items-center gap-2 rounded-md border border-border bg-white px-3 py-2">
              <SearchIcon className="h-4 w-4 shrink-0 text-slate-400" />
              <span className="truncate text-sm text-slate-500">Поиск товара или сканер штрихкода</span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {[
                ["Чехол MagSafe", "1 490 сом"],
                ["Кабель Type-C", "690 сом"],
                ["Наушники", "2 900 сом"],
                ["Плёнка", "350 сом"],
                ["Зарядка 20W", "1 200 сом"],
                ["Power Bank", "3 500 сом"],
              ].map(([name, price], index) => (
                <div key={name} className="rounded-md border border-border bg-white p-3">
                  <div className={`mb-3 h-14 rounded-md ${index % 2 ? "bg-primary/10" : "bg-muted"}`} />
                  <p className="truncate text-sm font-semibold text-slate-900">{name}</p>
                  <p className="text-xs text-slate-500">{price}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {["Импорт готов", "Фото товара", "Ценники", "Отчёт"].map((label) => (
              <div key={label} className="rounded-md border border-border bg-white p-3 text-xs font-semibold text-slate-600">
                {label}
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-md border border-border bg-primary p-4 text-white">
          <p className="text-sm font-semibold">Текущий чек</p>
          <div className="mt-4 space-y-3">
            {[
              ["Чехол MagSafe", "1", "1 490"],
              ["Кабель Type-C", "2", "1 380"],
              ["Плёнка", "1", "350"],
            ].map(([name, qty, total]) => (
              <div key={name} className="grid grid-cols-[1fr_auto_auto] gap-3 border-b border-white/10 pb-3 text-sm">
                <span>{name}</span>
                <span className="text-white/70">x{qty}</span>
                <span>{total}</span>
              </div>
            ))}
          </div>
          <div className="mt-6 rounded-md bg-white p-4 text-primary">
            <div className="flex justify-between text-sm">
              <span>Итого</span>
              <strong>3 220 сом</strong>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <span className="rounded-md bg-primary/10 px-3 py-2 text-center text-xs font-semibold">Наличные</span>
              <span className="rounded-md bg-warning/25 px-3 py-2 text-center text-xs font-semibold">Карта</span>
            </div>
          </div>
          <div className="mt-4 rounded-md border border-white/15 p-3 text-xs text-white/75">
            Чек PDF готов · остаток обновлён · клиент выбран
          </div>
        </div>
      </div>
    </div>
    <div className="absolute -bottom-10 -right-3 hidden w-[170px] rounded-md border border-border bg-foreground p-2 shadow-[0_28px_70px_-46px_rgba(15,23,42,0.42)] xl:block">
      <div className="rounded-md bg-white p-3">
        <div className="mb-3 h-4 w-16 rounded-md bg-muted" />
        <p className="text-xs font-semibold text-slate-500">PWA · телефон</p>
        <p className="mt-1 text-base font-bold text-primary">Остатки</p>
        <div className="mt-3 space-y-2">
          {["Склад", "Касса", "Товары"].map((item, index) => (
            <div key={item} className="rounded-md border border-border p-2">
              <span className="text-xs font-semibold text-slate-900">{item}</span>
              <div className="mt-2 h-2 rounded-md bg-muted">
                <div className={`h-2 rounded-md ${index === 1 ? "w-1/2 bg-warning" : "w-3/4 bg-primary"}`} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  </div>
);

const ProductShowcase = () => (
  <section aria-labelledby="showcase-title" className="relative border-y border-border bg-muted/30">
    <div className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-16 sm:px-6 lg:px-8 lg:py-24 xl:grid-cols-[0.88fr_1.12fr] xl:items-center">
      <Reveal className="space-y-5">
        <SectionEyebrow>Продукт в работе</SectionEyebrow>
        <h2 id="showcase-title" className="max-w-xl text-3xl font-semibold tracking-tight text-foreground sm:text-5xl">
          Вся операционная картина магазина на одном экране
        </h2>
        <p className="max-w-xl text-lg leading-8 text-slate-600">
          Bazaar показывает не абстрактные графики, а то, что важно каждый день: чек, остаток, товар, клиент, импорт и печать.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {["Продажа завершена", "Остаток обновлён", "Чек отправлен на печать", "Импорт товаров готов"].map((item) => (
            <div key={item} className="rounded-md border border-border bg-white p-4 text-sm font-semibold text-foreground">
              <StatusSuccessIcon className="mb-2 h-5 w-5 text-primary" aria-hidden />
              {item}
            </div>
          ))}
        </div>
      </Reveal>
      <Reveal delayMs={120}>
        <DesktopOperationsMockup />
      </Reveal>
    </div>
  </section>
);

const DesktopOperationsMockup = () => (
  <div className="relative">
    <div className="rounded-md border border-border bg-white shadow-[0_34px_90px_-62px_rgba(15,23,42,0.34)]">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-md bg-red-300" />
          <span className="h-3 w-3 rounded-md bg-warning" />
          <span className="h-3 w-3 rounded-md bg-primary" />
        </div>
        <span className="text-xs font-semibold text-slate-500">bazaar.kg/dashboard</span>
      </div>
      <div className="grid gap-0 md:grid-cols-[180px_1fr]">
        <aside className="hidden border-r border-border bg-muted/30 p-4 md:block">
          <Image src="/brand/logo.png" alt="" width={118} height={32} className="mb-6 h-7 w-auto" />
          {["Касса", "Товары", "Запасы", "Клиенты", "Отчёты"].map((item, index) => (
            <div key={item} className={`mb-2 rounded-md px-3 py-2 text-sm ${index === 0 ? "bg-primary/10 font-semibold text-primary" : "text-slate-600"}`}>
              {item}
            </div>
          ))}
        </aside>
        <div className="p-4">
          <div className="mb-4 grid gap-3 sm:grid-cols-4">
            {[
              ["Продажи", "24 800 сом"],
              ["Чеков", "18"],
              ["Низкий остаток", "7"],
              ["Клиентов", "342"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-md border border-border bg-white p-3">
                <p className="text-xs text-slate-500">{label}</p>
                <p className="mt-1 text-lg font-bold text-foreground">{value}</p>
              </div>
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-md border border-border">
              <div className="border-b border-border px-4 py-3 text-sm font-semibold text-foreground">Товары и остатки</div>
              <div className="divide-y divide-border">
                {[
                  ["SKU-1045", "Чехол MagSafe", "34 шт", "1 490 сом"],
                  ["SKU-2180", "Кабель Type-C", "6 шт", "690 сом"],
                  ["SKU-7751", "Наушники", "12 шт", "2 900 сом"],
                ].map(([sku, name, stock, price]) => (
                  <div key={sku} className="grid grid-cols-[80px_1fr_70px_90px] gap-2 px-4 py-3 text-sm">
                    <span className="text-slate-500">{sku}</span>
                    <span className="font-semibold text-foreground">{name}</span>
                    <span className={stock === "6 шт" ? "text-warning-foreground" : "text-slate-600"}>{stock}</span>
                    <span className="text-right text-slate-700">{price}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-md border border-border bg-foreground p-4 text-white">
              <p className="text-sm font-semibold">Последний чек</p>
              <p className="mt-3 text-3xl font-bold">3 220 сом</p>
              <p className="mt-1 text-sm text-white/65">PDF + печать · клиент сохранён</p>
              <div className="mt-5 grid gap-2">
                <div className="rounded-md bg-white/10 p-3 text-sm">Наличные: 2 000 сом</div>
                <div className="rounded-md bg-white/10 p-3 text-sm">Карта: 1 220 сом</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
);

const BenefitCards = () => (
  <section id="features" className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
    <Reveal className="mb-10 max-w-3xl space-y-4">
      <SectionEyebrow>Возможности</SectionEyebrow>
      <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-5xl">
        Не просто CRM и не просто склад. Рабочая система магазина.
      </h2>
      <p className="text-lg leading-8 text-slate-600">
        Bazaar закрывает ежедневные задачи розницы: продажа, товар, остаток, клиент, чек, импорт и отчёт.
      </p>
    </Reveal>
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {benefits.map((benefit, index) => (
        <Reveal key={benefit.title} delayMs={index * 60}>
          <article className="h-full rounded-md border border-border bg-white p-6 shadow-[0_22px_55px_-48px_rgba(15,23,42,0.2)]">
            <div className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-md bg-primary/10 text-primary">
              <benefit.icon className="h-5 w-5" aria-hidden />
            </div>
            <h3 className="text-xl font-semibold text-foreground">{benefit.title}</h3>
            <p className="mt-3 text-sm leading-6 text-slate-600">{benefit.text}</p>
          </article>
        </Reveal>
      ))}
    </div>
  </section>
);

const FeatureSection = ({
  id,
  eyebrow,
  title,
  text,
  features,
  visual,
  reverse = false,
}: {
  id: string;
  eyebrow: string;
  title: string;
  text: string;
  features: string[];
  visual: React.ReactNode;
  reverse?: boolean;
}) => (
  <section id={id} className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
    <div className={`grid gap-10 lg:grid-cols-2 lg:items-center ${reverse ? "lg:[&>*:first-child]:order-2" : ""}`}>
      <Reveal className="space-y-5">
        <SectionEyebrow>{eyebrow}</SectionEyebrow>
        <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-5xl">{title}</h2>
        <p className="text-lg leading-8 text-slate-600">{text}</p>
        <ul className="grid gap-3 sm:grid-cols-2">
          {features.map((feature) => (
            <li key={feature} className="flex items-start gap-3 rounded-md border border-border bg-white p-3 text-sm font-medium text-slate-700">
              <StatusSuccessIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
              {feature}
            </li>
          ))}
        </ul>
      </Reveal>
      <Reveal delayMs={120}>{visual}</Reveal>
    </div>
  </section>
);

const PosMockup = () => (
  <div className="rounded-md border border-border bg-foreground p-4 shadow-[0_28px_80px_-58px_rgba(15,23,42,0.38)]">
    <div className="rounded-md bg-white p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-foreground">Касса</p>
          <p className="text-xs text-slate-500">Смена #42 · кассир Айдана</p>
        </div>
        <BillingIcon className="h-6 w-6 text-primary" aria-hidden />
      </div>
      <div className="grid gap-4 md:grid-cols-[1fr_220px]">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {["Чехол", "Кабель", "Плёнка", "Зарядка", "Наушники", "Power Bank"].map((item, index) => (
            <div key={item} className="rounded-md border border-border p-3">
              <div className={`mb-3 h-14 rounded-md ${index % 2 ? "bg-primary/10" : "bg-muted"}`} />
              <p className="text-sm font-semibold text-slate-900">{item}</p>
              <p className="text-xs text-slate-500">{index % 2 ? "690 сом" : "1 490 сом"}</p>
            </div>
          ))}
        </div>
        <div className="rounded-md border border-border bg-muted/30 p-4">
          <p className="font-semibold text-foreground">Чек</p>
          <div className="mt-3 space-y-2 text-sm text-slate-600">
            <div className="flex justify-between"><span>Чехол</span><span>1 490</span></div>
            <div className="flex justify-between"><span>Кабель x2</span><span>1 380</span></div>
            <div className="flex justify-between"><span>Плёнка</span><span>350</span></div>
          </div>
          <div className="mt-4 flex justify-between border-t border-border pt-3 text-lg font-bold text-foreground">
            <span>Итого</span><span>3 220</span>
          </div>
          <div className="mt-4 rounded-md bg-primary px-4 py-3 text-center text-sm font-semibold text-white">
            Завершить продажу
          </div>
        </div>
      </div>
    </div>
  </div>
);

const InventoryMockup = () => (
  <div className="rounded-md border border-border bg-white p-4 shadow-[0_28px_80px_-58px_rgba(15,23,42,0.24)]">
    <div className="mb-4 flex items-center justify-between">
      <div>
        <p className="text-sm font-semibold text-foreground">Запасы</p>
        <p className="text-xs text-slate-500">Оприходование · перемещение · история</p>
      </div>
      <TruckIcon className="h-6 w-6 text-primary" aria-hidden />
    </div>
    <div className="space-y-3">
      {[
        ["Чехол MagSafe", "34 шт", "Норма"],
        ["Кабель Type-C", "6 шт", "Низкий остаток"],
        ["Зарядка 20W", "+48 шт", "Приход"],
        ["Power Bank", "12 шт", "Перемещение"],
      ].map(([name, qty, status]) => (
        <div key={name} className="grid grid-cols-[1fr_70px_110px] items-center gap-2 rounded-md border border-border p-3 text-sm">
          <span className="font-semibold text-foreground">{name}</span>
          <span className="text-slate-600">{qty}</span>
          <span className={`rounded-md px-2 py-1 text-center text-xs font-semibold ${status === "Низкий остаток" ? "bg-warning/15 text-warning-foreground" : "bg-primary/10 text-primary"}`}>
            {status}
          </span>
        </div>
      ))}
    </div>
  </div>
);

const ProductsImportMockup = () => (
  <div className="rounded-md border border-border bg-white p-4 shadow-[0_28px_80px_-58px_rgba(15,23,42,0.24)]">
    <div className="mb-4 flex items-center justify-between">
      <div>
        <p className="text-sm font-semibold text-foreground">Импорт товаров</p>
        <p className="text-xs text-slate-500">Excel/CSV · SKU · штрихкоды · фото</p>
      </div>
      <SpreadsheetIcon className="h-6 w-6 text-primary" aria-hidden />
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-md border border-dashed border-primary/30 bg-muted/30 p-5 text-center">
        <SpreadsheetIcon className="mx-auto h-8 w-8 text-primary" aria-hidden />
        <p className="mt-3 text-sm font-semibold text-foreground">Файл products.xlsx</p>
        <p className="text-xs text-slate-500">1 284 строки распознаны</p>
      </div>
      <div className="space-y-2">
        {[
          ["Обновить существующие", "932"],
          ["Создать новые", "318"],
          ["Проверить дубли", "34"],
        ].map(([label, value]) => (
          <div key={label} className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
            <span className="text-slate-600">{label}</span>
            <strong className="text-foreground">{value}</strong>
          </div>
        ))}
      </div>
    </div>
  </div>
);

const CustomersMockup = () => (
  <div className="rounded-md border border-border bg-white p-4 shadow-[0_28px_80px_-58px_rgba(15,23,42,0.24)]">
    <div className="mb-4 flex items-center justify-between">
      <div>
        <p className="text-sm font-semibold text-foreground">Клиенты</p>
        <p className="text-xs text-slate-500">Телефон · email · покупки · рассылки</p>
      </div>
      <UsersIcon className="h-6 w-6 text-primary" aria-hidden />
    </div>
    <div className="space-y-3">
      {[
        ["Алина", "+996 555 200 100", "5 покупок"],
        ["Руслан", "ruslan@example.com", "2 покупки"],
        ["Айгерим", "+996 700 440 220", "новый клиент"],
      ].map(([name, contact, status]) => (
        <div key={name} className="flex items-center justify-between rounded-md border border-border p-3">
          <div>
            <p className="font-semibold text-foreground">{name}</p>
            <p className="text-xs text-slate-500">{contact}</p>
          </div>
          <span className="rounded-md bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">{status}</span>
        </div>
      ))}
    </div>
    <div className="mt-4 rounded-md bg-foreground p-4 text-white">
      <MailIcon className="mb-2 h-5 w-5 text-primary" aria-hidden />
      <p className="text-sm font-semibold">Email-кампания</p>
      <p className="mt-1 text-xs text-white/70">Получателей с email: 128</p>
    </div>
  </div>
);

const PrintingMockup = () => (
  <div className="rounded-md border border-border bg-white p-4 shadow-[0_28px_80px_-58px_rgba(15,23,42,0.24)]">
    <div className="grid gap-4 sm:grid-cols-[0.9fr_1.1fr]">
      <div className="rounded-md border border-border bg-muted/30 p-4">
        <PrintIcon className="mb-3 h-6 w-6 text-primary" aria-hidden />
        <p className="font-semibold text-foreground">Чек PDF</p>
        <div className="mt-4 rounded-md bg-white p-4 text-sm text-slate-600 shadow-sm">
          <p className="font-bold text-foreground">Bazaar Store</p>
          <p className="mt-2">Чек #000184</p>
          <p>Чехол MagSafe — 1 490</p>
          <p>Кабель Type-C — 690</p>
          <p className="mt-3 border-t pt-2 font-bold text-foreground">Итого: 2 180 сом</p>
        </div>
      </div>
      <div className="grid gap-3">
        {["58 мм чек", "ценник 40×30", "штрихкод EAN-13", "QZ при настройке"].map((item) => (
          <div key={item} className="flex items-center gap-3 rounded-md border border-border p-3 text-sm font-semibold text-foreground">
            <BarcodeIcon className="h-5 w-5 text-primary" aria-hidden />
            {item}
          </div>
        ))}
      </div>
    </div>
  </div>
);

const MobileMockup = () => (
  <div className="mx-auto max-w-[520px]">
    <div className="grid items-end gap-4 sm:grid-cols-[0.9fr_1.1fr]">
      <div className="rounded-md border border-border bg-foreground p-2 shadow-[0_28px_80px_-58px_rgba(15,23,42,0.38)]">
        <div className="rounded-md bg-white p-4">
          <p className="text-xs font-semibold text-slate-500">Мобильная касса</p>
          <p className="mt-1 text-2xl font-bold text-foreground">3 220 сом</p>
          <div className="mt-5 space-y-2">
            {["Сканировать", "Добавить фото", "Проверить остатки"].map((item) => (
              <div key={item} className="rounded-md border border-border p-3 text-sm font-semibold text-foreground">
                {item}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="rounded-md border border-border bg-white p-4">
        <MobilePreviewIcon className="mb-3 h-6 w-6 text-primary" aria-hidden />
        <p className="text-lg font-semibold text-foreground">PWA без установки из магазина приложений</p>
        <p className="mt-2 text-sm leading-6 text-slate-600">Откройте Bazaar в браузере и закрепите на экране телефона.</p>
      </div>
    </div>
  </div>
);

const PricingSection = () => (
  <section id="pricing" className="border-y border-border bg-muted/30">
    <div className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
      <Reveal className="mb-10 max-w-3xl space-y-4">
        <SectionEyebrow>Цены</SectionEyebrow>
        <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-5xl">
          Подберите тариф под размер вашего магазина
        </h2>
        <p className="text-lg leading-8 text-slate-600">
          Тарифы не перегружены: выберите лимиты по магазинам, товарам и пользователям, а расширенные модули подключайте по мере роста.
        </p>
      </Reveal>
      <div className="grid gap-4 lg:grid-cols-3">
        {planCards.map((plan, index) => {
          const limits = getPlanLimits(plan.code);
          const price = getPlanMonthlyPriceKgs(plan.code);
          return (
            <Reveal key={plan.code} delayMs={index * 80}>
              <article className={`h-full rounded-md border p-6 ${plan.featured ? "border-primary bg-foreground text-background shadow-[0_28px_80px_-58px_rgba(15,23,42,0.38)]" : "border-border bg-white text-foreground"}`}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-2xl font-semibold">{plan.name}</h3>
                    <p className={`mt-2 text-sm leading-6 ${plan.featured ? "text-white/70" : "text-slate-600"}`}>{plan.for}</p>
                  </div>
                  {plan.featured ? (
                    <span className="rounded-md bg-primary/10 px-3 py-1 text-xs font-bold text-primary">Популярно</span>
                  ) : null}
                </div>
                <p className="mt-6 text-3xl font-bold">{formatKgs(price)}<span className={`text-sm font-medium ${plan.featured ? "text-white/60" : "text-slate-500"}`}> / месяц</span></p>
                <ul className="mt-6 space-y-3 text-sm">
                  {[...plan.features, `лимит: ${limits.maxProducts.toLocaleString("ru-RU")} товаров`].map((feature) => (
                    <li key={feature} className="flex items-start gap-2">
                      <StatusSuccessIcon className={`mt-0.5 h-4 w-4 shrink-0 ${plan.featured ? "text-primary" : "text-primary"}`} aria-hidden />
                      <span className={plan.featured ? "text-white/82" : "text-slate-700"}>{feature}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  asChild
                  className={`mt-6 h-11 w-full rounded-md ${plan.featured ? "bg-primary/10 text-primary hover:bg-primary/15" : "bg-primary text-white hover:bg-primary/90"}`}
                >
                  <Link href={plan.href}>{plan.cta}</Link>
                </Button>
              </article>
            </Reveal>
          );
        })}
      </div>
    </div>
  </section>
);

const RootPage = async () => {
  const token = await getServerAuthToken();
  if (token) {
    redirect("/dashboard");
  }

  return (
    <main className="min-h-screen overflow-x-clip bg-white text-foreground">
      <ForceLightTheme />
      <StickyNav
        links={navLinks}
        navAriaLabel="Навигация по Bazaar"
        menuLabel="Открыть меню"
        leftSlot={
          <Link href="/" className="inline-flex items-center gap-2 font-semibold text-foreground">
            <Image src="/brand/logo.png" alt="Bazaar" width={152} height={40} priority className="h-8 w-auto" />
          </Link>
        }
        rightSlot={
          <>
            <div className="hidden sm:block">
              <LanguageSwitcher compact />
            </div>
            <Button asChild variant="ghost" className="hidden rounded-md text-foreground md:inline-flex">
              <Link href="/login">Войти</Link>
            </Button>
            <Button asChild className="inline-flex h-10 rounded-md bg-primary px-4 text-white hover:bg-primary/90 sm:px-5">
              <Link href="/signup">Начать</Link>
            </Button>
          </>
        }
        mobileSlot={
          <>
            <Button asChild className="h-11 rounded-md bg-primary text-white hover:bg-primary/90">
              <Link href="/signup">Попробовать бесплатно</Link>
            </Button>
            <Button asChild variant="secondary" className="h-11 rounded-md bg-white">
              <Link href="/login">Войти</Link>
            </Button>
            <div className="pt-1">
              <LanguageSwitcher compact />
            </div>
          </>
        }
      />

      <section className="relative overflow-hidden border-b border-border bg-muted/30">
        <div className="mx-auto grid w-full max-w-7xl gap-7 px-4 py-10 sm:px-6 sm:py-16 lg:grid-cols-[0.88fr_1.12fr] lg:items-center lg:px-8 lg:py-24">
          <Reveal className="min-w-0 max-w-3xl space-y-5 sm:space-y-6">
            <div className="inline-flex max-w-full flex-wrap items-center gap-2 rounded-md border border-border bg-white/86 px-3 py-2 text-xs font-semibold leading-5 text-primary shadow-sm sm:px-4 sm:text-sm">
              <StoresIcon className="h-4 w-4" aria-hidden />
              <span>Для розничных магазинов, шоурумов и локального бизнеса</span>
            </div>
            <div className="space-y-5">
              <h1 className="max-w-3xl text-[32px] font-semibold leading-[1.06] tracking-tight text-foreground sm:text-5xl lg:text-[68px]">
                Современная касса и учёт товаров для вашего магазина
              </h1>
              <p className="max-w-2xl text-base leading-7 text-slate-700 sm:text-xl sm:leading-8">
                Bazaar помогает розничным магазинам продавать, вести остатки, печатать чеки и штрихкоды, импортировать товары и видеть всю работу магазина в одной системе.
              </p>
            </div>
            <CtaButtons />
            <div className="grid max-w-2xl gap-2 text-sm font-medium text-slate-600 sm:grid-cols-3">
              {["Касса и смены", "Товары и импорт", "Телефон и компьютер"].map((item) => (
                <span key={item} className="flex items-center gap-2">
                  <SealCheckIcon className="h-4 w-4 text-primary" aria-hidden />
                  {item}
                </span>
              ))}
            </div>
          </Reveal>
          <Reveal className="min-w-0" delayMs={120}>
            <HeroProductScene />
          </Reveal>
        </div>
      </section>

      <ProductShowcase />
      <BenefitCards />

      <FeatureSection
        id="pos"
        eyebrow="Касса"
        title="Касса, которая не мешает продавать"
        text="Кассир видит только то, что нужно для продажи: товары, текущий чек, оплату и итог."
        features={[
          "быстрый поиск товара",
          "сканер штрихкода",
          "выбор клиента",
          "оплата наличными и картой",
          "PDF-чек",
          "смены кассы",
        ]}
        visual={<PosMockup />}
      />

      <FeatureSection
        id="inventory"
        eyebrow="Запасы"
        title="Запасы под контролем"
        text="Принимайте поставки, обновляйте количество сразу по нескольким товарам и контролируйте остатки без таблиц в Excel."
        features={[
          "остатки по магазину",
          "оприходование",
          "перемещение между магазинами",
          "минимальные остатки",
          "предупреждения о низком остатке",
          "история движений",
        ]}
        visual={<InventoryMockup />}
        reverse
      />

      <FeatureSection
        id="products"
        eyebrow="Товары и импорт"
        title="Загружайте и обновляйте товары быстрее"
        text="Bazaar помогает не создавать дубли и аккуратно обновлять существующие товары при импорте."
        features={[
          "импорт Excel/CSV",
          "сопоставление по SKU и штрихкоду",
          "фото товаров",
          "категории и варианты",
          "цены и валюты",
          "дублирование похожих товаров",
        ]}
        visual={<ProductsImportMockup />}
      />

      <FeatureSection
        id="customers"
        eyebrow="Клиенты"
        title="Клиенты не теряются после покупки"
        text="Сохраняйте покупателей, находите их по телефону или email и используйте клиентскую базу для повторных продаж."
        features={[
          "клиентская база",
          "выбор клиента в кассе",
          "история покупок, где доступна",
          "email-рассылки",
          "импорт клиентов",
          "поиск по телефону и email",
        ]}
        visual={<CustomersMockup />}
        reverse
      />

      <FeatureSection
        id="printing"
        eyebrow="Печать и штрихкоды"
        title="Чеки и штрихкоды под ваш магазин"
        text="Поддержка печати чеков и штрихкодов с настройками под ваш принтер. Автопечать доступна при корректной настройке печатного коннектора."
        features={[
          "настройка шаблона чека",
          "PDF-чек",
          "печать ценников",
          "штрихкоды",
          "размеры этикеток",
          "QZ/коннектор при настройке",
        ]}
        visual={<PrintingMockup />}
      />

      <FeatureSection
        id="mobile"
        eyebrow="Mobile / PWA"
        title="Работает на компьютере и телефоне"
        text="Открывайте Bazaar в браузере или установите как приложение на телефон. Владелец может проверить операции, а команда — работать с кассой, остатками и фото товаров."
        features={[
          "PWA-установка",
          "мобильная касса",
          "мобильный склад",
          "фото товаров с телефона",
          "операции из браузера",
          "адаптивный интерфейс",
        ]}
        visual={<MobileMockup />}
        reverse
      />

      <PricingSection />

      <section id="faq" className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
        <Reveal className="mb-10 space-y-4">
          <SectionEyebrow>FAQ</SectionEyebrow>
          <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-5xl">Частые вопросы</h2>
          <p className="text-lg leading-8 text-slate-600">Коротко о том, как Bazaar работает в реальном магазине.</p>
        </Reveal>
        <div className="space-y-3">
          {faqItems.map((item, index) => (
            <Reveal key={item.question} delayMs={index * 35}>
              <details className="group rounded-md border border-border bg-white p-5 open:border-primary">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span>{item.question}</span>
                  <ArrowRightIcon className="h-4 w-4 shrink-0 text-slate-500 transition-transform group-open:rotate-90" aria-hidden />
                </summary>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">{item.answer}</p>
              </details>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="px-4 pb-16 sm:px-6 lg:px-8">
        <Reveal>
          <div className="mx-auto max-w-7xl overflow-hidden rounded-md bg-foreground px-6 py-12 text-white sm:px-10 lg:px-14 lg:py-16">
            <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
              <div className="max-w-3xl">
                <h2 className="text-3xl font-semibold tracking-tight sm:text-5xl">Готовы навести порядок в магазине?</h2>
                <p className="mt-4 text-lg leading-8 text-white/72">
                  Запустите кассу, товары, остатки и клиентов в одной системе.
                </p>
              </div>
              <CtaButtons compact />
            </div>
          </div>
        </Reveal>
      </section>

      <footer className="border-t border-border bg-white">
        <div className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1fr_2fr] lg:px-8">
          <div>
            <Image src="/brand/logo.png" alt="Bazaar" width={152} height={40} className="h-8 w-auto" />
            <p className="mt-4 max-w-sm text-sm leading-6 text-slate-600">
              Касса, товары, остатки, клиенты, чеки и штрихкоды для розничного магазина.
            </p>
          </div>
          <div className="grid gap-6 sm:grid-cols-3">
            <div>
              <h3 className="font-semibold text-foreground">Продукт</h3>
              <nav className="mt-3 grid gap-2 text-sm text-slate-600">
                {navLinks.slice(0, 4).map((link) => (
                  <a key={`footer-${link.href}`} href={link.href} className="text-slate-600 hover:text-primary">
                    {link.label}
                  </a>
                ))}
              </nav>
            </div>
            <div>
              <h3 className="font-semibold text-foreground">Доступ</h3>
              <nav className="mt-3 grid gap-2 text-sm">
                <Link href="/login" className="text-slate-600 hover:text-primary">Войти</Link>
                <Link href="/signup" className="text-slate-600 hover:text-primary">Попробовать</Link>
                <a href={whatsappUrl} className="text-slate-600 hover:text-primary">Связаться</a>
              </nav>
            </div>
            <div>
              <h3 className="font-semibold text-foreground">Язык</h3>
              <div className="mt-3">
                <LanguageSwitcher compact />
              </div>
            </div>
          </div>
        </div>
        <div className="border-t border-border px-4 py-5 text-center text-sm text-slate-500">
          © {new Date().getFullYear()} Bazaar. Все права защищены.
        </div>
      </footer>
    </main>
  );
};

export default RootPage;
