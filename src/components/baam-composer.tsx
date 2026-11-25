"use client";
import Image from "next/image";
import { useCallback, useRef } from "react";
import {
  ImagePlusIcon as ImageSquare,
  MicrophoneIcon as Microphone,
  SendIcon as PaperPlaneTilt,
  StopIcon as Stop,
  CloseIcon as X,
} from "@/components/icons";
import { Spinner } from "./ui/spinner";
import type { BaamController } from "./use-baam-companion";
import { productPhotoAccept } from "@/lib/productImageUpload";
import { AiPrivacyConsent } from "./ai-privacy-consent";

const iconButton =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-secondary focus-visible:outline focus-visible:outline-2 disabled:opacity-40";
export function BaamComposer({ c, inlineControls = false }: { c: BaamController; inlineControls?: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const attachInput = useCallback((input: HTMLTextAreaElement | null) => {
    c.inputRef.current = input;
    if (!input?.closest("[data-baam-drawer]")) return;
    // Consent can finish loading after the dialog's initial focus pass. Focus
    // the newly mounted composer only while focus still awaits that input;
    // preserve a person's deliberate focus on another control.
    const active = document.activeElement;
    if (active === document.body || active === input.closest("[data-baam-drawer]") || active?.hasAttribute("data-baam-launcher"))
      input.focus({ preventScroll: true });
  }, [c.inputRef]);
  const editingForm = c.workflows?.some(
    (w) =>
      w.id === c.data?.conversation.activeWorkflowId &&
      ["EDITING", "FAILED", "RECEIPT"].includes(w.status),
  );
  return (
    <AiPrivacyConsent>
    <div data-baam-composer-content className="shrink-0 border-t border-border/70 bg-card p-3 sm:p-4">
      {c.notice ? (
        <p className="mb-2 text-xs text-muted-foreground" role="status">
          {c.notice}
        </p>
      ) : null}
      {c.error ? (
        <div className="mb-2 text-xs leading-5 text-destructive" role="alert">
          {c.error}
          {c.pendingRequest && c.available && !c.busy ? (
            <button
              type="button"
              className="ml-2 min-h-8 underline"
              onClick={() => void c.ask("", c.pendingRequest)}
            >
              {c.t("retry")}
            </button>
          ) : c.loadError ? (
            <button
              type="button"
              className="ml-2 min-h-8 underline"
              disabled={c.fetching}
              onClick={() => void c.retryLoad()}
            >
              {c.t("retry")}
            </button>
          ) : null}
        </div>
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
      {c.imageRetry && !c.mediaPending ? (
        <button
          type="button"
          className="mb-2 min-h-9 text-sm text-primary underline"
          onClick={() => void c.upload(c.imageRetry!, "image", c.imageRetry!.name)}
        >
          {c.t("retry")} · {c.imageRetry.name}
        </button>
      ) : null}
      {c.attachments.length ? (
        <div className="mb-2 flex flex-wrap gap-2">
          {c.attachments.map((a) => (
            <div
              key={a.id}
              className="flex max-w-full items-center gap-2 rounded-lg border px-2 text-xs"
            >
              <Image
                unoptimized
                width={40}
                height={40}
                src={a.url}
                alt=""
                className="h-10 w-10 rounded object-cover"
              />
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
          className="flex min-h-20 items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3"
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
            <Stop size={18} fill="currentColor" />
          </button>
        </div>
      ) : (
        <form
          data-baam-compose-form
          onSubmit={(e) => {
            e.preventDefault();
            void c.ask();
          }}
          className="rounded-lg border border-border bg-background p-2 shadow-none focus-within:border-primary"
        >
          <textarea
            ref={attachInput}
            data-baam-input
            aria-label={c.t("placeholder")}
            placeholder={c.t("placeholder")}
            value={c.question}
            rows={inlineControls || editingForm ? 1 : 2}
            maxLength={6000}
            onChange={(e) => c.setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void c.ask();
              }
            }}
            className={`block max-h-36 ${editingForm ? "min-h-8" : "min-h-14"} w-full resize-none border-0 bg-transparent px-2 py-1 text-base leading-6 shadow-none outline-none focus:ring-0 sm:text-sm`}
          />
          <div data-baam-compose-tools className="flex items-center gap-1">
            <input
              ref={fileRef}
              type="file"
              accept={productPhotoAccept}
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
              disabled={
                !c.available || !c.capabilities.data?.voiceConfigured || c.busy || c.mediaPending
              }
              className={iconButton}
              onClick={() => void c.voice.start()}
            >
              <Microphone size={21} />
            </button>
            <span className="min-w-0 flex-1 text-xs text-muted-foreground" role="status">
              {c.mediaPending ? (
                <span className="flex items-center gap-2">
                  <Spinner />
                  {c.t(c.mediaKind === "image" ? "loading" : "transcribing")}{" "}
                  {c.mediaKind === "image" ? `${c.uploadProgress}%` : ""}
                </span>
              ) : null}
            </span>
            {c.data?.activeTurn && !c.executing ? (
              <button
                type="button"
                aria-label={c.t("stop")}
                disabled={c.stopping}
                className="flex h-11 w-11 items-center justify-center rounded-lg bg-secondary focus-visible:outline focus-visible:outline-2 disabled:opacity-50"
                onClick={() => void c.stopResponse()}
              >
                {c.stopping ? <Spinner /> : <Stop size={18} fill="currentColor" />}
              </button>
            ) : (
              <button
                type="submit"
                aria-label={c.t("send")}
                disabled={!c.available || c.busy || c.mediaPending || !c.question.trim()}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40"
              >
                <PaperPlaneTilt size={20} />
              </button>
            )}
          </div>
        </form>
      )}
      {!inlineControls ? <p className="mt-2 text-center text-[10px] leading-4 text-muted-foreground">
        {c.t("voiceSupport")}
      </p> : null}
    </div>
    </AiPrivacyConsent>
  );
}
