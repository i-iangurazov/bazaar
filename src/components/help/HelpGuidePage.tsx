"use client";

import Link from "next/link";
import { useLocale } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { ArrowRightIcon, CheckIcon, ExternalLinkIcon } from "@/components/icons";
import { getHelpCategory, getHelpGuideById } from "@/content/help/catalog";
import type { HelpGuide } from "@/content/help/types";
import { formatHelpCount, localize, localizedUi } from "@/content/help/ui";
import { defaultLocale, normalizeLocale } from "@/lib/locales";
import { AnnotatedScreenshot } from "./AnnotatedScreenshot";
import { HelpIcon } from "./HelpIcon";
import { trackHelpEvent } from "./help-analytics";
import styles from "./help.module.css";

export const HelpGuidePage = ({
  guide,
  sourceRoute,
}: {
  guide: HelpGuide;
  sourceRoute?: string;
}) => {
  const locale = normalizeLocale(useLocale()) ?? defaultLocale;
  const ui = localizedUi(locale);
  const [feedback, setFeedback] = useState<boolean | null>(null);
  const category = getHelpCategory(guide.category);
  const guideId = `${guide.category}/${guide.slug}`;
  const related = useMemo(
    () => guide.relatedGuides.map((id) => getHelpGuideById(id)).filter(Boolean) as HelpGuide[],
    [guide.relatedGuides],
  );

  useEffect(() => {
    trackHelpEvent({ type: "guide_view", guideId, sourceRoute });
  }, [guideId, sourceRoute]);

  const submitFeedback = (helpful: boolean) => {
    setFeedback(helpful);
    trackHelpEvent({ type: "feedback", guideId, helpful, sourceRoute });
  };

  return (
    <main className={`${styles.helpMain} ${styles.articleMain}`}>
      <nav className={styles.breadcrumbs} aria-label="Breadcrumb">
        <Link href="/help">{ui.home}</Link>
        <span aria-hidden>/</span>
        {category ? (
          <Link href={`/help/${category.slug}`}>{localize(category.title, locale)}</Link>
        ) : null}
        <span aria-hidden>/</span>
        <span>{localize(guide.title, locale)}</span>
      </nav>
      <header className={styles.articleHero}>
        <div className={styles.articleMeta}>
          <span>
            <HelpIcon name={category?.icon ?? "rocket"} />
            {category ? localize(category.title, locale) : "Bazaar Guide"}
          </span>
          <span>
            {guide.estimatedMinutes} {ui.minutes}
          </span>
          <span>
            {formatHelpCount(guide.steps.length, "step", locale)}
          </span>
        </div>
        <h1>{localize(guide.title, locale)}</h1>
        <p>{localize(guide.summary, locale)}</p>
        <small>
          <CheckIcon aria-hidden />
          {ui.updated}
        </small>
      </header>

      <div className={styles.articleLayout}>
        <aside className={styles.articleToc}>
          <strong>{ui.onThisPage}</strong>
          {guide.steps.map((item, index) => (
            <a key={index} href={`#step-${index + 1}`}>
              <span>{index + 1}</span>
              {localize(item.title, locale)}
            </a>
          ))}
          <Link href={guide.appRoute}>
            <ExternalLinkIcon aria-hidden />
            {ui.openInBazaar}
          </Link>
        </aside>
        <article className={styles.articleBody}>
          {guide.steps.map((item, index) => (
            <section key={index} id={`step-${index + 1}`} className={styles.articleStep}>
              <div className={styles.stepHeading}>
                <span>{index + 1}</span>
                <div>
                  <small>
                    {ui.step} {index + 1}
                  </small>
                  <h2>{localize(item.title, locale)}</h2>
                </div>
              </div>
              <p>{localize(item.body, locale)}</p>
              {item.checklist?.length ? (
                <ul className={styles.visualChecklist}>
                  {item.checklist.map((check, checkIndex) => (
                    <li key={checkIndex}>
                      <CheckIcon aria-hidden />
                      {localize(check, locale)}
                    </li>
                  ))}
                </ul>
              ) : null}
              {item.note ? (
                <aside className={styles.stepNote}>{localize(item.note, locale)}</aside>
              ) : null}
              {item.media ? <AnnotatedScreenshot media={item.media} locale={locale} /> : null}
            </section>
          ))}

          <section className={styles.successCard}>
            <span>
              <CheckIcon aria-hidden />
            </span>
            <div>
              <small>{ui.success}</small>
              <h2>{localize(guide.success, locale)}</h2>
            </div>
          </section>
          <Link className={styles.appCta} href={guide.appRoute}>
            {ui.openInBazaar}
            <ArrowRightIcon aria-hidden />
          </Link>

          {guide.troubleshooting?.length ? (
            <section className={styles.troubleshooting}>
              <h2>{ui.troubleshooting}</h2>
              {guide.troubleshooting.map((item, index) => (
                <div key={index}>
                  <strong>{localize(item.question, locale)}</strong>
                  <p>{localize(item.answer, locale)}</p>
                </div>
              ))}
              <Link href="mailto:support@bazaar.kg">
                {ui.support}
                <ArrowRightIcon aria-hidden />
              </Link>
            </section>
          ) : null}

          <section className={styles.feedbackCard}>
            {feedback === null ? (
              <>
                <strong>{ui.feedback}</strong>
                <div>
                  <button type="button" onClick={() => submitFeedback(true)}>
                    👍 {ui.feedbackYes}
                  </button>
                  <button type="button" onClick={() => submitFeedback(false)}>
                    👎 {ui.feedbackNo}
                  </button>
                </div>
              </>
            ) : (
              <strong>
                <CheckIcon aria-hidden />
                {ui.feedbackThanks}
              </strong>
            )}
          </section>

          <section className={styles.relatedSection}>
            <h2>{ui.related}</h2>
            <div>
              {related.map((item) => (
                <Link
                  key={`${item.category}/${item.slug}`}
                  href={`/help/${item.category}/${item.slug}`}
                >
                  <span>
                    <strong>{localize(item.title, locale)}</strong>
                    <small>{localize(item.summary, locale)}</small>
                  </span>
                  <ArrowRightIcon aria-hidden />
                </Link>
              ))}
            </div>
          </section>
        </article>
      </div>
    </main>
  );
};
