import { describe, expect, it } from "vitest";

import { formatOrderEmailDate } from "@/server/services/orderEmails";

describe("order email templates", () => {
  it("formats English transactional email dates with English month text", () => {
    const formatted = formatOrderEmailDate(new Date("2026-06-30T05:29:00.000Z"));

    expect(formatted).toContain("Jun");
    expect(formatted).not.toMatch(/[а-яё]/i);
  });
});
