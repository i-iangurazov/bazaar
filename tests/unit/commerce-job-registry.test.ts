import { describe, expect, it } from "vitest";

import { listJobs } from "@/server/jobs";

describe("commerce job registry", () => {
  it("exposes every durable marketplace and AI worker to a fresh jobs runner", () => {
    expect(listJobs()).toEqual(
      expect.arrayContaining([
        "mmarket-export",
        "bakai-store-export",
        "bakai-store-api-sync",
        "o-market-export",
        "product-description-generation",
      ]),
    );
  });
});
