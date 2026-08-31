import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  pickClientMessageNamespaces,
  rootClientMessageNamespaces,
} from "@/lib/clientMessages";

describe("public client-message payload", () => {
  it("keeps only globally mounted component namespaces in the root payload", async () => {
    const messages = JSON.parse(
      await readFile(path.join(process.cwd(), "messages/ru.json"), "utf8"),
    ) as Record<string, unknown>;
    const selected = pickClientMessageNamespaces(messages, rootClientMessageNamespaces);

    expect(Object.keys(selected).sort()).toEqual(["common", "nativeApp", "pwaStatus"]);
    expect(Buffer.byteLength(JSON.stringify(selected))).toBeLessThan(10_000);
    expect(Buffer.byteLength(JSON.stringify(selected))).toBeLessThan(
      Buffer.byteLength(JSON.stringify(messages)) / 20,
    );
  });

  it("wraps authenticated and translated public routes with scoped message providers", async () => {
    const files = await Promise.all(
      [
        "src/app/(app)/layout.tsx",
        "src/app/login/layout.tsx",
        "src/app/signup/layout.tsx",
        "src/app/invite/layout.tsx",
        "src/app/reset/layout.tsx",
        "src/app/verify/layout.tsx",
        "src/app/register-business/layout.tsx",
        "src/app/c/[slug]/layout.tsx",
      ].map((file) => readFile(path.join(process.cwd(), file), "utf8")),
    );

    for (const source of files) expect(source).toContain("RouteIntlProvider");
  });
});
