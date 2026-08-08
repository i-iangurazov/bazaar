import Image from "next/image";
import Link from "next/link";
import { getLocale } from "next-intl/server";

import { defaultLocale, normalizeLocale } from "@/lib/locales";
import { localizedUi } from "@/content/help/ui";
import { HelpLocaleSwitcher } from "./HelpLocaleSwitcher";
import styles from "./help.module.css";

export const HelpHeader = async () => {
  const locale = normalizeLocale(await getLocale()) ?? defaultLocale;
  const ui = localizedUi(locale);

  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <Link href="/help" className={styles.brand} aria-label="Bazaar Guide">
          <Image src="/brand/icon.png" width={34} height={34} alt="" priority />
          <strong>BAZAAR</strong>
          <em>Guide</em>
        </Link>
        <nav className={styles.headerNav} aria-label={ui.guides}>
          <Link href="/help#getting-started">{ui.journeyTitle}</Link>
          <Link href="/help#tasks">{ui.guides}</Link>
          <Link href="/help#roles">{ui.roleTitle}</Link>
        </nav>
        <div className={styles.headerActions}>
          <HelpLocaleSwitcher />
          <Link className={styles.signInLink} href="/login">
            {ui.signIn}
          </Link>
        </div>
      </div>
    </header>
  );
};
