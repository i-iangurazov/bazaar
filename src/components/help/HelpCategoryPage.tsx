"use client";

import Link from "next/link";
import { useLocale } from "next-intl";

import { ArrowRightIcon } from "@/components/icons";
import { getGuidesForCategory, helpGuideId, helpJourney } from "@/content/help/catalog";
import type { HelpCategory } from "@/content/help/types";
import { localize, localizedUi } from "@/content/help/ui";
import { defaultLocale, normalizeLocale } from "@/lib/locales";
import { HelpIcon } from "./HelpIcon";
import styles from "./help.module.css";

export const HelpCategoryPage = ({ category }: { category: HelpCategory }) => {
  const locale = normalizeLocale(useLocale()) ?? defaultLocale;
  const ui = localizedUi(locale);
  const guides = getGuidesForCategory(category.slug);

  return (
    <main className={`${styles.helpMain} ${styles.categoryMain}`}>
      <nav className={styles.breadcrumbs} aria-label="Breadcrumb">
        <Link href="/help">{ui.home}</Link>
        <span aria-hidden>/</span>
        <span>{localize(category.title, locale)}</span>
      </nav>
      <header className={styles.categoryHero}>
        <span className={styles.categoryHeroIcon}>
          <HelpIcon name={category.icon} />
        </span>
        <div>
          <p>Bazaar Guide</p>
          <h1>{localize(category.title, locale)}</h1>
          <span>{localize(category.description, locale)}</span>
        </div>
      </header>
      {category.slug === "getting-started" ? (
        <section className={styles.categoryJourney}>
          {helpJourney.map((item, index) => (
            <Link key={`${item.guideId}-${index}`} href={`/help/${item.guideId}`}>
              <b>{index + 1}</b>
              <span>
                <strong>{localize(item.title, locale)}</strong>
                <small>{localize(item.description, locale)}</small>
              </span>
              <em>
                {item.estimatedMinutes} {ui.minutes}
              </em>
              <ArrowRightIcon aria-hidden />
            </Link>
          ))}
        </section>
      ) : guides.length ? (
        <section className={styles.guideList} aria-label={ui.guides}>
          {guides.map((guide) => (
            <Link
              key={helpGuideId(guide)}
              href={`/help/${helpGuideId(guide)}`}
              className={styles.guideListCard}
            >
              <span className={styles.guideListNumber}>
                {String(guides.indexOf(guide) + 1).padStart(2, "0")}
              </span>
              <span>
                <strong>{localize(guide.title, locale)}</strong>
                <small>{localize(guide.summary, locale)}</small>
                <em>
                  {guide.estimatedMinutes} {ui.minutes} · {guide.steps.length}{" "}
                  {ui.step.toLocaleLowerCase()}
                </em>
              </span>
              <ArrowRightIcon aria-hidden />
            </Link>
          ))}
        </section>
      ) : (
        <p className={styles.categoryEmpty}>{ui.categoryEmpty}</p>
      )}
    </main>
  );
};
