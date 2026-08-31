import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFile(path.join(process.cwd(), relativePath), "utf8");

const hslToRgb = (hue: number, saturation: number, lightness: number) => {
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const match =
    hue < 60
      ? [chroma, x, 0]
      : hue < 120
        ? [x, chroma, 0]
        : hue < 180
          ? [0, chroma, x]
          : hue < 240
            ? [0, x, chroma]
            : hue < 300
              ? [x, 0, chroma]
              : [chroma, 0, x];
  const offset = l - chroma / 2;
  return match.map((channel) => channel + offset);
};

const luminance = (rgb: number[]) =>
  rgb
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);

const contrastRatio = (left: number[], right: number[]) => {
  const [lighter, darker] = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
};

const blendOverWhite = (rgb: number[], alpha: number) =>
  rgb.map((channel) => channel * alpha + (1 - alpha));

describe("public auth, metadata, and accessibility contracts", () => {
  it("gates reset and registration forms until a server token check succeeds", async () => {
    const resetPage = await readSource("src/app/reset/[token]/page.tsx");
    const resetForm = await readSource("src/app/reset/[token]/reset-token-form.tsx");
    const registrationLayout = await readSource("src/app/register-business/[token]/layout.tsx");
    const publicAuthRouter = await readSource("src/server/trpc/routers/publicAuth.ts");

    expect(resetPage).toContain("await getAuthTokenStatus");
    expect(resetPage).toContain('status === "valid"');
    expect(resetPage).toContain("<ResetTokenForm");
    expect(resetForm).toContain("resetPassword.useMutation");
    expect(registrationLayout).toContain("await getAuthTokenStatus");
    expect(registrationLayout).toContain('status === "valid"');
    expect(publicAuthRouter).toContain("await prisma.$transaction");
    expect(publicAuthRouter).toContain("const token = await consumeAuthToken(");
    expect(publicAuthRouter).toContain('purpose: "PASSWORD_RESET"');
    expect(publicAuthRouter).toContain("tx,\n          );");
    expect(publicAuthRouter).toContain("registerBusinessFromToken");
  });

  it("associates public form labels and errors with their controls", async () => {
    const signup = await readSource("src/app/signup/page.tsx");
    const invite = await readSource("src/app/invite/page.tsx");
    const inviteToken = await readSource("src/app/invite/[token]/page.tsx");
    const registration = await readSource("src/app/register-business/[token]/page.tsx");

    for (const source of [signup, invite, inviteToken, registration]) {
      expect(source).toContain("aria-invalid=");
      expect(source).toContain("aria-describedby=");
      expect(source).toContain('role="alert"');
      expect(source).toContain('aria-live="polite"');
    }
    expect(signup).toContain('htmlFor="signup-preferred-locale"');
    expect(signup).toContain('id="signup-preferred-locale"');
    expect(inviteToken).toContain('htmlFor="invite-preferred-locale"');
    expect(registration).toContain('htmlFor="register-legal-entity-type"');
    expect(registration).toContain('id="register-legal-entity-type"');
  });

  it("announces terminal invalid-token states and keeps a keyboard recovery path", async () => {
    const inviteToken = await readSource("src/app/invite/[token]/page.tsx");
    const verificationToken = await readSource("src/app/verify/[token]/page.tsx");

    for (const source of [inviteToken, verificationToken]) {
      expect(source).toContain('role="status"');
      expect(source).toContain('aria-live="polite"');
    }
    expect(inviteToken).toContain('href="/invite"');
    expect(inviteToken).toContain('href="/login"');
    expect(verificationToken).toContain("router.push(nextPath)");
  });

  it("maps the internal Kyrgyz locale to a valid BCP 47 document language", async () => {
    const rootLayout = await readSource("src/app/layout.tsx");

    expect(rootLayout).toContain('import { defaultLocale, toIntlLocale } from "@/lib/locales"');
    expect(rootLayout).toContain("<html lang={toIntlLocale(locale)}");
  });

  it("provides localized route metadata and a primary H1 on every audited auth route", async () => {
    for (const route of ["login", "signup", "invite", "reset", "verify", "register-business"]) {
      const layout = await readSource(`src/app/${route}/layout.tsx`);
      expect(layout).toContain("generateMetadata");
      expect(layout).toContain("getTranslations");
    }

    const headingSources = await Promise.all([
      readSource("src/app/login/page.tsx"),
      readSource("src/app/signup/page.tsx"),
      readSource("src/app/invite/page.tsx"),
      readSource("src/app/invite/[token]/page.tsx"),
      readSource("src/app/reset/page.tsx"),
      readSource("src/app/reset/[token]/reset-token-form.tsx"),
      readSource("src/app/verify/[token]/page.tsx"),
      readSource("src/app/register-business/[token]/page.tsx"),
    ]);
    for (const source of headingSources) {
      expect(source).toContain('CardTitle as="h1"');
    }
  });

  it("redirects an authenticated login-page request to its role-appropriate home", async () => {
    const loginPage = await readSource("src/app/login/page.tsx");

    expect(loginPage).toContain("getServerAuthToken");
    expect(loginPage).toContain("getRoleHomePath");
    expect(loginPage).toContain("token.isPlatformOwner");
    expect(loginPage).toContain("redirect(");
    expect(loginPage).toContain('"/platform"');
  });

  it("uses a real localized document 404 for missing catalog slugs", async () => {
    const page = await readSource("src/app/c/[slug]/page.tsx");
    const layout = await readSource("src/app/c/[slug]/layout.tsx");
    const missing = await readSource("src/app/c/[slug]/not-found.tsx");

    expect(page).toContain("await getPublicCatalogRouteData");
    expect(page).toContain("notFound();");
    expect(layout).toContain('title: t("notFoundTitle")');
    expect(layout).toContain("index: false");
    expect(missing).toContain("<h1");
    expect(missing).toContain('getTranslations("catalogPublic")');
  });

  it("keeps muted public text above WCAG AA on the darkest light-mode surface", async () => {
    const css = await readSource("src/app/globals.css");
    const muted = css.match(/--muted-foreground:\s*(\d+)\s+(\d+)%\s+(\d+)%/)?.slice(1);
    const secondary = css.match(/--secondary:\s*(\d+)\s+(\d+)%\s+(\d+)%/)?.slice(1);
    const primary = css.match(/--primary:\s*(\d+)\s+(\d+)%\s+(\d+)%/)?.slice(1);
    expect(muted).toBeTruthy();
    expect(secondary).toBeTruthy();
    expect(primary).toBeTruthy();
    const mutedRatio = contrastRatio(
      hslToRgb(...(muted?.map(Number) as [number, number, number])),
      hslToRgb(...(secondary?.map(Number) as [number, number, number])),
    );
    const primaryHoverRatio = contrastRatio(
      blendOverWhite(hslToRgb(...(primary?.map(Number) as [number, number, number])), 0.9),
      [1, 1, 1],
    );
    expect(mutedRatio).toBeGreaterThanOrEqual(4.5);
    expect(primaryHoverRatio).toBeGreaterThanOrEqual(4.5);

    const publicAuthSources = await Promise.all([
      readSource("src/app/login/page.tsx"),
      readSource("src/app/signup/page.tsx"),
      readSource("src/app/invite/[token]/page.tsx"),
      readSource("src/app/reset/page.tsx"),
      readSource("src/app/reset/[token]/reset-token-form.tsx"),
      readSource("src/app/register-business/[token]/page.tsx"),
      readSource("src/components/login-form.tsx"),
    ]);
    expect(publicAuthSources.join("\n")).not.toContain("hover:text-primary/80");
  });
});
