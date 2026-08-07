import { NextResponse } from "next/server";

import { getLogger } from "@/server/logging";

const eventTypes = new Set(["guide_view", "search", "zero_result", "feedback"]);
const guideIdPattern = /^[a-z0-9-]+\/[a-z0-9-]+$/;

const sanitizeQuery = (value: unknown) => {
  if (typeof value !== "string") return undefined;
  return value
    .slice(0, 120)
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[email]")
    .replace(/(?:\+?\d[\s()-]*){8,}/g, "[number]")
    .replace(/\s+/g, " ")
    .trim();
};

const sanitizeSourceRoute = (value: unknown) => {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//"))
    return undefined;
  return value.split(/[?#]/)[0]?.slice(0, 120);
};

export const POST = async (request: Request) => {
  const raw = await request.text();
  if (raw.length > 2048) return NextResponse.json({ error: "payloadTooLarge" }, { status: 413 });

  let input: Record<string, unknown>;
  try {
    input = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalidBody" }, { status: 400 });
  }

  if (typeof input.type !== "string" || !eventTypes.has(input.type)) {
    return NextResponse.json({ error: "invalidEvent" }, { status: 400 });
  }

  const guideId =
    typeof input.guideId === "string" && guideIdPattern.test(input.guideId)
      ? input.guideId.slice(0, 100)
      : undefined;
  const query = sanitizeQuery(input.query);
  if ((input.type === "guide_view" || input.type === "feedback") && !guideId) {
    return NextResponse.json({ error: "invalidGuide" }, { status: 400 });
  }
  if ((input.type === "search" || input.type === "zero_result") && !query) {
    return NextResponse.json({ error: "invalidQuery" }, { status: 400 });
  }

  getLogger(request.headers.get("x-request-id") ?? undefined).info(
    {
      event: input.type,
      guideId,
      query,
      helpful: input.type === "feedback" ? input.helpful === true : undefined,
      sourceRoute: sanitizeSourceRoute(input.sourceRoute),
    },
    "bazaar guide event",
  );
  return new NextResponse(null, { status: 204 });
};
