"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type Recording = { media: MediaRecorder; audio: MediaStream; cancelled: boolean };
const release = (audio?: MediaStream) => audio?.getTracks().forEach((track) => track.stop());

export function useBaamVoice(
  onRecorded: (blob: Blob) => Promise<void>,
  onError: (code: string) => void,
) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [requesting, setRequesting] = useState(false);
  const recorder = useRef<Recording>();
  const generation = useRef(0);
  const acquiring = useRef(false);
  const callback = useRef(onRecorded);
  callback.current = onRecorded;
  const failure = useRef(onError);
  failure.current = onError;
  const stop = useCallback((cancel = false) => {
    if (acquiring.current) {
      generation.current++;
      acquiring.current = false;
    }
    const current = recorder.current;
    if (current) {
      current.cancelled = cancel;
      if (current.media.state === "recording") current.media.stop();
      if (cancel) release(current.audio);
    }
    setRecording(false);
    setRequesting(false);
  }, []);
  const start = useCallback(async () => {
    if (acquiring.current || recorder.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      failure.current("micUnsupported");
      return;
    }
    const attempt = ++generation.current;
    acquiring.current = true;
    setRequesting(true);
    let audio: MediaStream | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      audio = await Promise.race([
        navigator.mediaDevices
          .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false })
          .then((stream) => {
            if (generation.current !== attempt) {
              release(stream);
              throw new DOMException("Cancelled", "AbortError");
            }
            return stream;
          }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("micTimeout")), 20000);
        }),
      ]);
      if (generation.current !== attempt) {
        release(audio);
        return;
      }
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((m) =>
        MediaRecorder.isTypeSupported(m),
      );
      if (!mimeType) throw new Error("micUnsupported");
      const media = new MediaRecorder(audio, { mimeType, audioBitsPerSecond: 64000 });
      const current: Recording = { media, audio, cancelled: false };
      recorder.current = current;
      const chunks: Blob[] = [];
      let size = 0;
      media.ondataavailable = (event) => {
        if (!event.data.size) return;
        chunks.push(event.data);
        size += event.data.size;
        if (size > 3 * 1024 * 1024) {
          current.cancelled = true;
          stop(true);
          failure.current("baamAudioTooLarge");
        }
      };
      media.onerror = () => {
        current.cancelled = true;
        stop(true);
        failure.current("baamAudioFormat");
      };
      media.onstop = () => {
        // An old recorder must never release a newer recording's microphone.
        release(current.audio);
        if (recorder.current === current) {
          recorder.current = undefined;
          setRecording(false);
        }
        if (!current.cancelled) void callback.current(new Blob(chunks, { type: mimeType }));
      };
      media.start(250);
      setSeconds(0);
      setRecording(true);
    } catch (error) {
      release(audio);
      if (generation.current !== attempt) return;
      recorder.current = undefined;
      failure.current(
        error instanceof DOMException && ["NotAllowedError", "SecurityError"].includes(error.name)
          ? "micDenied"
          : error instanceof Error && ["micTimeout", "micUnsupported"].includes(error.message)
            ? error.message
            : "micMissing",
      );
      generation.current++; // Release any permission request that resolves after the timeout.
      acquiring.current = false;
      setRequesting(false);
    } finally {
      clearTimeout(timer);
      if (generation.current === attempt) {
        acquiring.current = false;
        setRequesting(false);
      }
    }
  }, [stop]);
  useEffect(() => {
    if (!recording) return;
    const started = Date.now();
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - started) / 1000);
      setSeconds(elapsed);
      if (elapsed >= 89) stop();
    }, 250);
    return () => clearInterval(timer);
  }, [recording, stop]);
  useEffect(
    () => () => {
      generation.current++;
      if (recorder.current) {
        recorder.current.cancelled = true;
        if (recorder.current.media.state === "recording") recorder.current.media.stop();
        release(recorder.current.audio);
      }
    },
    [],
  );
  return { recording, requesting, seconds, start, stop };
}
