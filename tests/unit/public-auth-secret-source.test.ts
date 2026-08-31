import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import en from "../../messages/en.json";
import kg from "../../messages/kg.json";
import ru from "../../messages/ru.json";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const readRepositoryFile = (path: string) => readFileSync(join(repositoryRoot, path), "utf8");
const clientTextExtensions = new Set([".css", ".html", ".js", ".json", ".md", ".ts", ".tsx"]);

const readClientBuildInputs = (relativePath: string): string[] => {
  const absolutePath = join(repositoryRoot, relativePath);
  return readdirSync(absolutePath, { withFileTypes: true }).flatMap((entry) => {
    const childPath = join(relativePath, entry.name);
    if (entry.isDirectory()) {
      return readClientBuildInputs(childPath);
    }
    return clientTextExtensions.has(extname(entry.name)) ? [readRepositoryFile(childPath)] : [];
  });
};

const roleBasedDefaultPattern = /\b(?:admin|manager|staff|owner)[0-9]{3,}[!@#$%^&*]/i;
const displayedCredentialPairPattern =
  /[\w.+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\s*(?:\/|\||:)\s*\S{8,}/i;

describe("public authentication copy", () => {
  it("does not ship demo-account credentials in locale payloads", () => {
    for (const messages of [en, ru, kg]) {
      const auth = messages.auth as Record<string, unknown>;
      expect(auth).not.toHaveProperty("demoAccounts");
      expect(JSON.stringify(auth)).not.toMatch(/(?:password|парол|сырсөз)\s*[:=]\s*\S+/i);
      expect(JSON.stringify(auth)).not.toMatch(/@example\.com\s*\([^)]{4,}\)/i);
    }
  });

  it("keeps credential defaults out of seed source and public setup files", () => {
    const readme = readRepositoryFile("README.md");
    const environmentExample = readRepositoryFile(".env.example");
    const seedSource = [
      readRepositoryFile("prisma/seed.ts"),
      readRepositoryFile("prisma/seed-config.ts"),
    ].join("\n");

    expect(readme).not.toMatch(roleBasedDefaultPattern);
    expect(readme).not.toMatch(displayedCredentialPairPattern);
    expect(readme).not.toContain("SEED_RESET_PASSWORDS");
    expect(seedSource).not.toMatch(roleBasedDefaultPattern);
    expect(seedSource).not.toMatch(/password\s*:\s*["'`]/i);
    expect(seedSource).not.toMatch(/SEED_[A-Z_]+_PASSWORD[^\n]*(?:\|\||\?\?)/);

    const seedPasswordAssignments = [
      ...environmentExample.matchAll(/^(SEED_[A-Z_]+_PASSWORD)=(.*)$/gm),
    ];
    expect(seedPasswordAssignments.map((match) => match[1])).toEqual([
      "SEED_ADMIN_PASSWORD",
      "SEED_MANAGER_PASSWORD",
      "SEED_STAFF_PASSWORD",
      "SEED_PLATFORM_OWNER_PASSWORD",
    ]);
    for (const assignment of seedPasswordAssignments) {
      expect(assignment[2]?.trim()).toBe('""');
    }
  });

  it("does not ship seeded credential copy in client or public build inputs", () => {
    const buildInputs = ["messages", "public", "src/app", "src/components"].flatMap(
      readClientBuildInputs,
    );

    for (const source of buildInputs) {
      expect(source).not.toMatch(roleBasedDefaultPattern);
      expect(source).not.toMatch(displayedCredentialPairPattern);
    }
  });
});
