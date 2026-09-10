import { afterEach, expect, it, vi } from "vitest";
import { formatDate, formatDateTime } from "@/lib/i18nFormat";
afterEach(() => vi.restoreAllMocks());
const instant = "2026-09-09T20:15:00Z";
it("keeps Kyrgyz dates numeric when browser ICU lacks Kyrgyz, including the Bishkek day boundary", () => {
  vi.spyOn(Intl.DateTimeFormat, "supportedLocalesOf").mockReturnValue([]);
  expect(formatDate(instant, "kg")).toBe("10.09.2026");
  expect(formatDateTime(instant, "ky")).toBe("10.09.2026, 02:15");
});
it("retains native Kyrgyz month names when supported", () => {
  expect(formatDate(instant, "kg")).toBe(
    new Intl.DateTimeFormat("ky-KG", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      timeZone: "Asia/Bishkek",
    }).format(new Date(instant)),
  );
});
it("preserves Russian and English formats even if Kyrgyz is unavailable", () => {
  vi.spyOn(Intl.DateTimeFormat, "supportedLocalesOf").mockReturnValue([]);
  expect(formatDate(instant, "ru")).toContain("сент.");
  expect(formatDate(instant, "en")).toContain("Sep");
});
