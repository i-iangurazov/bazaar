import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const WWW = "https://www.bazaar.kg";
const APEX = "https://bazaar.kg";
const SHA = /^[a-f0-9]{40}$/i;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const MAX_WAIT_MS = 30 * 60_000;

export function parseExpectedSha(value, required = false) {
  if (!required && (value === undefined || value === "")) return null;
  if (typeof value !== "string" || !SHA.test(value)) throw new Error("Expected deployment SHA must be exactly 40 hexadecimal characters");
  return value.toLowerCase();
}

async function smallJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing JSON body");
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 16_384) throw new Error("JSON body exceeds smoke limit");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function redirectMatches(response, from, path, next) {
  if (!REDIRECTS.has(response.status)) return false;
  try {
    const target = new URL(response.headers.get("location") ?? "", from);
    return target.origin === WWW && !target.username && !target.password && target.pathname === path &&
      !target.hash && (next === undefined ? !target.search : target.searchParams.get("next") === next && [...target.searchParams.keys()].length === 1);
  } catch { return false; }
}

/** Only fixed public URLs are fetched. Event environment_url/target_url are never accepted. */
export async function runPublicSmoke({
  expectedSha: rawSha,
  requireExpectedSha = false,
  waitMs,
  pollMs = 30_000,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  sleep = ms => new Promise(done => setTimeout(done, ms)),
  record = async () => {},
} = {}) {
  const expectedSha = parseExpectedSha(rawSha, requireExpectedSha);
  const budget = waitMs ?? (expectedSha ? 28 * 60_000 : 3 * 60_000);
  if (!Number.isInteger(budget) || budget < 0 || budget > MAX_WAIT_MS || !Number.isInteger(pollMs) || pollMs < 1 || pollMs > 60_000) {
    throw new Error("Invalid bounded smoke timing configuration");
  }
  const started = now();
  const deadline = started + budget;
  const result = {
    status: "running", expectedSha, observedSha: null, startedAt: new Date(started).toISOString(),
    attempts: [], checks: [],
    scope: "Anonymous HTTP release smoke only; public health does not certify database, Redis, providers or authenticated workflows.",
  };
  const request = async path => {
    const url = path.startsWith(APEX + "/") ? path : WWW + path;
    // Defense in depth even if a future caller accidentally supplies a URL.
    if (![WWW, APEX].includes(new URL(url).origin)) throw new Error("Unapproved smoke host");
    return fetchImpl(url, {
      method: "GET", redirect: "manual", credentials: "omit", cache: "no-store",
      headers: { Accept: "application/json, text/html", "User-Agent": "Bazaar-Public-Release-Smoke/1.0" },
      signal: AbortSignal.timeout(Math.max(1, Math.min(15_000, deadline - now()))),
    });
  };
  const version = async () => {
    try {
      const response = await request("/api/version");
      const body = await smallJson(response);
      const valid = response.status === 200 && body && Object.keys(body).length === 1 &&
        typeof body.sha === "string" && SHA.test(body.sha) && /(?:^|,)\s*no-store\b/i.test(response.headers.get("cache-control") ?? "");
      return { pass: Boolean(valid), status: response.status, sha: valid ? body.sha.toLowerCase() : null };
    } catch { return { pass: false, status: null, sha: null }; }
  };
  const probe = async (name, path, accept, note) => {
    let response;
    try {
      response = await request(path);
      const pass = Boolean(await accept(response));
      return { name, pass, status: response.status, note };
    } catch { return { name, pass: false, status: null, note }; }
    finally { if (response?.body && !response.bodyUsed) await response.body.cancel().catch(() => {}); }
  };
  do {
    const release = await version();
    result.observedSha = release.sha;
    const releaseReady = release.pass && (!expectedSha || release.sha === expectedSha);
    const attempt = { elapsedMs: now() - started, versionStatus: release.status, observedSha: release.sha, releaseReady };
    result.attempts.push(attempt);
    if (releaseReady) {
      result.checks = await Promise.all([
        probe("apex preserves BAAM path", APEX + "/baam", response => redirectMatches(response, APEX + "/baam", "/baam"), "Redirect must target https://www.bazaar.kg/baam; never followed."),
        probe("login responds with HTML", "/login", response => response.status === 200 && /text\/html/i.test(response.headers.get("content-type") ?? ""), "HTTP200 HTML only; not a browser hydration or login test."),
        probe("anonymous BAAM redirects to login", "/baam", response => redirectMatches(response, WWW + "/baam", "/login", "/baam"), "No cookie or credentials sent."),
        probe("anonymous analytics redirects to login", "/reports/analytics", response => redirectMatches(response, WWW + "/reports/analytics", "/login", "/reports/analytics"), "No report data or operation requested after the redirect."),
        probe("public health responds ok", "/api/health", async response => {
          const body = await smallJson(response);
          return response.status === 200 && body?.status === "ok" && Object.keys(body).length === 1;
        }, "Anonymous public health only; does not check database, Redis or providers."),
      ]);
      const finalVersion = await version();
      result.checks.push({ name: "release SHA remains exact during smoke", pass: finalVersion.pass && finalVersion.sha === release.sha && (!expectedSha || finalVersion.sha === expectedSha), status: finalVersion.status, note: "Public version must match before and after route checks and bypass caches." });
      if (result.checks.every(check => check.pass)) {
        result.status = "passed";
        result.completedAt = new Date(now()).toISOString();
        await record(result);
        return result;
      }
    }
    await record(result);
    const remaining = deadline - now();
    if (remaining <= 0) break;
    await sleep(Math.min(pollMs, remaining));
  } while (now() <= deadline);
  result.status = "failed";
  result.completedAt = new Date(now()).toISOString();
  await record(result);
  return result;
}

async function main() {
  const directory = resolve(process.env.SMOKE_OUTPUT_DIR || "artifacts/production-smoke");
  await mkdir(directory, { recursive: true });
  const save = async result => {
    await writeFile(resolve(directory, "public-smoke.json"), JSON.stringify(result, null, 2) + "\n");
    console.log(JSON.stringify({ status: result.status, expectedSha: result.expectedSha, observedSha: result.observedSha, attempt: result.attempts?.length ?? 0, checks: result.checks }));
  };
  try {
    const result = await runPublicSmoke({
      expectedSha: process.env.SMOKE_EXPECTED_SHA,
      requireExpectedSha: process.env.SMOKE_REQUIRE_EXPECTED_SHA === "1",
      record: save,
    });
    if (result.status !== "passed") process.exitCode = 1;
  } catch (error) {
    await save({ status: "failed", error: error instanceof Error ? error.message : "Smoke execution failed" });
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
