import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";
import type { ConsoleMessage, Locator, Page } from "@playwright/test";

import { helpCategories, helpGuides } from "../../src/content/help/catalog";
import {
  emulateBrowserZoomReflow,
  expectNoClippedInteractiveLabels,
  expectNoUncontainedHorizontalClipping,
  expectVisibleKeyboardFocus,
  tabUntilFocused,
} from "./browser-zoom-assertions";
import { browserZoomProfiles } from "./browser-zoom-contract";
import { publicCanonicalRouteInventory } from "./public-route-inventory";

type HtmlRoute = {
  name: string;
  path: string;
  status?: number;
  authNegative?: boolean;
  expectedTitle?: string;
  expectedH1?: string;
};

type SupportedLocale = "en" | "kg" | "ru";

type PublicTitleMessages = {
  meta: { title: string };
  common: {
    language: string;
    switchLocale: string;
    locales: Record<SupportedLocale, string>;
  };
  landing: {
    meta: { title: string };
    hero: { title: string };
    footer: { navigationLabel: string; tagline: string; madeForKyrgyzstan: string };
  };
  auth: {
    email: string;
    emailRequired: string;
    loginTitle: string;
    password: string;
    passwordRequired: string;
    signIn: string;
  };
  signup: {
    createAccount: string;
    email: string;
    emailInvalid: string;
    name: string;
    nameRequired: string;
    password: string;
    passwordMin: string;
    preferredLocale: string;
    title: string;
  };
  invite: {
    entryHint: string;
    entryInvalid: string;
    entryLabel: string;
    entrySubmit: string;
    entryTitle: string;
    goToLogin: string;
    invalidInvite: string;
    title: string;
    tryAnotherInvite: string;
  };
  reset: {
    linkUnavailableDescription: string;
    linkUnavailableTitle: string;
    requestNewLink: string;
    resetTitle: string;
    title: string;
  };
  verify: { goToLogin: string; title: string };
  registerBusiness: {
    linkUnavailableDescription: string;
    linkUnavailableTitle: string;
    restartRegistration: string;
    title: string;
  };
  catalogPublic: { notFoundTitle: string };
  legal: { metaTitle: string; title: string };
  privacy: { metaTitle: string; title: string };
  errors: { tokenInvalid: string };
};

const loadMessages = (locale: SupportedLocale) =>
  JSON.parse(
    readFileSync(new URL(`../../messages/${locale}.json`, import.meta.url), "utf8"),
  ) as PublicTitleMessages;

const enMessages = loadMessages("en");
const kgMessages = loadMessages("kg");
const ruMessages = loadMessages("ru");

type LocalizedAuditRoute = Omit<HtmlRoute, "expectedH1" | "expectedTitle"> & {
  title: (messages: PublicTitleMessages) => string;
  h1: (messages: PublicTitleMessages) => string;
};

type BrowserIssue = {
  kind: "console" | "pageerror";
  text: string;
  url?: string;
};

const malformedToken = "bad";
const missingCatalogSlug = "bad";

const isolatedMalformedPath = (route: HtmlRoute, suffix: string) =>
  route.authNegative && route.path.endsWith(`/${malformedToken}`)
    ? `${route.path}-${suffix}`
    : route.path;

const messagesByLocale: Record<SupportedLocale, PublicTitleMessages> = {
  en: enMessages,
  kg: kgMessages,
  ru: ruMessages,
};

const localizedAuditRoutes: LocalizedAuditRoute[] = [
  {
    name: "landing",
    path: "/",
    title: (messages) => messages.landing.meta.title,
    h1: (messages) => messages.landing.hero.title,
  },
  {
    name: "login",
    path: "/login",
    title: (messages) => messages.auth.loginTitle,
    h1: (messages) => messages.auth.loginTitle,
  },
  {
    name: "signup",
    path: "/signup",
    title: (messages) => messages.signup.title,
    h1: (messages) => messages.signup.title,
  },
  {
    name: "invite entry",
    path: "/invite",
    title: (messages) => messages.invite.title,
    h1: (messages) => messages.invite.entryTitle,
  },
  {
    name: "password reset entry",
    path: "/reset",
    title: (messages) => messages.reset.title,
    h1: (messages) => messages.reset.title,
  },
  {
    name: "malformed invite token",
    path: `/invite/${malformedToken}`,
    authNegative: true,
    title: (messages) => messages.invite.title,
    h1: (messages) => messages.invite.title,
  },
  {
    name: "malformed password-reset token",
    path: `/reset/${malformedToken}`,
    authNegative: true,
    title: (messages) => messages.reset.resetTitle,
    h1: (messages) => messages.reset.linkUnavailableTitle,
  },
  {
    name: "malformed business-registration token",
    path: `/register-business/${malformedToken}`,
    authNegative: true,
    title: (messages) => messages.registerBusiness.title,
    h1: (messages) => messages.registerBusiness.linkUnavailableTitle,
  },
  {
    name: "malformed email-verification token",
    path: `/verify/${malformedToken}`,
    authNegative: true,
    title: (messages) => messages.verify.title,
    h1: (messages) => messages.verify.title,
  },
  {
    name: "missing public catalog",
    path: `/c/${missingCatalogSlug}`,
    status: 404,
    title: (messages) => messages.catalogPublic.notFoundTitle,
    h1: (messages) => messages.catalogPublic.notFoundTitle,
  },
];

const staticHtmlRoutes: HtmlRoute[] = [
  { name: "privacy", path: "/privacy" },
  { name: "legal", path: "/legal" },
  { name: "Bazaar API developer docs", path: "/developers/bazaar-api" },
  { name: "Bazaar Guide", path: "/help" },
  ...localizedAuditRoutes.map((route) => ({
    ...route,
    expectedTitle: route.title(enMessages),
    expectedH1: route.h1(enMessages),
  })),
  { name: "offline fallback", path: "/offline.html" },
];

const categoryRoutes: HtmlRoute[] = helpCategories.map((category) => ({
  name: `Guide category: ${category.slug}`,
  path: `/help/${category.slug}`,
}));

const guideRoutes: HtmlRoute[] = helpGuides.map((guide) => ({
  name: `Guide article: ${guide.category}/${guide.slug}`,
  path: `/help/${guide.category}/${guide.slug}`,
}));

const htmlRoutes = [...staticHtmlRoutes, ...categoryRoutes, ...guideRoutes];

const resourceRoutes = [
  {
    name: "robots",
    path: "/robots.txt",
    contentType: /text\/plain/i,
    validate: (body: string) => {
      expect(body).toMatch(/User-Agent:/i);
      expect(body).toContain("Sitemap:");
    },
  },
  {
    name: "sitemap",
    path: "/sitemap.xml",
    contentType: /(?:application|text)\/xml/i,
    validate: (body: string) => {
      expect(body).toContain("<urlset");
      for (const category of helpCategories) {
        expect(body).toContain(`/help/${category.slug}</loc>`);
      }
      for (const guide of helpGuides) {
        expect(body).toContain(`/help/${guide.category}/${guide.slug}</loc>`);
      }
    },
  },
  {
    name: "web app manifest",
    path: "/manifest.webmanifest",
    contentType: /(?:application\/manifest\+json|application\/json)/i,
    validate: (body: string) => {
      const manifest = JSON.parse(body) as { name?: string; icons?: unknown[] };
      expect(manifest.name).toBe("Bazaar");
      expect(manifest.icons?.length).toBeGreaterThan(0);
    },
  },
  {
    name: "favicon",
    path: "/favicon.ico",
    contentType: /image\/(?:x-icon|vnd\.microsoft\.icon)/i,
    validate: (body: string) => {
      expect(body.length).toBeGreaterThan(0);
    },
  },
];

const assertLocalOrigin = (value: string) => {
  const url = new URL(value);
  expect(url.protocol).toBe(process.env.PUBLIC_E2E_EXPECT_PRODUCTION === "1" ? "https:" : "http:");
  expect(["127.0.0.1", "localhost"]).toContain(url.hostname);
};

const setLocaleCookie = async (page: Page, baseURL: string, locale: SupportedLocale) => {
  assertLocalOrigin(baseURL);
  await page.context().clearCookies();
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: locale, url: baseURL }]);
};

const formatConsoleIssue = (message: ConsoleMessage): BrowserIssue => {
  const location = message.location();
  return {
    kind: "console",
    text: message.text(),
    url: location.url || undefined,
  };
};

const isExpectedNegativeAuthIssue = (route: HtmlRoute, issue: BrowserIssue) => {
  if (!route.authNegative || issue.kind !== "console") {
    return false;
  }

  const isExpectedApiStatus =
    /Failed to load resource: the server responded with a status of (?:400|404|429)/i.test(
      issue.text,
    ) && /\/api\/trpc\/publicAuth\.(?:inviteDetails|verifyEmail)/.test(issue.url ?? "");
  const isExpectedClientValidation =
    /TRPCClientError/i.test(issue.text) && /(?:too_small|at least 10 character)/i.test(issue.text);

  return isExpectedApiStatus || isExpectedClientValidation;
};

const isExpectedDocumentStatusIssue = (route: HtmlRoute, issue: BrowserIssue) => {
  if (!route.status || route.status < 400 || issue.kind !== "console" || !issue.url) {
    return false;
  }

  const statusPattern = new RegExp(`server responded with a status of ${route.status}`, "i");
  return statusPattern.test(issue.text) && new URL(issue.url).pathname === route.path;
};

const isExpectedRouteIssue = (route: HtmlRoute, issue: BrowserIssue) =>
  isExpectedNegativeAuthIssue(route, issue) || isExpectedDocumentStatusIssue(route, issue);

const installLocalOnlyNetworkGuard = async (page: Page, externalRequests: string[]) => {
  await page.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (!requestUrl.protocol.startsWith("http")) {
      await route.continue();
      return;
    }

    if (
      ["127.0.0.1", "localhost"].includes(requestUrl.hostname) &&
      requestUrl.pathname === "/api/auth/session" &&
      route.request().method() === "GET"
    ) {
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      return;
    }

    if (
      ["127.0.0.1", "localhost"].includes(requestUrl.hostname) &&
      requestUrl.pathname === "/api/help/events" &&
      route.request().method() === "POST"
    ) {
      await route.fulfill({ status: 204, body: "" });
      return;
    }

    if (["127.0.0.1", "localhost"].includes(requestUrl.hostname)) {
      await route.continue();
      return;
    }

    externalRequests.push(requestUrl.href);
    await route.abort("blockedbyclient");
  });
};

const waitForTerminalDocument = async (page: Page) => {
  await expect(page.locator("h1:visible").first()).toBeVisible();
  await expect
    .poll(async () => {
      const headings = await page.locator("h1:visible").allTextContents();
      return headings.some((heading) => heading.trim().length > 0);
    })
    .toBe(true);

  await expect(
    page.locator(
      '[aria-busy="true"], [data-testid*="loading" i], [data-testid*="skeleton" i], .animate-spin',
    ),
  ).toHaveCount(0);
  await expect(page.getByText(/^(?:Loading|Загрузка|Жүктөлүүдө)(?:\.{3}|…)?$/i)).toHaveCount(0);
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const expectMeaningfulHeadingOutline = async (page: Page, expectedH1?: string) => {
  const headings = await page
    .locator("h1:visible, h2:visible, h3:visible, h4:visible, h5:visible, h6:visible")
    .evaluateAll((elements) =>
      elements.map((element) => ({
        level: Number(element.tagName.slice(1)),
        text: element.textContent?.trim() ?? "",
      })),
    );

  expect(
    headings.length,
    "the document should expose at least one visible heading",
  ).toBeGreaterThan(0);
  expect(headings[0]?.level, "the heading outline should begin at H1").toBe(1);
  expect(
    headings.filter((heading) => heading.level === 1),
    "the document should expose exactly one primary H1",
  ).toHaveLength(1);
  expect(headings[0]?.text.length, "the primary H1 should be meaningful").toBeGreaterThan(2);
  if (expectedH1) {
    expect(headings[0]?.text).toBe(expectedH1);
  }

  for (let index = 1; index < headings.length; index += 1) {
    expect(
      headings[index]!.level,
      `heading ${index + 1} should not skip a level after ${headings[index - 1]!.text}`,
    ).toBeLessThanOrEqual(headings[index - 1]!.level + 1);
  }
};

const expectAssociatedError = async (
  page: Page,
  control: Locator,
  errorId: string,
  expectedText: string,
) => {
  await expect(control).toHaveAttribute("aria-invalid", "true");
  await expect(control).toHaveAttribute("aria-describedby", errorId);
  await expect(page.locator(`#${errorId}`)).toHaveText(expectedText);
  await expect(control).toHaveAccessibleDescription(expectedText);
};

const expectDescribedByTargetsToResolve = async (control: Locator) => {
  await expect
    .poll(async () =>
      control.evaluate((element) => {
        const ids = (element.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
        return {
          count: ids.length,
          allResolved: ids.every((id) => Boolean(document.getElementById(id)?.textContent?.trim())),
        };
      }),
    )
    .toEqual({ count: 1, allResolved: true });
};

type Rgba = { red: number; green: number; blue: number; alpha: number };

const parseComputedColor = (value: string): Rgba => {
  const channels = value.match(/[\d.]+/g)?.map(Number) ?? [];
  expect(channels.length, `computed color should be RGB/RGBA: ${value}`).toBeGreaterThanOrEqual(3);
  return {
    red: channels[0]!,
    green: channels[1]!,
    blue: channels[2]!,
    alpha: channels[3] ?? 1,
  };
};

const compositeOver = (foreground: Rgba, background: Rgba): Rgba => {
  const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha);
  const blend = (foregroundChannel: number, backgroundChannel: number) =>
    alpha === 0
      ? 0
      : (foregroundChannel * foreground.alpha +
          backgroundChannel * background.alpha * (1 - foreground.alpha)) /
        alpha;
  return {
    red: blend(foreground.red, background.red),
    green: blend(foreground.green, background.green),
    blue: blend(foreground.blue, background.blue),
    alpha,
  };
};

const relativeLuminance = (color: Rgba) => {
  const convert = (channel: number) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return convert(color.red) * 0.2126 + convert(color.green) * 0.7152 + convert(color.blue) * 0.0722;
};

const computedContrastRatio = (foregroundValue: string, backgroundValue: string) => {
  const white = { red: 255, green: 255, blue: 255, alpha: 1 };
  const background = compositeOver(parseComputedColor(backgroundValue), white);
  const foreground = compositeOver(parseComputedColor(foregroundValue), background);
  const values = [relativeLuminance(foreground), relativeLuminance(background)].sort(
    (left, right) => right - left,
  );
  return (values[0]! + 0.05) / (values[1]! + 0.05);
};

const expectComputedContrast = (
  label: string,
  foregroundValue: string,
  backgroundValue: string,
  minimum: number,
) => {
  const ratio = computedContrastRatio(foregroundValue, backgroundValue);
  expect(ratio, `${label}: measured ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(minimum);
};

const expectNoRootOverflow = async (page: Page) => {
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const root = document.documentElement;
        const body = document.body;
        const viewportWidth = window.innerWidth;
        return Math.max(root.scrollWidth, body?.scrollWidth ?? 0) - viewportWidth;
      }),
    )
    .toBeLessThanOrEqual(1);
};

const expectVisibleInteractiveControlsNamed = async (page: Page) => {
  const controls = page.locator(
    "button:not([aria-hidden='true']):visible, a[href]:not([aria-hidden='true']):visible, input:not([type='hidden']):not([aria-hidden='true']):visible, textarea:not([aria-hidden='true']):visible, select:not([aria-hidden='true']):visible, summary:not([aria-hidden='true']):visible, [role='button']:not([aria-hidden='true']):visible, [role='link']:not([aria-hidden='true']):visible, [role='combobox']:not([aria-hidden='true']):visible",
  );
  const count = await controls.count();
  for (let index = 0; index < count; index += 1) {
    await expect(
      controls.nth(index),
      `visible interactive control ${index + 1}/${count} at ${new URL(page.url()).pathname}`,
    ).toHaveAccessibleName(/\S/);
  }
};

const expectNoRawTranslationArtifacts = async (page: Page) => {
  await expect(page.locator("body")).not.toContainText(
    /\[\[missing:|MISSING_MESSAGE|INVALID_MESSAGE/i,
  );
};

test.describe("public Bazaar routes", () => {
  test("maps every current public canonical route to an exercised concrete path", () => {
    const exercisedPaths = new Set(htmlRoutes.map((route) => route.path));

    for (const route of publicCanonicalRouteInventory) {
      expect(exercisedPaths, `${route.pattern} must have a concrete browser case`).toContain(
        route.concretePath,
      );
    }
  });

  for (const route of htmlRoutes) {
    test(`${route.name} has a terminal, responsive document`, async ({
      page,
      baseURL,
    }, testInfo) => {
      expect(baseURL).toBeTruthy();
      assertLocalOrigin(baseURL!);

      const routePath = isolatedMalformedPath(route, `${testInfo.project.name}-route`);

      const issues: BrowserIssue[] = [];
      const externalRequests: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") {
          issues.push(formatConsoleIssue(message));
        }
      });
      page.on("pageerror", (error) => {
        issues.push({ kind: "pageerror", text: error.message });
      });
      await installLocalOnlyNetworkGuard(page, externalRequests);

      const response = await page.goto(routePath, { waitUntil: "domcontentloaded" });
      expect(response, "document navigation should produce an HTTP response").not.toBeNull();
      expect(response!.request().resourceType()).toBe("document");
      expect(response!.status()).toBe(route.status ?? 200);
      expect(response!.headers()["content-type"]).toContain("text/html");

      await expect.poll(() => new URL(page.url()).pathname).toBe(routePath);
      await waitForTerminalDocument(page);
      if (route.expectedTitle) {
        await expect(page).toHaveTitle(new RegExp(escapeRegExp(route.expectedTitle), "u"));
        expect(await page.title()).not.toBe(enMessages.meta.title);
      }
      await expectMeaningfulHeadingOutline(page, route.expectedH1);
      await expectVisibleInteractiveControlsNamed(page);
      await expectNoRawTranslationArtifacts(page);
      await expectNoRootOverflow(page);

      await page.waitForTimeout(100);
      expect(externalRequests, "public smoke must never leave the local origin").toEqual([]);
      expect(issues.filter((issue) => !isExpectedRouteIssue(route, issue))).toEqual([]);
    });
  }
});

test.describe("targeted public accessibility contracts", () => {
  for (const profileKey of ["desktop", "narrow"] as const) {
    test(`BZR-REQ-0199 public landing, Guide, and form reflow at ${browserZoomProfiles[profileKey].name}`, async ({
      page,
      baseURL,
    }, testInfo) => {
      expect(baseURL).toBeTruthy();
      const localeByProject: Record<string, SupportedLocale> = {
        "public-desktop": "ru",
        "public-tablet": "en",
        "public-mobile": "kg",
      };
      const locale = localeByProject[testInfo.project.name];
      expect(locale, `locale matrix is missing ${testInfo.project.name}`).toBeTruthy();
      const messages = messagesByLocale[locale!];
      const profile = browserZoomProfiles[profileKey];
      const externalRequests: string[] = [];
      await installLocalOnlyNetworkGuard(page, externalRequests);
      const zoomSnapshot = await emulateBrowserZoomReflow(page, profile);
      await setLocaleCookie(page, baseURL!, locale!);

      await page.goto("/", { waitUntil: "domcontentloaded" });
      await waitForTerminalDocument(page);
      const landingHeading = page.getByRole("heading", {
        level: 1,
        name: messages.landing.hero.title,
      });
      await expect(landingHeading).toBeVisible();
      const landingHero = landingHeading.locator("xpath=ancestor::section[1]");
      await expectNoRootOverflow(page);
      await expectNoUncontainedHorizontalClipping(page, landingHero);
      await expectNoClippedInteractiveLabels(landingHero);
      const signupCta = landingHero.locator('a[href="/signup"]').first();
      await tabUntilFocused(page, signupCta);
      await expect(signupCta).toBeFocused();
      await expectVisibleKeyboardFocus(page);
      await page.keyboard.press("Enter");
      await expect.poll(() => new URL(page.url()).pathname).toBe("/signup");
      await waitForTerminalDocument(page);

      const signupName = page.locator("#signup-name");
      await tabUntilFocused(page, signupName);
      await expectVisibleKeyboardFocus(page);
      await page.keyboard.type("Zoom reflow keyboard proof");
      await expect(signupName).toHaveValue("Zoom reflow keyboard proof");
      await page.keyboard.press("ControlOrMeta+A");
      await page.keyboard.press("Backspace");
      await expect(signupName).toHaveValue("");
      await expectNoRootOverflow(page);
      await expectNoUncontainedHorizontalClipping(page, page.locator("form"));
      await expectNoClippedInteractiveLabels(page.locator("form"));

      await page.goto("/help", { waitUntil: "domcontentloaded" });
      await waitForTerminalDocument(page);
      const guideSearch = page.getByRole("combobox");
      await page.keyboard.press("Control+K");
      await expect(guideSearch).toBeFocused();
      await expectVisibleKeyboardFocus(page);
      await expectNoRootOverflow(page);
      await expectNoUncontainedHorizontalClipping(page, page.locator("main"));

      const longestLocalizedGuide = helpGuides.reduce((longest, guide) =>
        guide.title[locale!].length > longest.title[locale!].length ? guide : longest,
      );
      await page.goto(`/help/${longestLocalizedGuide.category}/${longestLocalizedGuide.slug}`, {
        waitUntil: "domcontentloaded",
      });
      await waitForTerminalDocument(page);
      const guideHeading = page.getByRole("heading", {
        level: 1,
        name: longestLocalizedGuide.title[locale!],
      });
      await expect(guideHeading).toBeVisible();
      const guideHero = guideHeading.locator("xpath=ancestor::header[1]");
      await expectNoRootOverflow(page);
      await expectNoUncontainedHorizontalClipping(page, page.locator("main"));
      await expectNoClippedInteractiveLabels(guideHero);

      expect(externalRequests, "zoom/reflow checks must stay local").toEqual([]);
      await testInfo.attach("bzr-req-0199-public-zoom-reflow", {
        body: JSON.stringify(
          {
            requirement: "BZR-REQ-0199",
            method:
              "Chrome device-metrics override reproducing 200% browser zoom layout viewport and DPR; pinch scale remains 1",
            profile,
            zoomSnapshot,
            locale,
            routes: [
              "/",
              "/signup",
              "/help",
              `/help/${longestLocalizedGuide.category}/${longestLocalizedGuide.slug}`,
            ],
            assertions: [
              "root overflow",
              "uncontained control clipping",
              "interactive-label clipping",
              "keyboard reachability and activation",
              "visible focus",
              "localized long Guide heading",
              "local-only network",
            ],
            screenReaderBoundary:
              "This automation is not a formal screen-reader session and is not evidence for BZR-REQ-0200.",
          },
          null,
          2,
        ),
        contentType: "application/json",
      });
    });
  }

  test("language switching persists across refresh and navigation", async ({ page, baseURL }) => {
    expect(baseURL).toBeTruthy();
    const externalRequests: string[] = [];
    await installLocalOnlyNetworkGuard(page, externalRequests);
    await setLocaleCookie(page, baseURL!, "en");

    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await waitForTerminalDocument(page);
    await page
      .getByRole("button", {
        name: enMessages.common.switchLocale.replace("{locale}", enMessages.common.locales.kg),
      })
      .click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(kgMessages.auth.loginTitle);
    await expect(page.locator("html")).toHaveAttribute("lang", "ky-KG");

    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForTerminalDocument(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(kgMessages.auth.loginTitle);

    await page
      .getByRole("button", {
        name: kgMessages.common.switchLocale.replace("{locale}", kgMessages.common.locales.ru),
      })
      .click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(ruMessages.auth.loginTitle);
    await expect(page.locator("html")).toHaveAttribute("lang", "ru");

    await page
      .getByRole("button", {
        name: ruMessages.common.switchLocale.replace("{locale}", ruMessages.common.locales.en),
      })
      .click();
    await page.goto("/signup", { waitUntil: "domcontentloaded" });
    await waitForTerminalDocument(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(enMessages.signup.title);
    await expect(page.locator("html")).toHaveAttribute("lang", "en-US");

    expect(externalRequests, "locale switching must stay on the local origin").toEqual([]);
  });

  test("locale prefixes canonicalize and legacy ky normalizes to kg", async ({ page, baseURL }) => {
    expect(baseURL).toBeTruthy();
    const externalRequests: string[] = [];
    await installLocalOnlyNetworkGuard(page, externalRequests);

    const category = helpCategories[0]!;
    const englishGuide = helpGuides[0]!;
    const kyrgyzGuide = helpGuides[1]!;
    for (const localeCase of [
      {
        prefix: "ru",
        locale: "ru",
        path: "/login",
        lang: "ru",
        h1: ruMessages.auth.loginTitle,
      },
      {
        prefix: "kg",
        locale: "kg",
        path: `/help/${category.slug}`,
        lang: "ky-KG",
        h1: category.title.kg,
      },
      {
        prefix: "en",
        locale: "en",
        path: `/help/${englishGuide.category}/${englishGuide.slug}`,
        lang: "en-US",
        h1: englishGuide.title.en,
      },
      {
        prefix: "ky",
        locale: "kg",
        path: `/help/${kyrgyzGuide.category}/${kyrgyzGuide.slug}`,
        lang: "ky-KG",
        h1: kyrgyzGuide.title.kg,
      },
    ] as const) {
      const search = `?source=compatibility&prefix=${localeCase.prefix}`;
      const hash = "#locale-prefix-proof";
      const response = await page.goto(`/${localeCase.prefix}${localeCase.path}${search}${hash}`, {
        waitUntil: "domcontentloaded",
      });
      expect(response).not.toBeNull();
      await expect
        .poll(() => {
          const location = new URL(page.url());
          return {
            pathname: location.pathname,
            search: location.search,
            hash: location.hash,
          };
        })
        .toEqual({ pathname: localeCase.path, search, hash });
      await waitForTerminalDocument(page);
      await expect(page.locator("html")).toHaveAttribute("lang", localeCase.lang);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(localeCase.h1);
      expect(
        (await page.context().cookies(baseURL!)).find((cookie) => cookie.name === "NEXT_LOCALE")
          ?.value,
      ).toBe(localeCase.locale);

      await page.reload({ waitUntil: "domcontentloaded" });
      await waitForTerminalDocument(page);
      await expect(page.locator("html")).toHaveAttribute("lang", localeCase.lang);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(localeCase.h1);
      const reloadedLocation = new URL(page.url());
      expect(reloadedLocation.pathname).toBe(localeCase.path);
      expect(reloadedLocation.search).toBe(search);
      expect(reloadedLocation.hash).toBe(hash);
    }

    expect(externalRequests, "locale-prefix redirects must stay local").toEqual([]);
  });

  test("auth and error routes expose localized metadata and a valid heading outline", async ({
    page,
    baseURL,
  }, testInfo) => {
    expect(baseURL).toBeTruthy();
    const localeByProject: Record<string, SupportedLocale> = {
      "public-desktop": "ru",
      "public-tablet": "en",
      "public-mobile": "kg",
    };
    const documentLanguageByLocale: Record<SupportedLocale, string> = {
      en: "en-US",
      kg: "ky-KG",
      ru: "ru",
    };
    const locale = localeByProject[testInfo.project.name];
    expect(locale, `locale matrix is missing ${testInfo.project.name}`).toBeTruthy();
    const messages = messagesByLocale[locale!];
    const externalRequests: string[] = [];
    await installLocalOnlyNetworkGuard(page, externalRequests);
    await setLocaleCookie(page, baseURL!, locale!);

    for (const route of localizedAuditRoutes) {
      const routePath = isolatedMalformedPath(route, `${testInfo.project.name}-localized`);
      const response = await page.goto(routePath, { waitUntil: "domcontentloaded" });
      expect(response).not.toBeNull();
      expect(response!.status()).toBe(route.status ?? 200);
      await expect.poll(() => new URL(page.url()).pathname).toBe(routePath);
      await waitForTerminalDocument(page);
      await expect(page.locator("html")).toHaveAttribute("lang", documentLanguageByLocale[locale!]);
      await expect(page).toHaveTitle(new RegExp(escapeRegExp(route.title(messages)), "u"));
      expect(await page.title()).not.toBe(messages.meta.title);
      await expectMeaningfulHeadingOutline(page, route.h1(messages));
      if (route.path === "/") {
        const footer = page.locator("footer");
        await expect(footer.locator("nav")).toHaveAttribute(
          "aria-label",
          messages.landing.footer.navigationLabel,
        );
        await expect(footer).toContainText(messages.landing.footer.tagline);
        await expect(footer).toContainText(messages.landing.footer.madeForKyrgyzstan);
      }
    }

    expect(externalRequests, "localized metadata checks must stay local").toEqual([]);
  });

  test("public forms expose names, live validation, and resolvable error descriptions", async ({
    page,
    baseURL,
  }) => {
    expect(baseURL).toBeTruthy();
    const externalRequests: string[] = [];
    await installLocalOnlyNetworkGuard(page, externalRequests);
    await setLocaleCookie(page, baseURL!, "en");

    await page.goto("/signup", { waitUntil: "domcontentloaded" });
    await waitForTerminalDocument(page);

    const signupForm = page.locator("form");
    await expect(signupForm).toHaveAttribute("aria-live", "polite");
    const signupName = page.locator("#signup-name");
    const signupEmail = page.locator("#signup-open-email");
    const signupPassword = page.locator("#signup-password");
    const signupLocale = page.locator("#signup-preferred-locale");
    await expect(signupName).toHaveAccessibleName(enMessages.signup.name);
    await expect(signupEmail).toHaveAccessibleName(enMessages.signup.email);
    await expect(signupPassword).toHaveAccessibleName(enMessages.signup.password);
    await expect(signupLocale).toHaveAccessibleName(enMessages.signup.preferredLocale);
    await page.getByRole("button", { name: enMessages.signup.createAccount }).click();
    await expectAssociatedError(
      page,
      signupName,
      "signup-name-error",
      enMessages.signup.nameRequired,
    );
    await expectAssociatedError(
      page,
      signupEmail,
      "signup-open-email-error",
      enMessages.signup.emailInvalid,
    );
    await expectAssociatedError(
      page,
      signupPassword,
      "signup-password-error",
      enMessages.signup.passwordMin,
    );

    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await waitForTerminalDocument(page);
    const loginForm = page.locator("form");
    const loginEmail = page.locator('input[name="email"]');
    const loginPassword = page.locator('input[name="password"]');
    await expect(loginForm).toHaveAttribute("aria-live", "polite");
    await expect(loginEmail).toHaveAccessibleName(enMessages.auth.email);
    await expect(loginPassword).toHaveAccessibleName(enMessages.auth.password);
    expect(await loginEmail.getAttribute("aria-describedby")).toBeNull();
    expect(await loginPassword.getAttribute("aria-describedby")).toBeNull();
    await page.getByRole("button", { name: enMessages.auth.signIn }).click();
    await expect(loginEmail).toHaveAttribute("aria-invalid", "true");
    await expect(loginPassword).toHaveAttribute("aria-invalid", "true");
    await expectDescribedByTargetsToResolve(loginEmail);
    await expectDescribedByTargetsToResolve(loginPassword);
    await expect(loginEmail).toHaveAccessibleDescription(enMessages.auth.emailRequired);
    await expect(loginPassword).toHaveAccessibleDescription(enMessages.auth.passwordRequired);

    await page.goto("/invite", { waitUntil: "domcontentloaded" });
    await waitForTerminalDocument(page);
    const inviteForm = page.locator("form");
    const inviteToken = page.locator("#invite-token");
    await expect(inviteForm).toHaveAttribute("aria-live", "polite");
    await expect(inviteToken).toHaveAccessibleName(enMessages.invite.entryLabel);
    await expect(inviteToken).toHaveAccessibleDescription(enMessages.invite.entryHint);
    await page.getByRole("button", { name: enMessages.invite.entrySubmit }).click();
    await expectAssociatedError(
      page,
      inviteToken,
      "invite-token-error",
      enMessages.invite.entryInvalid,
    );
    await expect(page.locator("#invite-token-error")).toHaveAttribute("role", "alert");

    expect(externalRequests, "form accessibility checks must stay local").toEqual([]);
  });

  test("invalid public auth tokens remain non-actionable, announced, and recoverable", async ({
    page,
    baseURL,
  }, testInfo) => {
    expect(baseURL).toBeTruthy();
    const isolatedMalformedToken = `${malformedToken}-${testInfo.project.name}-contract`;
    const externalRequests: string[] = [];
    await installLocalOnlyNetworkGuard(page, externalRequests);
    await setLocaleCookie(page, baseURL!, "en");

    await page.goto(`/reset/${isolatedMalformedToken}`, { waitUntil: "domcontentloaded" });
    await waitForTerminalDocument(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      enMessages.reset.linkUnavailableTitle,
    );
    await expect(page.getByRole("status")).toBeVisible();
    await expect(page.getByText(enMessages.reset.linkUnavailableDescription)).toBeVisible();
    await expect(page.locator("form, input, [role=combobox]")).toHaveCount(0);
    const resetRecovery = page.getByRole("link", { name: enMessages.reset.requestNewLink });
    await expect(resetRecovery).toHaveAttribute("href", "/reset");
    await resetRecovery.focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => new URL(page.url()).pathname).toBe("/reset");

    await page.goto(`/register-business/${isolatedMalformedToken}`, {
      waitUntil: "domcontentloaded",
    });
    await waitForTerminalDocument(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      enMessages.registerBusiness.linkUnavailableTitle,
    );
    await expect(page.getByRole("status")).toBeVisible();
    await expect(
      page.getByText(enMessages.registerBusiness.linkUnavailableDescription),
    ).toBeVisible();
    await expect(page.locator("form, input, [role=combobox]")).toHaveCount(0);
    const registrationRecovery = page.getByRole("link", {
      name: enMessages.registerBusiness.restartRegistration,
    });
    await expect(registrationRecovery).toHaveAttribute("href", "/signup");
    await registrationRecovery.focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => new URL(page.url()).pathname).toBe("/signup");

    await page.goto(`/invite/${isolatedMalformedToken}`, { waitUntil: "domcontentloaded" });
    await waitForTerminalDocument(page);
    await expect(page.getByRole("status")).toContainText(enMessages.invite.invalidInvite);
    await expect(page.locator("form, input, [role=combobox]")).toHaveCount(0);
    await expect(page.getByRole("link", { name: enMessages.invite.goToLogin })).toHaveAttribute(
      "href",
      "/login",
    );
    const inviteRecovery = page.getByRole("link", {
      name: enMessages.invite.tryAnotherInvite,
    });
    await expect(inviteRecovery).toHaveAttribute("href", "/invite");
    await inviteRecovery.focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => new URL(page.url()).pathname).toBe("/invite");

    await page.goto(`/verify/${malformedToken}`, { waitUntil: "domcontentloaded" });
    await waitForTerminalDocument(page);
    await expect(page.getByRole("status")).toHaveText(enMessages.errors.tokenInvalid);
    await expect(page.locator("form, input, [role=combobox]")).toHaveCount(0);
    const verificationRecovery = page.getByRole("button", {
      name: enMessages.verify.goToLogin,
    });
    await verificationRecovery.focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => new URL(page.url()).pathname).toBe("/login");

    expect(externalRequests, "token-state checks must stay local").toEqual([]);
  });

  test("footer privacy and legal links activate by keyboard across locale and viewport projects", async ({
    page,
    baseURL,
  }, testInfo) => {
    expect(baseURL).toBeTruthy();
    const localeByProject: Record<string, SupportedLocale> = {
      "public-desktop": "ru",
      "public-tablet": "en",
      "public-mobile": "kg",
    };
    const locale = localeByProject[testInfo.project.name];
    expect(locale, `locale matrix is missing ${testInfo.project.name}`).toBeTruthy();
    const messages = messagesByLocale[locale!];
    const externalRequests: string[] = [];
    await installLocalOnlyNetworkGuard(page, externalRequests);
    await setLocaleCookie(page, baseURL!, locale!);

    const activateFooterLink = async (path: "/legal" | "/privacy") => {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      const link = page.locator(`footer a[href="${path}"]`);
      await link.scrollIntoViewIfNeeded();
      await link.focus();
      await expect(link).toBeFocused();
      await page.keyboard.press("Enter");
      await expect.poll(() => new URL(page.url()).pathname).toBe(path);
      await waitForTerminalDocument(page);
    };

    await activateFooterLink("/privacy");
    await expect(page).toHaveTitle(new RegExp(escapeRegExp(messages.privacy.metaTitle), "u"));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(messages.privacy.title);
    await expectMeaningfulHeadingOutline(page, messages.privacy.title);
    await testInfo.attach(`PUBLIC-001-privacy-${testInfo.project.name}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });

    await activateFooterLink("/legal");
    await expect(page).toHaveTitle(new RegExp(escapeRegExp(messages.legal.metaTitle), "u"));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(messages.legal.title);
    await expectMeaningfulHeadingOutline(page, messages.legal.title);
    await testInfo.attach(`PUBLIC-001-legal-${testInfo.project.name}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });

    expect(externalRequests, "footer keyboard checks must stay local").toEqual([]);
  });

  test("measured core public text samples meet WCAG AA contrast", async ({ page, baseURL }) => {
    expect(baseURL).toBeTruthy();
    const externalRequests: string[] = [];
    await installLocalOnlyNetworkGuard(page, externalRequests);
    await setLocaleCookie(page, baseURL!, "en");

    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await waitForTerminalDocument(page);
    const localeGroup = page.locator('[role="group"]').first();
    const inactiveLocale = localeGroup.locator('button[aria-pressed="false"]').first();
    const authColors = await Promise.all([
      inactiveLocale.evaluate((element) => getComputedStyle(element).color),
      localeGroup.evaluate((element) => getComputedStyle(element).backgroundColor),
    ]);
    expectComputedContrast("inactive auth locale", authColors[0], authColors[1], 4.5);

    await page.goto("/privacy", { waitUntil: "domcontentloaded" });
    await waitForTerminalDocument(page);
    const privacyMain = page.locator("main");
    const privacyUpdated = privacyMain.locator(".text-slate-400").first();
    const privacyAction = privacyMain.locator('a[href="/help"]').first();
    const privacyColors = await Promise.all([
      privacyUpdated.evaluate((element) => getComputedStyle(element).color),
      privacyMain.evaluate((element) => getComputedStyle(element).backgroundColor),
      privacyAction.evaluate((element) => getComputedStyle(element).color),
      privacyAction.evaluate((element) => getComputedStyle(element).backgroundColor),
    ]);
    expectComputedContrast("privacy update", privacyColors[0], privacyColors[1], 4.5);
    expectComputedContrast("privacy primary action", privacyColors[2], privacyColors[3], 4.5);

    await page.goto(`/c/${missingCatalogSlug}`, { waitUntil: "domcontentloaded" });
    await waitForTerminalDocument(page);
    const catalogColors = await page.evaluate(() => {
      const description = document.querySelector("main p");
      if (!description) throw new Error("missing catalog description");
      const secondary = getComputedStyle(document.documentElement)
        .getPropertyValue("--secondary")
        .trim();
      const probe = document.createElement("span");
      probe.style.backgroundColor = `hsl(${secondary})`;
      document.body.append(probe);
      const result = {
        foreground: getComputedStyle(description).color,
        background: getComputedStyle(probe).backgroundColor,
      };
      probe.remove();
      return result;
    });
    expectComputedContrast(
      "catalog not-found description on conservative secondary surface",
      catalogColors.foreground,
      catalogColors.background,
      4.5,
    );

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForTerminalDocument(page);
    const footer = page.locator("footer");
    const footerLink = footer.locator('a[href="/privacy"]');
    const footerBottom = footer.locator(":scope > div").last().locator("span").first();
    const footerColors = await Promise.all([
      footerLink.evaluate((element) => getComputedStyle(element).color),
      footer.evaluate((element) => getComputedStyle(element).backgroundColor),
      footerBottom.evaluate((element) => getComputedStyle(element).color),
    ]);
    expectComputedContrast("landing footer links", footerColors[0], footerColors[1], 4.5);
    expectComputedContrast("landing footer fine print", footerColors[2], footerColors[1], 4.5);

    expect(externalRequests, "contrast checks must stay local").toEqual([]);
  });

  test("Guide search shortcut exposes a visible, contrasting browser focus state", async ({
    page,
    baseURL,
  }) => {
    expect(baseURL).toBeTruthy();
    const externalRequests: string[] = [];
    await installLocalOnlyNetworkGuard(page, externalRequests);
    await setLocaleCookie(page, baseURL!, "en");
    await page.goto("/help", { waitUntil: "domcontentloaded" });
    await waitForTerminalDocument(page);

    const search = page.getByRole("combobox");
    for (const shortcut of ["Meta+K", "Control+K"]) {
      await search.evaluate((element) => (element as HTMLInputElement).blur());
      await page.keyboard.press(shortcut);
      await expect(search).toBeFocused();
    }

    const shell = search.locator("..");
    const focusColors = await Promise.all([
      shell.evaluate((element) => getComputedStyle(element).borderTopColor),
      shell.evaluate((element) => getComputedStyle(element).backgroundColor),
    ]);
    expectComputedContrast("Guide search focus border", focusColors[0], focusColors[1], 3);
    expect(externalRequests, "Guide focus checks must stay local").toEqual([]);
  });
});

test.describe("public Bazaar resources", () => {
  for (const resource of resourceRoutes) {
    test(`${resource.name} is served from the local app`, async ({ request, baseURL }) => {
      expect(baseURL).toBeTruthy();
      assertLocalOrigin(baseURL!);

      const response = await request.get(resource.path, { maxRetries: 3, timeout: 20_000 });
      assertLocalOrigin(response.url());
      expect(new URL(response.url()).pathname).toBe(resource.path);
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toMatch(resource.contentType);

      if (resource.path === "/favicon.ico") {
        const headers = response.headers();
        const cacheControl = headers["cache-control"];
        expect(cacheControl, "favicon should publish an explicit cache policy").toBeTruthy();
        expect(cacheControl).toMatch(/\bpublic\b/i);
        expect(cacheControl).not.toMatch(/\b(?:no-store|private)\b/i);
        const maxAge = cacheControl?.match(/\bmax-age=(\d+)\b/i)?.[1];
        expect(maxAge, "favicon cache policy should publish a numeric max-age").toBeTruthy();
        expect(Number(maxAge)).toBeGreaterThanOrEqual(0);
        expect(
          headers.etag ?? headers["last-modified"],
          "favicon should publish an ETag or Last-Modified validator",
        ).toBeTruthy();

        const body = await response.body();
        expect([...body.subarray(0, 4)]).toEqual([0, 0, 1, 0]);
        expect(body.byteLength).toBeGreaterThan(1_024);
      } else {
        const body = await response.text();
        resource.validate(body);
      }
    });
  }
});
