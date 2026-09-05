import assert from "node:assert/strict";
import { test } from "node:test";
import { parseExpectedSha, runPublicSmoke } from "./public-smoke.mjs";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

function fixture({ versions = [SHA_A], override } = {}) {
  let versionIndex = 0;
  let time = 0;
  const requests = [];
  const history = [];
  const fetchImpl = async (input, options) => {
    const url = new URL(input);
    requests.push({ url, options });
    assert.ok(["bazaar.kg", "www.bazaar.kg"].includes(url.hostname));
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "manual");
    assert.equal(options.credentials, "omit");
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.headers.Cookie, undefined);
    const replaced = override?.(url, requests);
    if (replaced) return replaced;
    if (url.pathname === "/api/version") return Response.json({ sha: versions[Math.min(versionIndex++, versions.length - 1)] }, { headers: { "Cache-Control": "no-store" } });
    if (url.hostname === "bazaar.kg") return new Response(null, { status: 308, headers: { location: "https://www.bazaar.kg/baam" } });
    if (url.pathname === "/login") return new Response("<html>Login</html>", { headers: { "Content-Type": "text/html" } });
    if (url.pathname === "/api/health") return Response.json({ status: "ok" });
    return new Response(null, { status: 307, headers: { location: `https://www.bazaar.kg/login?next=${encodeURIComponent(url.pathname)}`, "set-cookie": "ignored=anonymous" } });
  };
  const options = {
    fetchImpl, now: () => time, sleep: async ms => { time += ms; }, pollMs: 10, waitMs: 20,
    record: async result => { history.push(structuredClone(result)); },
  };
  return { options, requests, history };
}

test("checks only hardcoded public endpoints without credentials or redirect following", async () => {
  const mock = fixture();
  const result = await runPublicSmoke({ ...mock.options, expectedSha: SHA_A, requireExpectedSha: true });
  assert.equal(result.status, "passed");
  assert.equal(result.checks.length, 6);
  assert.ok(result.checks.every(check => check.pass));
  assert.equal(mock.requests.length, 7);
  assert.match(result.scope, /does not certify database/);
});

test("waits through the old alias SHA before checking the newly promoted deployment", async () => {
  const mock = fixture({ versions: [SHA_B, SHA_A, SHA_A] });
  const result = await runPublicSmoke({ ...mock.options, expectedSha: SHA_A });
  assert.equal(result.status, "passed");
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].releaseReady, false);
  assert.equal(result.attempts[1].elapsedMs, 10);
  assert.equal(mock.requests[0].url.pathname, "/api/version");
  assert.equal(mock.requests[1].url.pathname, "/api/version");
});

test("fails within the bound if the requested deployment never reaches the public alias", async () => {
  const mock = fixture({ versions: [SHA_B] });
  const result = await runPublicSmoke({ ...mock.options, expectedSha: SHA_A });
  assert.equal(result.status, "failed");
  assert.equal(result.attempts.at(-1).elapsedMs, 20);
  assert.ok(mock.requests.every(request => request.url.pathname === "/api/version"));
});

test("requires the same exact SHA after the route probes", async () => {
  const mock = fixture({ versions: [SHA_A, SHA_B] });
  const result = await runPublicSmoke({ ...mock.options, expectedSha: SHA_A });
  assert.equal(result.status, "failed");
  assert.equal(result.checks.at(-1).pass, false);
});

test("never follows an external, downgraded or incorrect-path apex redirect", async () => {
  for (const location of ["https://untrusted.example/baam", "http://www.bazaar.kg/baam", "https://www.bazaar.kg/"]) {
    const mock = fixture({ override: url => url.hostname === "bazaar.kg" ? new Response(null, { status: 308, headers: { location } }) : null });
    const result = await runPublicSmoke(mock.options);
    assert.equal(result.status, "failed");
    assert.equal(result.checks[0].pass, false);
    assert.ok(mock.requests.every(request => ["bazaar.kg", "www.bazaar.kg"].includes(request.url.hostname)));
  }
});

test("rejects an anonymous200 response or a login redirect that loses the intended path", async () => {
  for (const response of [() => new Response("private page", { status: 200 }), () => new Response(null, { status: 307, headers: { location: "/login?next=/dashboard" } })]) {
    const mock = fixture({ override: url => url.hostname === "www.bazaar.kg" && url.pathname === "/baam" ? response() : null });
    assert.equal((await runPublicSmoke(mock.options)).status, "failed");
  }
});

test("checks only the anonymous health envelope and does not retain internal service fields", async () => {
  const mock = fixture({ override: url => url.pathname === "/api/health" ? Response.json({ status: "ok", db: "up", internal: "not-public" }) : null });
  const result = await runPublicSmoke(mock.options);
  assert.equal(result.status, "failed");
  assert.equal(result.checks.find(check => check.name.includes("health")).pass, false);
  assert.ok(!JSON.stringify(result).includes("not-public"));
});

test("daily and manual runs accept a valid currently deployed release without an expected SHA", async () => {
  const mock = fixture({ versions: [SHA_B] });
  const result = await runPublicSmoke(mock.options);
  assert.equal(result.status, "passed");
  assert.equal(result.expectedSha, null);
  assert.equal(result.observedSha, SHA_B);
});

test("rejects unsafe/missing required event data before any network access", async () => {
  for (const value of ["main", "$(touch /tmp/unsafe)", SHA_A + "\n", "", undefined]) {
    const mock = fixture();
    await assert.rejects(() => runPublicSmoke({ ...mock.options, expectedSha: value, requireExpectedSha: true }), /40 hexadecimal/);
    assert.equal(mock.requests.length, 0);
  }
  assert.equal(parseExpectedSha(SHA_A.toUpperCase()), SHA_A);
});

test("requires a sanitized release value and no-store cache policy", async () => {
  for (const response of [
    () => Response.json({ sha: null }, { headers: { "Cache-Control": "no-store" } }),
    () => Response.json({ sha: SHA_A }),
    () => Response.json({ sha: SHA_A, secret: "not-allowed" }, { headers: { "Cache-Control": "no-store" } }),
  ]) {
    const mock = fixture({ override: url => url.pathname === "/api/version" ? response() : null });
    const result = await runPublicSmoke(mock.options);
    assert.equal(result.status, "failed");
    assert.equal(result.observedSha, null);
    assert.ok(!JSON.stringify(result).includes("not-allowed"));
  }
});

test("does not permit unbounded waits", async () => {
  const mock = fixture();
  await assert.rejects(() => runPublicSmoke({ ...mock.options, waitMs: 31 * 60_000 }), /bounded/);
  assert.equal(mock.requests.length, 0);
});
