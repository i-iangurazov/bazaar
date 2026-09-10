import { chromium } from "playwright";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const base = "http://localhost:3121",
  directory = "artifacts/baam-companion/browser";
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: process.env.BAAM_BROWSER_CHANNEL });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  permissions: ["microphone"],
});
await context.addCookies([{ name: "NEXT_LOCALE", value: "ru", url: base }]);
const { csrfToken } = await (await context.request.get(base + "/api/auth/csrf")).json();
await context.request.post(base + "/api/auth/callback/credentials", {
  form: {
    csrfToken,
    email: "manager@test.local",
    password: "BaamCompanion123!",
    json: "true",
    callbackUrl: base + "/inventory",
  },
});
const page = await context.newPage();
// Human speech source; real browser MediaRecorder, codec, upload and ASR.
// This checks the voice pipeline without claiming a physical microphone test.
await page.addInitScript(
  (bytes) => {
    const debug = window as unknown as { baamEvents: unknown[]; baamChunks: Blob[] };
    debug.baamEvents = [];
    debug.baamChunks = [];
    const OriginalRecorder = MediaRecorder;
    window.MediaRecorder = class extends OriginalRecorder {
      constructor(stream: MediaStream, options?: MediaRecorderOptions) {
        super(stream, options);
        for (const name of ["start", "stop", "error", "dataavailable"])
          this.addEventListener(name, (event) => {
            debug.baamEvents.push({
              event: name,
              size: event instanceof BlobEvent ? event.data.size : null,
            });
            if (event instanceof BlobEvent) debug.baamChunks.push(event.data);
          });
      }
    };
    navigator.mediaDevices.getUserMedia = async () => {
      // Feed human PCM to a browser audio track. This avoids the host audio driver,
      // whose clock is frozen in this environment, without mocking MediaRecorder.
      const constructors = window as unknown as {
        MediaStreamTrackGenerator: new (input: {
          kind: string;
        }) => MediaStreamTrack & { writable: WritableStream<{ close(): void }> };
        AudioData: new (input: {
          format: string;
          sampleRate: number;
          numberOfFrames: number;
          numberOfChannels: number;
          timestamp: number;
          data: Float32Array;
        }) => { close(): void };
      };
      const track = new constructors.MediaStreamTrackGenerator({ kind: "audio" });
      const writer = track.writable.getWriter(),
        source = Uint8Array.from(bytes),
        view = new DataView(source.buffer);
      let start = 12;
      while (
        start + 8 < source.length &&
        String.fromCharCode(...source.slice(start, start + 4)) !== "data"
      )
        start += 8 + view.getUint32(start + 4, true);
      const rate = view.getUint32(24, true),
        length = view.getUint32(start + 4, true) / 2,
        offset = start + 8;
      void (async () => {
        let cursor = 0;
        const frames = Math.round(rate / 50);
        while (track.readyState === "live") {
          const pcm = new Float32Array(frames);
          for (let i = 0; i < frames; i++)
            if (cursor + i < length)
              pcm[i] = view.getInt16(offset + (cursor + i) * 2, true) / 32768;
          const data = new constructors.AudioData({
            format: "f32-planar",
            sampleRate: rate,
            numberOfFrames: frames,
            numberOfChannels: 1,
            timestamp: (cursor / rate) * 1000000,
            data: pcm,
          });
          try {
            await writer.write(data);
          } finally {
            data.close();
          }
          cursor += frames;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      })().catch(() => {
        /* The consumer stopped recording. */
      });
      return new MediaStream([track]);
    };
  },
  [...(await readFile(resolve("artifacts/baam-companion/voice/ru-0.wav")))],
);

try {
  await page.goto(base + "/inventory");
  await page.locator("[data-baam-launcher]").waitFor();
  await page.waitForTimeout(1500);
  await page.locator("[data-baam-launcher]").click();
  const chat = page.locator("[data-baam-chat]");
  await chat.waitFor();
  await chat.getByRole("button", { name: "Новый диалог", exact: true }).click();
  await chat.getByRole("button", { name: "Записать голосовое сообщение", exact: true }).click();
  await chat.getByText("Идёт запись", { exact: false }).waitFor();
  await page.screenshot({ path: `${directory}/mobile-recording.png` });
  await page.waitForTimeout(5500);
  const upload = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/baam/media") && response.request().method() === "POST",
    { timeout: 90000 },
  );
  await chat.getByRole("button", { name: "Закончить запись", exact: true }).click();
  const response = await upload;
  const result = await response.json();
  const recorded = await page.evaluate(async () => [
    ...new Uint8Array(
      await new Blob((window as unknown as { baamChunks: Blob[] }).baamChunks).arrayBuffer(),
    ),
  ]);
  await writeFile(`${directory}/recorded.webm`, Buffer.from(recorded));
  await writeFile(
    `${directory}/voice-debug.json`,
    JSON.stringify(
      {
        response: result,
        events: await page.evaluate(
          () => (window as unknown as { baamEvents: unknown[] }).baamEvents,
        ),
        postBytes: response.request().postDataBuffer()?.length,
      },
      null,
      2,
    ),
  );
  assert.equal(response.status(), 200, JSON.stringify(result));
  await chat.getByText(/Проверьте названия, количества и суммы/).waitFor();
  const input = chat.locator("[data-baam-input]");
  const recognized = await input.inputValue();
  assert.match(recognized, /60.?000|шестьдесят тысяч/i);
  await input.fill(recognized + " — исправленное уточнение");
  await page.screenshot({ path: `${directory}/mobile-transcription.png` });
  await writeFile(
    `${directory}/voice.json`,
    JSON.stringify(
      {
        source:
          "real human Golos recording supplied via WebCodecs audio track; actual Chrome MediaRecorder; desktop browser at mobile viewport",
        rawMediaRecorderUpload: true,
        providerStatus: response.status(),
        recognized,
        editable: true,
      },
      null,
      2,
    ),
  );
  console.log("Actual MediaRecorder recording, upload, ASR and editable transcription passed");
} catch (error) {
  await page.screenshot({ path: `${directory}/voice-failure.png` });
  await writeFile(`${directory}/voice-failure.txt`, await page.locator("body").innerText());
  throw error;
} finally {
  await browser.close();
}
