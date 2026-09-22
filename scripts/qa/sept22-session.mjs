import { chromium } from "playwright";

// Only the disposable localhost fixture. Never accepts a production URL or credentials.
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext();
  const base = "http://localhost:3100";
  const csrf = await (await context.request.get(`${base}/api/auth/csrf`)).json();
  const response = await context.request.post(`${base}/api/auth/callback/credentials`, {
    form: {
      csrfToken: csrf.csrfToken,
      email: "admin@test.local",
      password: "sept22-local-only",
      callbackUrl: base,
      json: "true",
    },
  });
  if (!response.ok()) throw new Error("Local fixture login failed");
  const session = await (await context.request.get(`${base}/api/auth/session`)).json();
  if (!session.user) throw new Error("Local fixture session missing");
  await context.storageState({ path: "/private/tmp/bazaar-qa-session.json" });
} finally {
  await browser.close();
}
