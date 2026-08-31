"use client";

import Image from "next/image";
import Link from "next/link";
import React from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { ArrowRightIcon, CheckIcon, SearchIcon } from "@/components/icons";
import type { HelpHomeData } from "@/content/help/home-data";
import { searchHelpDocuments } from "@/content/help/search-core";
import type { HelpLocale } from "@/content/help/types";
import { formatGuideCount, localize, localizedUi } from "@/content/help/ui";
import { HelpIcon } from "./HelpIcon";
import { trackHelpEvent } from "./help-analytics";
import styles from "./help.module.css";

const progressKey = "bazaar-guide:getting-started:v1";

export const HelpHome = ({ locale, data }: { locale: HelpLocale; data: HelpHomeData }) => {
  const ui = localizedUi(locale);
  const [query, setQuery] = useState("");
  const [activeResult, setActiveResult] = useState(0);
  const [selectedRole, setSelectedRole] = useState(data.roles[0]?.role ?? "owner");
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => searchHelpDocuments(data.guides, query), [data.guides, query]);
  const roleTrack = data.roles.find((track) => track.role === selectedRole) ?? data.roles[0];

  useEffect(() => {
    try {
      const value = JSON.parse(window.localStorage.getItem(progressKey) ?? "[]") as string[];
      setCompleted(new Set(value));
    } catch {
      setCompleted(new Set());
    }
  }, []);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (event.altKey || (!event.metaKey && !event.ctrlKey) || event.key.toLowerCase() !== "k") {
        return;
      }
      event.preventDefault();
      searchRef.current?.focus();
    };

    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) return;
    const timer = window.setTimeout(() => {
      trackHelpEvent({ type: results.length ? "search" : "zero_result", query: trimmed });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [query, results.length]);

  const updateProgress = (guideId: string) => {
    setCompleted((current) => {
      const next = new Set(current);
      if (next.has(guideId)) next.delete(guideId);
      else next.add(guideId);
      window.localStorage.setItem(progressKey, JSON.stringify(Array.from(next)));
      return next;
    });
  };

  return (
    <main className={styles.helpMain}>
      <section className={styles.helpHero}>
        <div className={styles.helpHeroGlow} aria-hidden />
        <div className={styles.helpHeroCopy}>
          <span className={styles.eyebrow}>Bazaar Guide</span>
          <h1>{ui.searchTitle}</h1>
          <p>
            {localize(
              {
                ru: "Короткие визуальные инструкции для кассы, товаров, склада и управления магазином.",
                kg: "Касса, товарлар, кампа жана дүкөндү башкаруу үчүн кыска визуалдык нускамалар.",
                en: "Short visual guides for POS, products, inventory, and store management.",
              },
              locale,
            )}
          </p>
          <div className={styles.searchShell}>
            <SearchIcon className={styles.searchIcon} aria-hidden />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveResult(0);
              }}
              onKeyDown={(event) => {
                if (!results.length) return;
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActiveResult((current) => (current + 1) % results.length);
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveResult((current) => (current - 1 + results.length) % results.length);
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  const selected = results[activeResult];
                  if (selected) window.location.assign(`/help/${selected.document.id}`);
                } else if (event.key === "Escape") {
                  setQuery("");
                }
              }}
              placeholder={ui.searchPlaceholder}
              aria-label={ui.searchLabel}
              aria-expanded={Boolean(query)}
              aria-controls="help-search-results"
              aria-activedescendant={
                results[activeResult] ? `help-result-${activeResult}` : undefined
              }
              role="combobox"
              autoComplete="off"
            />
            <kbd aria-hidden>⌘/Ctrl K</kbd>
          </div>
          {query ? (
            <div
              id="help-search-results"
              className={styles.searchResults}
              role="listbox"
              aria-label={ui.searchResults}
            >
              {results.length ? (
                results.map(({ document }, index) => {
                  return (
                    <Link
                      id={`help-result-${index}`}
                      key={document.id}
                      href={`/help/${document.id}`}
                      className={
                        index === activeResult ? styles.searchResultActive : styles.searchResult
                      }
                      role="option"
                      aria-selected={index === activeResult}
                      onMouseEnter={() => setActiveResult(index)}
                    >
                      <HelpIcon name={document.categoryIcon} />
                      <span>
                        <strong>{document.title}</strong>
                        <small>{document.summary}</small>
                      </span>
                      <ArrowRightIcon aria-hidden />
                    </Link>
                  );
                })
              ) : (
                <p className={styles.noResults}>{ui.noResults}</p>
              )}
            </div>
          ) : null}
          <div className={styles.quickSearches}>
            {data.quickSearches.map((term) => (
              <button
                key={term}
                type="button"
                onClick={() => {
                  setQuery(term);
                  searchRef.current?.focus();
                }}
              >
                {term}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.helpHeroVisual}>
          <div className={styles.heroImageFrame}>
            <Image
              src="/marketing/captures/pos-desktop-wide.webp"
              alt={localize({ ru: "Касса Bazaar", kg: "Bazaar кассасы", en: "Bazaar POS" }, locale)}
              fill
              priority
              sizes="(max-width: 900px) 92vw, 600px"
            />
          </div>
          <div className={styles.heroMiniFrame}>
            <Image
              src="/marketing/captures/pos-mobile.webp"
              alt={localize(
                {
                  ru: "Мобильная касса Bazaar",
                  kg: "Bazaar мобилдик кассасы",
                  en: "Bazaar mobile POS",
                },
                locale,
              )}
              fill
              priority
              sizes="180px"
            />
          </div>
          <span className={styles.heroCallout}>
            <b>1</b>
            {localize(
              { ru: "Выберите товар", kg: "Товарды тандаңыз", en: "Choose a product" },
              locale,
            )}
          </span>
          <span className={styles.heroCalloutAlt}>
            <b>2</b>
            {localize({ ru: "Примите оплату", kg: "Төлөмдү алыңыз", en: "Take payment" }, locale)}
          </span>
        </div>
      </section>

      <section id="tasks" className={styles.section}>
        <div className={styles.sectionHeading}>
          <span>01</span>
          <div>
            <h2>{ui.tasksTitle}</h2>
            <p>{ui.tasksSubtitle}</p>
          </div>
        </div>
        <div className={styles.taskGrid}>
          {data.tasks.map((task) => (
            <Link
              key={`${task.guideId}-${task.title}`}
              href={`/help/${task.guideId}`}
              className={styles.taskCard}
              data-help-task
            >
              <span className={styles.taskIcon}>
                <HelpIcon name={task.icon} />
              </span>
              <span>
                <strong>{task.title}</strong>
                <small>{task.description}</small>
              </span>
              <ArrowRightIcon className={styles.taskArrow} aria-hidden />
            </Link>
          ))}
        </div>
      </section>

      <section id="getting-started" className={`${styles.section} ${styles.journeySection}`}>
        <div className={styles.sectionHeading}>
          <span>02</span>
          <div>
            <h2>{ui.journeyTitle}</h2>
            <p>{ui.journeySubtitle}</p>
          </div>
        </div>
        <div className={styles.journeyGrid}>
          {data.journey.map((item, index) => {
            const done = completed.has(item.guideId);
            return (
              <article
                key={`${item.guideId}-${index}`}
                className={done ? styles.journeyDone : styles.journeyCard}
                data-help-journey-step
              >
                <div className={styles.journeyTop}>
                  <span>{done ? <CheckIcon aria-hidden /> : index + 1}</span>
                  <small>
                    {item.estimatedMinutes} {ui.minutes}
                  </small>
                </div>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
                <div className={styles.journeyActions}>
                  <Link href={`/help/${item.guideId}`}>{ui.openGuide}</Link>
                  <button
                    type="button"
                    onClick={() => updateProgress(item.guideId)}
                    aria-pressed={done}
                  >
                    {done ? ui.completed : ui.markDone}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
        {completed.size ? (
          <button
            className={styles.resetProgress}
            type="button"
            onClick={() => {
              window.localStorage.removeItem(progressKey);
              setCompleted(new Set());
            }}
          >
            {ui.resetProgress}
          </button>
        ) : null}
      </section>

      <section id="roles" className={styles.section}>
        <div className={styles.sectionHeading}>
          <span>03</span>
          <div>
            <h2>{ui.roleTitle}</h2>
            <p>{ui.roleSubtitle}</p>
          </div>
        </div>
        <div className={styles.roleTabs} role="tablist" aria-label={ui.roleTitle}>
          {data.roles.map((track) => (
            <button
              key={track.role}
              type="button"
              role="tab"
              aria-selected={track.role === selectedRole}
              className={track.role === selectedRole ? styles.roleTabActive : styles.roleTab}
              onClick={() => setSelectedRole(track.role)}
            >
              {track.title}
            </button>
          ))}
        </div>
        {roleTrack ? (
          <div className={styles.rolePanel} role="tabpanel">
            <div>
              <span className={styles.roleOrb}>
                <HelpIcon
                  name={
                    roleTrack.role === "cashier"
                      ? "register"
                      : roleTrack.role === "stockkeeper"
                        ? "inventory"
                        : roleTrack.role === "manager"
                          ? "products"
                          : "dashboard"
                  }
                />
              </span>
              <h3>{roleTrack.title}</h3>
              <p>{roleTrack.description}</p>
            </div>
            <div className={styles.roleLinks}>
              {roleTrack.guides.map((guide) => {
                return (
                  <Link key={guide.id} href={`/help/${guide.id}`}>
                    <CheckIcon aria-hidden />
                    {guide.title}
                  </Link>
                );
              })}
            </div>
          </div>
        ) : null}
      </section>

      <section className={`${styles.section} ${styles.categoriesSection}`}>
        <div className={styles.sectionHeading}>
          <span>04</span>
          <div>
            <h2>{ui.categoriesTitle}</h2>
            <p>
              {localize(
                {
                  ru: "Просмотрите Guide по разделам Bazaar.",
                  kg: "Bazaar Guide бөлүмдөрү боюнча караңыз.",
                  en: "Browse Bazaar Guide by section.",
                },
                locale,
              )}
            </p>
          </div>
        </div>
        <div className={styles.categoryGrid}>
          {data.categories.map((category) => {
            return (
              <Link
                key={category.slug}
                href={`/help/${category.slug}`}
                className={styles.categoryCard}
              >
                <HelpIcon name={category.icon} />
                <span>
                  <strong>{category.title}</strong>
                  <small>{category.description}</small>
                  <em>{formatGuideCount(category.count, locale)}</em>
                </span>
                <ArrowRightIcon aria-hidden />
              </Link>
            );
          })}
        </div>
      </section>
    </main>
  );
};
