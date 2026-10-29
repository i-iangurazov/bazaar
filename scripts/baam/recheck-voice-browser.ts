import { chromium } from "playwright";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const base =
    process.env.BAAM_TEST_HTTPS === "1" ? "https://localhost:3121" : "http://localhost:3121",
  directory = "artifacts/baam-companion/recheck/voice-browser";
assert.equal(process.env.BAAM_LIVE_PROVIDER, "1");
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: process.env.BAAM_BROWSER_CHANNEL });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  permissions: ["microphone"],
  ignoreHTTPSErrors: process.env.BAAM_TEST_HTTPS === "1",
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
const fixture = JSON.parse(await readFile("artifacts/baam-companion/fixture.json", "utf8"));
const capabilities = await (
  await context.request.get(
    `${base}/api/trpc/baam.companion?input=${encodeURIComponent(JSON.stringify({ json: null }))}`,
  )
).json();
assert.equal(capabilities.result.data.json.organizationId, fixture.organizationId);
const page = await context.newPage();
// Controlled synthetic speech; real browser MediaRecorder, codec, upload and ASR.
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
      // Feed synthetic PCM to a browser audio track. This avoids the host audio driver,
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
  [...(await readFile(resolve("artifacts/baam-companion/recheck/browser-command.wav")))],
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
  await page.waitForTimeout(8000);
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
  await chat.getByText(/Распознаю речь/).waitFor({ state: "hidden", timeout: 5000 });
  const recognized = String(result.text ?? "");
  assert.match(recognized, /семь|7/i);
  // No send click: finishing the recording must submit and answer by itself.
  await page.waitForFunction(
    () => document.querySelectorAll("[data-baam-record]").length === 7,
    undefined,
    { timeout: 90000 },
  );
  assert.equal(
    await chat.locator("[data-baam-entry]").count(),
    2,
    "One voice turn, no duplicate submit",
  );
  await page.screenshot({ path: `${directory}/mobile-auto-answer.png` });
  await chat.getByRole("button", { name: "Исправить запрос", exact: true }).click();
  const input = chat.locator("[data-baam-input]");
  assert.equal(await input.inputValue(), recognized);
  await input.fill(recognized.replace(/семь|7/i, "5"));
  await page.screenshot({ path: `${directory}/mobile-transcription.png` });
  await chat.getByRole("button", { name: "Отправить сообщение", exact: true }).click();
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("[data-baam-entry]")]
        .at(-1)
        ?.querySelectorAll("[data-baam-record]").length === 5,
    undefined,
    { timeout: 90000 },
  );
  await page.screenshot({ path: `${directory}/mobile-answer.png` });
  // Check the playback controls' browser API contract without claiming that a
  // headless test can hear the user's physical speakers or installed voices.
  await page.evaluate(() => {
    const state = window as unknown as {
      speechCheck: { text: string; lang: string; stops: number };
    };
    state.speechCheck = { text: "", lang: "", stops: 0 };
    speechSynthesis.speak = (utterance) => {
      state.speechCheck.text = utterance.text;
      state.speechCheck.lang = utterance.lang;
    };
    speechSynthesis.cancel = () => {
      state.speechCheck.stops++;
    };
  });
  await chat.getByRole("button", { name: "Озвучить ответ", exact: true }).last().click();
  await chat.getByRole("button", { name: "Остановить озвучивание", exact: true }).click();
  const speech = await page.evaluate(
    () =>
      (window as unknown as { speechCheck: { text: string; lang: string; stops: number } })
        .speechCheck,
  );
  assert(speech.text.length > 20);
  assert.equal(speech.lang, "ru-RU");
  assert(speech.stops >= 2);
  let uploads = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/baam/media") && request.method() === "POST") uploads++;
  });
  await chat.getByRole("button", { name: "Записать голосовое сообщение", exact: true }).click();
  await chat.getByText("Идёт запись", { exact: false }).waitFor();
  await chat.getByRole("button", { name: "Отменить запись", exact: true }).click();
  assert.equal(uploads, 0);
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("Denied", "NotAllowedError");
    };
  });
  await chat.getByRole("button", { name: "Записать голосовое сообщение", exact: true }).click();
  await chat
    .getByRole("alert")
    .filter({ hasText: /микрофон/ })
    .waitFor();
  assert.equal(uploads, 0);
  await writeFile(
    `${directory}/voice.json`,
    JSON.stringify(
      {
        source:
          "synthetic business speech via WebCodecs audio track; actual Chrome MediaRecorder; desktop browser at mobile viewport; no physical microphone claim",
        rawMediaRecorderUpload: true,
        providerStatus: response.status(),
        recognized,
        automaticSubmission: true,
        sendClicksBeforeFirstAnswer: 0,
        automaticResultCards: 7,
        editable: true,
        editedQueryExecuted: true,
        resultCards: 5,
        recordingCancelDidNotUpload: true,
        deniedMicrophoneExplained: true,
        readAloudUiApiOnly: true,
      },
      null,
      2,
    ),
  );
  console.log(
    "Actual MediaRecorder recording, automatic submission, answer and optional correction passed",
  );
} catch (error) {
  await page.screenshot({ path: `${directory}/voice-failure.png` });
  await writeFile(`${directory}/voice-failure.txt`, await page.locator("body").innerText());
  throw error;
} finally {
  await browser.close();
}
