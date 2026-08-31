import Link from "next/link";
import type { Metadata } from "next";
import { getLocale } from "next-intl/server";

import { HelpHeader } from "@/components/help/HelpHeader";
import { defaultLocale, normalizeLocale } from "@/lib/locales";
import { localize } from "@/content/help/ui";
import styles from "@/components/help/help.module.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.bazaar.kg"),
};

const HelpLayout = async ({ children }: { children: React.ReactNode }) => {
  const locale = normalizeLocale(await getLocale()) ?? defaultLocale;
  return (
    <div className={styles.helpRoot}>
      <HelpHeader />
      {children}
      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <p>
            © {new Date().getFullYear()} Bazaar ·{" "}
            {localize(
              {
                ru: "Помощь для современного магазина",
                kg: "Заманбап дүкөн үчүн жардам",
                en: "Help for the modern retailer",
              },
              locale,
            )}
          </p>
          <nav aria-label="Bazaar Guide footer">
            <Link href="/help">Guide</Link>
            <Link href="/developers/bazaar-api">API</Link>
            <Link href="/privacy">
              {localize({ ru: "Конфиденциальность", kg: "Купуялык", en: "Privacy" }, locale)}
            </Link>
            <Link href="/legal">
              {localize({ ru: "Правовая информация", kg: "Укуктук маалымат", en: "Legal" }, locale)}
            </Link>
            <Link href="mailto:support@bazaar.kg">
              {localize({ ru: "Поддержка", kg: "Колдоо", en: "Support" }, locale)}
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
};

export default HelpLayout;
