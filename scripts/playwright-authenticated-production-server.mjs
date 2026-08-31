import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";

const host = "127.0.0.1";
const readLoopbackPort = (environmentName, fallback) => {
  const rawValue = process.env[environmentName];
  if (rawValue === undefined) return fallback;
  if (!/^\d+$/.test(rawValue)) {
    throw new Error(`${environmentName} must be an integer TCP port.`);
  }

  const port = Number(rawValue);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${environmentName} must be between 1 and 65535.`);
  }
  return port;
};

const publicPort = readLoopbackPort("AUTHENTICATED_E2E_PUBLIC_PORT", 4174);
const internalPort = readLoopbackPort("AUTHENTICATED_E2E_INTERNAL_PORT", 4175);
if (publicPort === internalPort) {
  throw new Error("Authenticated E2E public and internal ports must be different.");
}

const tlsDirectory = path.resolve("test-results/authenticated/.tls");
const keyPath = path.join(tlsDirectory, `loopback-${publicPort}-key.pem`);
const certificatePath = path.join(tlsDirectory, `loopback-${publicPort}-certificate.pem`);
const publicOrigin = `https://${host}:${publicPort}`;
const internalRedirectHosts = new Set([host, "localhost", "::1", "[::1]"]);

const standardHopByHopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const withoutHopByHopHeaders = (headers) => {
  const connectionTokens = String(headers.connection ?? "")
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  const excludedHeaders = new Set([...standardHopByHopHeaders, ...connectionTokens]);

  return Object.fromEntries(
    Object.entries(headers).filter(([name, value]) => {
      return value !== undefined && !excludedHeaders.has(name.toLowerCase());
    }),
  );
};

const rewriteInternalLocation = (value) => {
  const rewrite = (location) => {
    let target;
    try {
      target = new URL(location);
    } catch {
      return location;
    }
    if (
      (target.protocol !== "http:" && target.protocol !== "https:") ||
      !internalRedirectHosts.has(target.hostname.toLowerCase()) ||
      target.port !== String(internalPort)
    ) {
      return location;
    }
    return new URL(`${target.pathname}${target.search}${target.hash}`, publicOrigin).toString();
  };

  return Array.isArray(value) ? value.map(rewrite) : rewrite(value);
};

mkdirSync(tlsDirectory, { recursive: true });
execFileSync(
  "/usr/bin/openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    keyPath,
    "-out",
    certificatePath,
    "-days",
    "1",
    "-subj",
    "/CN=127.0.0.1",
    "-addext",
    "subjectAltName=IP:127.0.0.1",
  ],
  { stdio: "ignore" },
);

const nextServer = spawn(
  "pnpm",
  ["exec", "next", "start", "--hostname", host, "--port", String(internalPort)],
  {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  },
);

const proxy = https.createServer(
  {
    key: readFileSync(keyPath),
    cert: readFileSync(certificatePath),
  },
  (request, response) => {
    const requestHeaders = withoutHopByHopHeaders(request.headers);
    const forwarded = http.request(
      {
        agent: false,
        hostname: host,
        port: internalPort,
        method: request.method,
        path: request.url,
        headers: {
          ...requestHeaders,
          host: `${host}:${publicPort}`,
          "x-forwarded-host": `${host}:${publicPort}`,
          "x-forwarded-proto": "https",
        },
      },
      (upstreamResponse) => {
        const responseHeaders = withoutHopByHopHeaders(upstreamResponse.headers);
        if (responseHeaders.location) {
          responseHeaders.location = rewriteInternalLocation(responseHeaders.location);
        }
        response.writeHead(upstreamResponse.statusCode ?? 502, responseHeaders);
        upstreamResponse.pipe(response);
      },
    );

    const abortForwardedRequest = () => {
      if (!forwarded.destroyed) forwarded.destroy();
    };
    request.once("aborted", abortForwardedRequest);
    request.once("error", abortForwardedRequest);
    response.once("error", abortForwardedRequest);
    response.once("close", () => {
      if (!response.writableFinished) abortForwardedRequest();
    });

    forwarded.on("error", () => {
      if (response.destroyed) return;
      if (!response.headersSent) {
        response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      }
      response.end("Authenticated E2E production server is starting.");
    });
    request.pipe(forwarded);
  },
);

let stopping = false;
const stop = (signal) => {
  if (stopping) return;
  stopping = true;
  proxy.close();
  proxy.closeAllConnections();
  if (nextServer.exitCode === null && nextServer.signalCode === null) {
    nextServer.kill(signal);
  }
};

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => stop(signal));
}

nextServer.once("error", (error) => {
  console.error(`[authenticated-e2e] Unable to start Next.js: ${error.message}`);
  process.exitCode = 1;
  proxy.close();
  proxy.closeAllConnections();
});

nextServer.once("exit", (code, signal) => {
  if (!stopping) {
    console.error(
      `[authenticated-e2e] Next.js exited before the HTTPS proxy (${signal ?? code ?? "unknown"}).`,
    );
    process.exitCode = code ?? 1;
    proxy.close();
    proxy.closeAllConnections();
  }
});

proxy.once("error", (error) => {
  console.error(`[authenticated-e2e] Unable to start the HTTPS proxy: ${error.message}`);
  process.exitCode = 1;
  if (nextServer.exitCode === null && nextServer.signalCode === null) {
    nextServer.kill("SIGTERM");
  }
});

proxy.listen(publicPort, host, () => {
  console.info(`[authenticated-e2e] Secure loopback proxy ready at https://${host}:${publicPort}.`);
});
