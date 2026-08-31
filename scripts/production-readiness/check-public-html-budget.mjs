const readArgument = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const baseUrl = new URL(readArgument("--base-url", "http://127.0.0.1:3000"));
const maxBytes = Number(readArgument("--max-bytes", "150000"));
const routes = ["/", "/help", "/help/pos/make-sale"];

if (!Number.isSafeInteger(maxBytes) || maxBytes < 10_000) {
  throw new Error("--max-bytes must be an integer of at least 10000");
}

let failed = false;
for (const route of routes) {
  const url = new URL(route, baseUrl);
  const response = await fetch(url, { redirect: "follow", cache: "no-store" });
  const bytes = (await response.arrayBuffer()).byteLength;
  const withinBudget = response.ok && bytes <= maxBytes;
  console.log(
    JSON.stringify({ route, status: response.status, bytes, maxBytes, withinBudget }),
  );
  failed ||= !withinBudget;
}

if (failed) process.exitCode = 1;
