import http from "node:http";
import https from "node:https";
import net from "node:net";

const loopbackHosts = new Set(["127.0.0.1", "::1", "[::1]", "::ffff:127.0.0.1", "localhost"]);

const assertLoopbackHost = (host, operation) => {
  const normalized = String(host || "localhost").toLowerCase();
  if (!loopbackHosts.has(normalized)) {
    const error = new Error(
      `Authenticated Playwright blocked non-loopback ${operation} connection to ${normalized}.`,
    );
    error.code = "E2E_EXTERNAL_NETWORK_BLOCKED";
    throw error;
  }
};

const hostFromHttpArguments = (args, protocol) => {
  const first = args[0];
  if (typeof first === "string" || first instanceof URL) {
    return new URL(first, `${protocol}//localhost`).hostname;
  }
  if (first && typeof first === "object") {
    const candidate = first.hostname || first.host || "localhost";
    return new URL(`${protocol}//${candidate}`).hostname;
  }
  return "localhost";
};

const guardHttpMethod = (original, protocol) =>
  function guardedHttpMethod(...args) {
    assertLoopbackHost(hostFromHttpArguments(args, protocol), protocol.replace(":", ""));
    return Reflect.apply(original, this, args);
  };

http.request = guardHttpMethod(http.request, "http:");
http.get = guardHttpMethod(http.get, "http:");
https.request = guardHttpMethod(https.request, "https:");
https.get = guardHttpMethod(https.get, "https:");

const hostFromNetArguments = (args) => {
  const first = args[0];
  if (typeof first === "string") return null; // Local Unix-domain socket path.
  if (typeof first === "object" && first !== null) {
    if (typeof first.path === "string" && !first.host) return null;
    return first.host || "localhost";
  }
  return typeof args[1] === "string" ? args[1] : "localhost";
};

const originalNetConnect = net.connect;
const originalNetCreateConnection = net.createConnection;
net.connect = function guardedNetConnect(...args) {
  const host = hostFromNetArguments(args);
  if (host) assertLoopbackHost(host, "TCP");
  return Reflect.apply(originalNetConnect, this, args);
};
net.createConnection = function guardedNetCreateConnection(...args) {
  const host = hostFromNetArguments(args);
  if (host) assertLoopbackHost(host, "TCP");
  return Reflect.apply(originalNetCreateConnection, this, args);
};

const originalFetch = globalThis.fetch;
if (originalFetch) {
  globalThis.fetch = async (input, init) => {
    const target = input instanceof Request ? input.url : String(input);
    const url = new URL(target);
    assertLoopbackHost(url.hostname, "fetch");
    return originalFetch(input, init);
  };
}
