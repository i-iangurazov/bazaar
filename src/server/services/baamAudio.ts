import { createHash } from "node:crypto";
import { parseBuffer } from "music-metadata";
import { z } from "zod";
import { prisma } from "@/server/db/prisma";
import type { Context } from "@/server/trpc/trpc";
import { baamJson, ownBaamConversation } from "./baamConversations";
import { AppError } from "./errors";

export const BAAM_AUDIO_MAX_BYTES = 3 * 1024 * 1024;
export const BAAM_AUDIO_MAX_SECONDS = 90;
const audioTypes = new Set([
  "audio/webm",
  "video/webm",
  "audio/mp4",
  "video/mp4",
  "audio/ogg",
  "audio/wav",
  "audio/x-wav",
  "audio/mpeg",
]);

/** MediaRecorder WebM often omits Duration. Read bounded EBML timestamps, not a client duration claim. */
export function webmDuration(buffer: Buffer): number {
  let scale = 1_000_000,
    last = 0,
    elements = 0;
  const readVint = (at: number, keepMarker: boolean) => {
    const first = buffer[at];
    if (!first) throw new Error("invalidAudio");
    let bytes = 1;
    while (bytes <= 8 && !(first & (1 << (8 - bytes)))) bytes++;
    if (bytes > 8 || at + bytes > buffer.length) throw new Error("invalidAudio");
    let value = keepMarker ? first : first & ((1 << (8 - bytes)) - 1);
    for (let i = 1; i < bytes; i++) value = value * 256 + buffer[at + i];
    const mask = (1 << (8 - bytes)) - 1;
    const unknown =
      (first & mask) === mask && buffer.subarray(at + 1, at + bytes).every((byte) => byte === 255);
    return { value, bytes, unknown };
  };
  const uint = (a: number, b: number) => {
    let n = 0;
    for (let i = a; i < b; i++) n = n * 256 + buffer[i];
    return n;
  };
  const walk = (start: number, end: number, cluster = 0, depth = 0) => {
    if (depth > 8) throw new Error("invalidAudio");
    let at = start;
    while (at < end) {
      if (++elements > 100000) throw new Error("invalidAudio");
      const tag = readVint(at, true);
      at += tag.bytes;
      const size = readVint(at, false);
      at += size.bytes;
      // Chromium uses one-byte 0xff for an unknown Cluster size. It means
      // "until the next cluster / parent end", not a payload of 127 bytes.
      if (size.unknown && [0x18538067, 0x1f43b675].includes(tag.value)) {
        if (tag.value === 0x1f43b675) cluster = 0;
        continue;
      }
      const stop = at + size.value;
      if (size.unknown || stop > end) throw new Error("invalidAudio");
      if (stop <= at) {
        at = stop;
        continue;
      }
      if ([0x18538067, 0x1549a966, 0x1f43b675, 0xa0].includes(tag.value))
        walk(at, stop, cluster, depth + 1);
      else if (tag.value === 0x2ad7b1) scale = uint(at, stop);
      else if (tag.value === 0xe7) {
        cluster = uint(at, stop);
        last = Math.max(last, cluster);
      } else if (tag.value === 0xa3 || tag.value === 0xa1) {
        const track = readVint(at, false);
        if (at + track.bytes + 2 > stop) throw new Error("invalidAudio");
        last = Math.max(last, cluster + buffer.readInt16BE(at + track.bytes));
      }
      at = stop;
    }
  };
  walk(0, buffer.length);
  return (last * scale) / 1e9;
}

export async function validateBaamAudio(buffer: Buffer, mimeType: string) {
  const mime = mimeType.split(";")[0].toLowerCase();
  if (!audioTypes.has(mime) || !buffer.length)
    throw new AppError("baamAudioFormat", "BAD_REQUEST", 400);
  if (buffer.length > BAAM_AUDIO_MAX_BYTES)
    throw new AppError("baamAudioTooLarge", "BAD_REQUEST", 400);
  let duration: number;
  try {
    const metadata = await parseBuffer(
      buffer,
      { mimeType: mime, size: buffer.length },
      { duration: true },
    );
    duration = metadata.format.duration ?? (mime.endsWith("webm") ? webmDuration(buffer) : NaN);
  } catch {
    throw new AppError("baamAudioFormat", "BAD_REQUEST", 400);
  }
  if (!Number.isFinite(duration) || duration < 0.2)
    throw new AppError("baamAudioFormat", "BAD_REQUEST", 400);
  if (duration > BAAM_AUDIO_MAX_SECONDS + 1)
    throw new AppError("baamAudioTooLong", "BAD_REQUEST", 400);
  return { duration, mime };
}

export async function transcribeBaamAudio(
  ctx: Context,
  conversationId: string,
  buffer: Buffer,
  mimeType: string,
  locale: string,
) {
  const { scope } = await ownBaamConversation(ctx, conversationId);
  const { duration, mime } = await validateBaamAudio(buffer, mimeType);
  if (!process.env.OPENAI_API_KEY) throw new AppError("baamNotConfigured", "BAD_REQUEST", 400);
  const audioHash = createHash("sha256").update(buffer).digest("hex");
  const existing = await prisma.baamTranscription.findUnique({
    where: { conversationId_audioHash: { conversationId, audioHash } },
  });
  if (existing?.status === "COMPLETED") return existing;
  if (existing?.status === "PROCESSING" && existing.leaseUntil > new Date())
    throw new AppError("baamAudioProcessing", "CONFLICT", 409);
  const leaseUntil = new Date(Date.now() + 90_000);
  let transcription;
  if (existing) {
    const won = await prisma.baamTranscription.updateMany({
      where: { id: existing.id, OR: [{ status: "FAILED" }, { leaseUntil: { lt: new Date() } }] },
      data: { status: "PROCESSING", leaseUntil, errorCode: null },
    });
    if (!won.count) throw new AppError("baamAudioProcessing", "CONFLICT", 409);
    transcription = existing;
  } else {
    try {
      transcription = await prisma.baamTranscription.create({
        data: {
          conversationId,
          audioHash,
          duration,
          leaseUntil,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002")
        throw new AppError("baamAudioProcessing", "CONFLICT", 409);
      throw error;
    }
  }
  try {
    const form = new FormData();
    const extension = mime.includes("mp4")
      ? "mp4"
      : mime.includes("ogg")
        ? "ogg"
        : mime.includes("wav")
          ? "wav"
          : mime.includes("mpeg")
            ? "mp3"
            : "webm";
    form.append("file", new Blob([new Uint8Array(buffer)], { type: mime }), `voice.${extension}`);
    form.append("model", process.env.BAAM_TRANSCRIPTION_MODEL || "gpt-transcribe");
    form.append("response_format", "json");
    // The live provider rejects ky in languages[] despite transcribing Kyrgyz
    // accurately with automatic detection. Mixed speech must not be forced to RU/EN.
    form.append(
      "prompt",
      `Business request in Russian, Kyrgyz or English. Interface language: ${locale === "kg" ? "Kyrgyz" : locale === "en" ? "English" : "Russian"}. Transcribe the spoken words faithfully, preserving product names, quantities and sums. Do not complete missing speech.`,
    );
    const keywords = scope.availableStores
      .map((s) => s.name)
      .filter((s) => !/[<>\r\n]/.test(s))
      .slice(0, 15);
    for (const keyword of ["Bazaar", "BAAM", ...keywords])
      form.append("keywords[]", keyword.slice(0, 100));
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(75_000),
    });
    if (!response.ok) {
      ctx.logger.warn({ status: response.status }, "BAAM transcription provider failed");
      throw new AppError("baamVoiceUnavailable", "BAD_REQUEST", 400);
    }
    const parsed = z
      .object({
        text: z.string().max(12000),
        languages: z.array(z.object({ code: z.string() })).optional(),
      })
      .parse(await response.json());
    await ownBaamConversation(ctx, conversationId);
    if (!parsed.text.trim()) throw new AppError("baamAudioEmpty", "BAD_REQUEST", 400);
    const completed = await prisma.baamTranscription.updateMany({
      where: { id: transcription.id, status: "PROCESSING", leaseUntil },
      data: {
        status: "COMPLETED",
        text: parsed.text.trim(),
        languages: baamJson(parsed.languages ?? []),
        needsReview: true,
      },
    });
    if (!completed.count) throw new AppError("baamAudioProcessing", "CONFLICT", 409);
    return await prisma.baamTranscription.findUniqueOrThrow({ where: { id: transcription.id } });
  } catch (error) {
    await prisma.baamTranscription.updateMany({
      where: { id: transcription.id, status: "PROCESSING", leaseUntil },
      data: {
        status: "FAILED",
        errorCode: error instanceof AppError ? error.message : "baamVoiceUnavailable",
      },
    });
    throw error;
  }
}
