import { readFileSync } from "node:fs";

import type { Page } from "@playwright/test";

import { expectNoUncontainedHorizontalClipping } from "../browser-zoom-assertions";
import { expect } from "./test-fixtures";

export const breadthLocales = ["en", "ru", "kg"] as const;

export type BreadthLocale = (typeof breadthLocales)[number];

export const documentLanguageByBreadthLocale: Record<BreadthLocale, string> = {
  en: "en-US",
  ru: "ru",
  kg: "ky-KG",
};

type MessageTree = Record<string, unknown>;

const normalizeMessage = (value: string) => value.replace(/\s+/g, " ").trim().toLocaleLowerCase();

const collectMessages = (value: unknown): string[] => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectMessages);
  if (typeof value === "object" && value !== null) {
    return Object.values(value).flatMap(collectMessages);
  }
  return [];
};

const catalogMessages = Object.fromEntries(
  breadthLocales.map((locale) => [
    locale,
    collectMessages(
      JSON.parse(
        readFileSync(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8"),
      ) as MessageTree,
    ),
  ]),
) as Record<BreadthLocale, string[]>;

const normalizedCatalogMessages = Object.fromEntries(
  breadthLocales.map((locale) => [
    locale,
    new Set(catalogMessages[locale].map(normalizeMessage).filter(Boolean)),
  ]),
) as Record<BreadthLocale, Set<string>>;

const isUsefulLanguageFingerprint = (value: string) => {
  if (/[{}<>@]/.test(value) || /https?:|\b(?:sku|url|api|kkm|pos|kgs)\b/i.test(value)) return false;
  const letters = value.match(/[\p{L}]/gu)?.length ?? 0;
  const words = value.split(/\s+/u).filter(Boolean).length;
  return letters >= 8 && (words >= 2 || letters >= 12) && value.length <= 180;
};

const foreignFingerprintsByLocale = Object.fromEntries(
  breadthLocales.map((locale) => {
    const currentMessages = normalizedCatalogMessages[locale];
    const fingerprints = new Map<string, BreadthLocale[]>();

    for (const foreignLocale of breadthLocales.filter((candidate) => candidate !== locale)) {
      for (const rawMessage of catalogMessages[foreignLocale]) {
        const message = normalizeMessage(rawMessage);
        if (!message || currentMessages.has(message) || !isUsefulLanguageFingerprint(message)) {
          continue;
        }
        const locales = fingerprints.get(message) ?? [];
        if (!locales.includes(foreignLocale)) locales.push(foreignLocale);
        fingerprints.set(message, locales);
      }
    }

    return [locale, [...fingerprints.entries()]];
  }),
) as Record<BreadthLocale, Array<[string, BreadthLocale[]]>>;

/**
 * Detect exact visible UI-copy leaves that belong only to another supported
 * message catalog. Exact text-node matching avoids treating fixture names,
 * SKUs, email addresses, or user-entered Cyrillic/Latin data as UI copy.
 */
export const assertNoMixedLanguageMessages = async (page: Page, locale: BreadthLocale) => {
  await expect(page.locator("html")).toHaveAttribute(
    "lang",
    documentLanguageByBreadthLocale[locale],
  );

  const foreignFingerprints = foreignFingerprintsByLocale[locale];
  const issues = await page.evaluate((fingerprints) => {
    const foreignMessages = new Map(fingerprints);
    const normalize = (value: string) => value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
    const results: Array<{ copy: string; foreignLocales: string[]; element: string }> = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);

    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || parent.closest("script, style, noscript, [aria-hidden='true'], [inert]")) {
        continue;
      }
      const rect = parent.getBoundingClientRect();
      const style = getComputedStyle(parent);
      if (
        rect.width <= 0 ||
        rect.height <= 0 ||
        style.display === "none" ||
        style.visibility === "hidden"
      ) {
        continue;
      }

      const copy = normalize(node.nodeValue ?? "");
      const foreignLocales = foreignMessages.get(copy);
      if (!foreignLocales) continue;
      results.push({
        copy: (node.nodeValue ?? "").replace(/\s+/g, " ").trim(),
        foreignLocales,
        element: parent.tagName.toLowerCase(),
      });
      if (results.length >= 20) break;
    }

    return results;
  }, foreignFingerprints);

  expect(
    issues,
    `${locale.toUpperCase()} screen must not contain exact UI copy unique to another locale`,
  ).toEqual([]);
};

/**
 * Cross-route responsive contract for controls, long labels, and wide tables.
 * Wide content may scroll inside an intentional local container; the page root
 * and controls themselves must remain reachable and labels must not be clipped.
 */
export const assertResponsiveControlBreadth = async (page: Page) => {
  const scope = page.locator("body");
  await expectNoUncontainedHorizontalClipping(page, scope);

  const labelIssues = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLElement>(
        "h1, h2, h3, label, button, a[href], [role='tab'], [role='menuitem']",
      ),
    )
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        if (
          rect.width <= 0 ||
          rect.height <= 0 ||
          style.display === "none" ||
          style.visibility === "hidden" ||
          !element.textContent?.trim()
        ) {
          return false;
        }
        const intentionallyCondensed = /(?:^|\s)(?:truncate|line-clamp-\d+)(?:\s|$)/.test(
          element.className,
        );
        if (intentionallyCondensed) return false;
        const clipsOverflow =
          ["hidden", "clip"].includes(style.overflowX) ||
          ["hidden", "clip"].includes(style.overflowY);
        return (
          clipsOverflow &&
          (element.scrollWidth > element.clientWidth + 1 ||
            element.scrollHeight > element.clientHeight + 1)
        );
      })
      .map((element) => ({
        element: element.tagName.toLowerCase(),
        text: element.textContent?.replace(/\s+/g, " ").trim().slice(0, 140) ?? "",
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      })),
  );

  expect(
    labelIssues,
    "non-condensed headings and interactive labels must wrap or remain fully visible",
  ).toEqual([]);

  const tableIssues = await page.evaluate(() => {
    const isRendered = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        !element.closest("[aria-hidden='true'], [inert]")
      );
    };

    return Array.from(document.querySelectorAll<HTMLElement>("table"))
      .filter(isRendered)
      .flatMap((table) => {
        if (table.scrollWidth <= window.innerWidth + 1) return [];
        for (let parent = table.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          if (
            parent.scrollWidth > parent.clientWidth + 1 &&
            (style.overflowX === "auto" || style.overflowX === "scroll")
          ) {
            return [];
          }
          if (parent === document.body) break;
        }
        return [
          {
            label:
              table.getAttribute("aria-label") ?? table.textContent?.trim().slice(0, 100) ?? "",
            width: table.scrollWidth,
            viewportWidth: window.innerWidth,
          },
        ];
      });
  });

  expect(tableIssues, "wide tables must use an intentional local horizontal scroller").toEqual([]);

  const disabledStateIssues = await page.evaluate(() => {
    const selector = [
      "button[disabled]",
      "button[aria-disabled='true']",
      "a[aria-disabled='true']",
      "input[disabled]",
      "select[disabled]",
      "textarea[disabled]",
      "[role='button'][aria-disabled='true']",
      "[role='combobox'][aria-disabled='true']",
    ].join(",");

    return Array.from(document.querySelectorAll<HTMLElement>(selector))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden";
      })
      .filter((element) => {
        const nativeDisabled =
          element instanceof HTMLButtonElement ||
          element instanceof HTMLInputElement ||
          element instanceof HTMLSelectElement ||
          element instanceof HTMLTextAreaElement
            ? element.disabled
            : false;
        return !nativeDisabled && element.getAttribute("aria-disabled") !== "true";
      })
      .map((element) => ({
        element: element.tagName.toLowerCase(),
        name: element.getAttribute("aria-label") ?? element.textContent?.trim().slice(0, 100) ?? "",
      }));
  });

  expect(
    disabledStateIssues,
    "disabled controls must expose native disabled or aria-disabled semantics",
  ).toEqual([]);
};
