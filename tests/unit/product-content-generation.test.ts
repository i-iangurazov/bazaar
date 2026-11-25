import { afterEach, expect, it, vi } from "vitest";

import { generateProductContent } from "@/server/services/productContentGeneration";

vi.mock("@/server/services/aiPrivacy", () => ({ assertAiConsent: vi.fn().mockResolvedValue(undefined) }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("uses one image request and keeps the values of separate attributes of the same kind", async () => {
  vi.stubEnv("AI_PROVIDER", "openai");
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  const description = "This bottle combines a green body with a silver cap. Its narrow shape designs a compact bottle for buyers who want an everyday accessory. The simple finish makes it easy to recognize the two parts.";
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({
    status: "completed",
    output_text: JSON.stringify({ description, specs: {
      body_color: "зеленый",
      cap_color: "серебристый",
      brand: "Invented brand",
    } }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  const prepareImage = vi.fn(async () => ({ dataUrl: "data:image/png;base64,AAAA", sourceBytes: 3, payloadBytes: 3 }));

  const result = await generateProductContent({
    product: { name: "Bottle", supplier: { name: "Known supplier" } },
    locale: "en",
    imageUrls: ["https://example.test/bottle.png"],
    prepareImage,
    requestedSpecs: [
      { key: "body_color", kind: "color", labelRu: "Цвет корпуса", options: ["Зелёный"] },
      { key: "cap_color", kind: "color", labelRu: "Цвет крышки", options: ["Серебристый."] },
      { key: "brand", kind: "manufacturer", labelRu: "Производитель" },
    ],
  });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(prepareImage).toHaveBeenCalledTimes(1);
  expect(result.description).toMatchObject({ status: "generated", value: description });
  expect(result.specs.values).toMatchObject([
    { key: "body_color", value: "Зелёный", source: "image" },
    { key: "cap_color", value: "Серебристый.", source: "image" },
    { key: "brand", value: "Known supplier", source: "product" },
  ]);
  const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
  expect(request.text.format.schema.properties.specs.required).toEqual(["body_color", "cap_color"]);
  expect(request.input[0].content[0].text).toContain("Write the description field in English.");
});
