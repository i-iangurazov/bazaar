import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { baamTestEnvironment, assertBaamTestDatabase } from "./environment";
const require = createRequire(import.meta.url);
createRequire(require.resolve("next/package.json"))("@next/env").loadEnvConfig(process.cwd(), true);
const key = process.env.OPENAI_API_KEY;
if (!key) throw new Error("Configured provider key is unavailable");
Object.assign(process.env, baamTestEnvironment(), { OPENAI_API_KEY: key });
assertBaamTestDatabase();
const { prisma } = await import("../../src/server/db/prisma");
const { getLogger } = await import("../../src/server/logging");
const { createBaamConversation, readBaamConversation } =
  await import("../../src/server/services/baamConversations");
const { sendBaamMessage } = await import("../../src/server/services/baamCompanion");
const { transcribeBaamAudio } = await import("../../src/server/services/baamAudio");
const fixture = JSON.parse(await readFile("artifacts/baam-companion/fixture.json", "utf8"));
const user = await prisma.user.findUniqueOrThrow({ where: { id: fixture.adminId } });
const ctx = {
  prisma,
  user: {
    id: user.id,
    email: user.email,
    role: user.role,
    organizationId: user.organizationId,
    isOrgOwner: user.isOrgOwner,
    isPlatformOwner: false,
  },
  impersonator: null,
  impersonationSessionId: null,
  ip: "127.0.0.1",
  requestId: randomUUID(),
  logger: getLogger("baam-provider-check"),
};
const fetchOriginal = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const response = await fetchOriginal(input, init);
  if (!response.ok && String(input).startsWith("https://api.openai.com/")) {
    const payload = (await response
      .clone()
      .json()
      .catch(() => ({}))) as { error?: { code?: string; message?: string } };
    console.log(
      "Provider rejected request",
      response.status,
      payload.error?.code,
      payload.error?.message?.slice(0, 1800),
    );
  }
  return response;
};
try {
  if (process.argv.includes("--voice")) {
    const conversation = await createBaamConversation(ctx, {
      locale: "kg",
      storeId: fixture.storeId,
    });
    const references = JSON.parse(
      await readFile("artifacts/baam-companion/voice/voice-reference.json", "utf8"),
    ) as { file: string; text: string; source: string; locale: string }[];
    const results = [];
    for (const sample of references.filter(
      (sample) => !process.env.BAAM_AUDIO_SAMPLE || sample.file === process.env.BAAM_AUDIO_SAMPLE,
    )) {
      const audio = await readFile(`artifacts/baam-companion/voice/${sample.file}`);
      const result = await transcribeBaamAudio(
        ctx,
        conversation.id,
        audio,
        "audio/wav",
        sample.locale,
      );
      results.push({
        ...sample,
        recognized: result.text,
        languages: result.languages,
        duration: result.duration,
      });
      console.log(JSON.stringify(results.at(-1)));
    }
    await writeFile(
      `artifacts/baam-companion/voice/${process.env.BAAM_AUDIO_SAMPLE ? "additional-voice-results" : "voice-results"}.json`,
      JSON.stringify(results, null, 2),
    );
  } else {
    const conversation = await createBaamConversation(ctx, {
      locale: "ru",
      storeId: fixture.storeId,
    });
    const result = await sendBaamMessage(ctx, {
      conversationId: conversation.id,
      clientRequestId: randomUUID(),
      text: "Создай товар «Чай BAAM проверка» в Test Store, единица штука, цена продажи 150 сом, без начального остатка и без фотографии.",
      locale: "ru",
      revision: 0,
      attachmentIds: [],
      page: { path: "/inventory" },
    });
    const saved = await readBaamConversation(ctx, conversation.id);
    await writeFile(
      "artifacts/baam-companion/provider-result.json",
      JSON.stringify({ result, saved }, null, 2),
    );
    console.log(
      JSON.stringify({
        result,
        messages: saved.messages.map((m) => m.text),
        actions: saved.actions.map((a) => ({ status: a.status, summary: a.summary })),
      }),
    );
  }
} finally {
  globalThis.fetch = fetchOriginal;
  await prisma.$disconnect();
}
