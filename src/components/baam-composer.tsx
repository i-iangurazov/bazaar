"use client";
import { useRef } from "react";
import { ImageSquare, Microphone, PaperPlaneTilt, Stop, X } from "@phosphor-icons/react";
import { Spinner } from "./ui/spinner";
import type { BaamController } from "./use-baam-companion";

const iconButton =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-secondary focus-visible:outline focus-visible:outline-2 disabled:opacity-40";
export function BaamComposer({ c }: { c: BaamController }) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="shrink-0 border-t border-border/70 bg-card p-3 sm:p-4">
      {c.notice ? (
        <p className="mb-2 text-xs text-muted-foreground" role="status">
          {c.notice}
        </p>
      ) : null}
      {c.error ? (
        <div className="mb-2 text-xs leading-5 text-destructive" role="alert">
          {c.error}
          {c.pendingRequest && !c.busy ? (
            <button
              type="button"
              className="ml-2 min-h-8 underline"
              onClick={() => void c.ask("", c.pendingRequest)}
            >
              {c.t("retry")}
            </button>
          ) : null}
        </div>
      ) : null}
      {c.allowed && !c.available ? (
        <p className="mb-2 text-xs leading-5 text-muted-foreground">{c.t("unavailable")}</p>
      ) : null}
      {c.voiceId ? (
        <p className="mb-2 text-xs leading-5 text-muted-foreground" role="status">
          {c.t("reviewVoice")}
        </p>
      ) : null}
      {c.voiceBlob && !c.mediaPending ? (
        <button
          type="button"
          className="mb-2 min-h-9 text-sm text-primary underline"
          onClick={() =>
            void c.upload(
              c.voiceBlob!,
              "audio",
              c.voiceBlob!.type.includes("mp4") ? "voice.mp4" : "voice.webm",
            )
          }
        >
          {c.t("retry")}
        </button>
      ) : null}
      {c.attachments.length ? (
        <div className="mb-2 flex flex-wrap gap-2">
          {c.attachments.map((a) => (
            <div
              key={a.id}
              className="flex max-w-full items-center gap-2 rounded-lg border px-2 text-xs"
            >
              <ImageSquare size={16} />
              <span className="max-w-48 truncate">{a.name}</span>
              <button
                type="button"
                aria-label={c.t("removeAttachment")}
                className="h-9 w-8"
                onClick={() => c.setAttachments((old) => old.filter((item) => item.id !== a.id))}
              >
                <X size={15} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {c.voice.recording || c.voice.requesting ? (
        <div
          className="flex min-h-20 items-center gap-3 rounded-2xl border border-primary/30 bg-primary/5 px-3"
          role="status"
        >
          <span className="h-2 w-2 rounded-full bg-red-600 motion-safe:animate-pulse" />
          <div className="flex-1 text-sm">
            {c.voice.requesting ? c.t("loading") : c.t("recording")}
            <span className="ml-2 font-mono tabular-nums">
              {Math.floor(c.voice.seconds / 60)}:{String(c.voice.seconds % 60).padStart(2, "0")}
            </span>
          </div>
          <button
            type="button"
            aria-label={c.t("cancelRecording")}
            className={iconButton}
            onClick={() => c.voice.stop(true)}
          >
            <X size={20} />
          </button>
          <button
            type="button"
            aria-label={c.t("stopRecording")}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground"
            onClick={() => c.voice.stop()}
          >
            <Stop size={18} weight="fill" />
          </button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void c.ask();
          }}
          className="rounded-2xl border border-border bg-background p-2 shadow-sm focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/10"
        >
          <textarea
            ref={c.inputRef}
            data-baam-input
            aria-label={c.t("placeholder")}
            placeholder={c.t("placeholder")}
            value={c.question}
            rows={2}
            maxLength={6000}
            onChange={(e) => c.setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void c.ask();
              }
            }}
            className="block max-h-36 min-h-14 w-full resize-none border-0 bg-transparent px-2 py-1 text-base leading-6 shadow-none outline-none focus:ring-0 sm:text-sm"
          />
          <div className="flex items-center gap-1">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void c.upload(f, "image", f.name);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              aria-label={c.t("attach")}
              disabled={!c.available || c.busy || c.mediaPending || c.attachments.length >= 4}
              className={iconButton}
              onClick={() => fileRef.current?.click()}
            >
              <ImageSquare size={21} />
            </button>
            <button
              type="button"
              aria-label={c.t("microphone")}
              disabled={!c.available || c.busy || c.mediaPending}
              className={iconButton}
              onClick={() => void c.voice.start()}
            >
              <Microphone size={21} />
            </button>
            <span className="min-w-0 flex-1 text-xs text-muted-foreground" role="status">
              {c.mediaPending ? (
                <span className="flex items-center gap-2">
                  <Spinner />
                  {c.t(c.mediaKind === "image" ? "loading" : "transcribing")}
                </span>
              ) : null}
            </span>
            {c.busy && !c.executing && c.data?.activeTurn ? (
              <button
                type="button"
                aria-label={c.t("stop")}
                className="flex h-11 w-11 items-center justify-center rounded-xl bg-secondary focus-visible:outline focus-visible:outline-2"
                onClick={() => void c.stopResponse()}
              >
                <Stop size={18} weight="fill" />
              </button>
            ) : (
              <button
                type="submit"
                aria-label={c.t("send")}
                disabled={!c.available || c.busy || c.mediaPending || !c.question.trim()}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40"
              >
                <PaperPlaneTilt size={20} weight="fill" />
              </button>
            )}
          </div>
        </form>
      )}
      <p className="mt-2 text-center text-[10px] leading-4 text-muted-foreground">
        {c.t("voiceSupport")}
      </p>
    </div>
  );
}
