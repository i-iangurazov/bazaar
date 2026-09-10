import { describe, expect, it } from "vitest";
import { BAAM_AUDIO_MAX_BYTES, validateBaamAudio, webmDuration } from "@/server/services/baamAudio";
import { baamOptionalValues, baamToolSchema } from "@/server/services/baamCompanion";
import { baamActions } from "@/server/services/baamBusiness";

function wav(seconds: number, rate = 8000) {
  const samples = Math.round(seconds * rate),
    buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF");
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  return buffer;
}
describe("BAAM bounded audio and typed provider contracts", () => {
  it("derives recording duration from the file and accepts an actual PCM WAV container", async () => {
    expect(await validateBaamAudio(wav(3), "audio/wav")).toEqual({
      duration: 3,
      mime: "audio/wav",
    });
  });
  it("rejects malformed, empty, unsupported, oversized and overlong recordings", async () => {
    await expect(validateBaamAudio(Buffer.from("fake wav"), "audio/wav")).rejects.toMatchObject({
      message: "baamAudioFormat",
    });
    await expect(validateBaamAudio(Buffer.alloc(0), "audio/webm")).rejects.toMatchObject({
      message: "baamAudioFormat",
    });
    await expect(validateBaamAudio(wav(1), "text/html")).rejects.toMatchObject({
      message: "baamAudioFormat",
    });
    await expect(
      validateBaamAudio(Buffer.alloc(BAAM_AUDIO_MAX_BYTES + 1), "audio/webm"),
    ).rejects.toMatchObject({ message: "baamAudioTooLarge" });
    await expect(validateBaamAudio(wav(93), "audio/wav")).rejects.toMatchObject({
      message: "baamAudioTooLong",
    });
  });
  it("bounds EBML parsing and uses real cluster and block timestamps when Duration is absent", () => {
    const block = Buffer.from([0xa3, 0x84, 0x81, 0x03, 0xe8, 0x80]);
    const cluster = Buffer.concat([
      Buffer.from([0x1f, 0x43, 0xb6, 0x75, 0x8a, 0xe7, 0x82, 0x07, 0xd0]),
      block,
    ]);
    expect(webmDuration(cluster)).toBe(3);
    expect(() => webmDuration(Buffer.from([0]))).toThrow();
  });
  it("reads successive Chromium clusters with unknown length and large Opus blocks", () => {
    const block = Buffer.concat([
      Buffer.from([0xa3, 0x41, 0x30, 0x81, 0x03, 0xe8, 0x80]),
      Buffer.alloc(300),
    ]);
    const cluster = (high: number, low: number) =>
      Buffer.concat([Buffer.from([0x1f, 0x43, 0xb6, 0x75, 0xff, 0xe7, 0x82, high, low]), block]);
    const recording = Buffer.concat([
      Buffer.from([0x18, 0x53, 0x80, 0x67, 0xff]),
      cluster(0x07, 0xd0),
      cluster(0x13, 0x88),
    ]);
    expect(webmDuration(recording)).toBe(6);
  });
  it("makes every action a closed strict provider object, keeping optional fields nullable", () => {
    for (const action of Object.values(baamActions)) {
      const schema = baamToolSchema(action.schema);
      const visit = (value: unknown) => {
        if (!value || typeof value !== "object") return;
        const node = value as Record<string, unknown>;
        if (node.properties) {
          expect(node.additionalProperties, action.name).toBe(false);
          expect(node.required, action.name).toEqual(Object.keys(node.properties));
        }
        Object.values(node).forEach((child) => {
          if (Array.isArray(child)) child.forEach(visit);
          else visit(child);
        });
      };
      visit(schema);
    }
    expect(
      baamOptionalValues({ name: "Tea", optional: null, lines: [{ variantId: null, qty: 2 }] }),
    ).toEqual({ name: "Tea", lines: [{ qty: 2 }] });
  });
});
