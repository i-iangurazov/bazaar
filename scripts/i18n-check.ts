import { promises as fs } from "node:fs";
import path from "node:path";

const PROJECT_ROOT = process.cwd();
const SRC_ROOT = path.join(PROJECT_ROOT, "src");
const UI_ROOTS = [path.join(SRC_ROOT, "app"), path.join(SRC_ROOT, "components")];
const LOCALES = ["ru", "kg", "en"] as const;
const EXTRA_KEYS = [
  "purchaseOrders.status.draft",
  "purchaseOrders.status.submitted",
  "purchaseOrders.status.approved",
  "purchaseOrders.status.received",
  "purchaseOrders.status.cancelled",
  "inventory.movementType.receive",
  "inventory.movementType.sale",
  "inventory.movementType.adjustment",
  "inventory.movementType.transferIn",
  "inventory.movementType.transferOut",
  "common.statuses.success",
  "common.statuses.warning",
  "common.statuses.pending",
  "common.statuses.danger",
];

type Messages = Record<string, unknown>;

const readJson = async (filePath: string): Promise<Messages> => {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as Messages;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const flattenKeys = (obj: Messages, prefix = ""): string[] => {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (isObject(value)) {
      keys.push(...flattenKeys(value, next));
    } else {
      keys.push(next);
    }
  }
  return keys;
};

const collectFiles = async (dir: string): Promise<string[]> => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
      files.push(fullPath);
    }
  }

  return files;
};

const extractKeysFromFile = (content: string) => {
  const namespaces = new Map<string, string>();
  const useRegex =
    /(const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*["'`]([^"'`]+)["'`]\s*\)/g;
  let match: RegExpExecArray | null;

  while ((match = useRegex.exec(content))) {
    const variable = match[2];
    const namespace = match[3];
    namespaces.set(variable, namespace);
  }

  const keys = new Set<string>();

  for (const [variable, namespace] of namespaces) {
    const keyRegex = new RegExp(`\\b${variable}\\(\\s*["']([^"']+)["']`, "g");
    let keyMatch: RegExpExecArray | null;
    while ((keyMatch = keyRegex.exec(content))) {
      const key = keyMatch[1];
      keys.add(`${namespace}.${key}`);
    }
  }

  return keys;
};

type HardcodedMatch = {
  file: string;
  line: number;
  snippet: string;
  kind: string;
};

const getLineNumber = (content: string, index: number) =>
  content.slice(0, index).split("\n").length;

const findHardcodedStrings = (content: string, file: string): HardcodedMatch[] => {
  const matches: HardcodedMatch[] = [];
  const patterns: { kind: string; regex: RegExp }[] = [
    { kind: "toast", regex: /\btoast\s*\(\s*["'`]([^"'`]+)["'`]\s*[,)]/g },
    {
      kind: "attr",
      regex: /\b(title|aria-label|placeholder)\s*=\s*["'`]([^"'`]+)["'`]/g,
    },
    {
      kind: "attr",
      regex: /\b(title|aria-label|placeholder)\s*=\s*\{\s*["'`]([^"'`]+)["'`]\s*\}/g,
    },
  ];

  patterns.forEach(({ kind, regex }) => {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content))) {
      const snippet = match[0].trim();
      matches.push({
        file,
        line: getLineNumber(content, match.index),
        snippet,
        kind,
      });
    }
  });

  const textRegex = />[^<{][^<>{}]*[A-Za-zА-Яа-я][^<>{}]*<\//g;
  content.split("\n").forEach((line, index) => {
    if (!line.includes(">") || !line.includes("<")) {
      return;
    }
    textRegex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = textRegex.exec(line))) {
      matches.push({
        file,
        line: index + 1,
        snippet: match[0].trim(),
        kind: "text",
      });
    }
  });

  return matches;
};

const isUiFile = (file: string) =>
  file.endsWith(".tsx") && UI_ROOTS.some((root) => file.startsWith(root));

const main = async () => {
  const localeMessages = await Promise.all(
    LOCALES.map((locale) => readJson(path.join(PROJECT_ROOT, "messages", `${locale}.json`))),
  );
  const messageMaps = Object.fromEntries(
    LOCALES.map((locale, index) => [locale, new Set(flattenKeys(localeMessages[index]))]),
  ) as Record<(typeof LOCALES)[number], Set<string>>;

  const files = await collectFiles(SRC_ROOT);
  const usedKeys = new Set<string>();
  const hardcodedMatches: HardcodedMatch[] = [];

  for (const file of files) {
    const content = await fs.readFile(file, "utf8");
    extractKeysFromFile(content).forEach((key) => usedKeys.add(key));
    if (isUiFile(file)) {
      hardcodedMatches.push(...findHardcodedStrings(content, file));
    }
  }

  EXTRA_KEYS.forEach((key) => usedKeys.add(key));

  const missingByLocale: Record<string, string[]> = {};

  for (const locale of LOCALES) {
    const missing = Array.from(usedKeys).filter((key) => !messageMaps[locale].has(key));
    if (missing.length) {
      missingByLocale[locale] = missing.sort();
    }
  }

  if (Object.keys(missingByLocale).length) {
    for (const [locale, keys] of Object.entries(missingByLocale)) {
      console.error(`Missing ${locale} keys:`);
      for (const key of keys) {
        console.error(`  - ${key}`);
      }
    }
    process.exit(1);
  }

  if (hardcodedMatches.length) {
    console.error("Hardcoded UI strings detected:");
    hardcodedMatches.forEach((match) => {
      const relative = path.relative(PROJECT_ROOT, match.file);
      console.error(`  - ${relative}:${match.line} [${match.kind}] ${match.snippet}`);
    });
    process.exit(1);
  }

  console.log("i18n:check passed");
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
