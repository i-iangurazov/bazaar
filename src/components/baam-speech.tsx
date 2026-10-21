"use client";
import { useEffect, useRef, useState } from "react";
import { SpeakerHigh, Stop } from "@phosphor-icons/react";
import { baamCopy } from "@/lib/baam/copy";

let finishActiveSpeech: (() => void) | undefined;
export function BaamSpeech({ text, locale }: { text: string; locale: string }) {
  const ownFinish = useRef<(() => void) | undefined>();
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    setSupported("speechSynthesis" in window && "SpeechSynthesisUtterance" in window);
    return () => {
      if (ownFinish.current && finishActiveSpeech === ownFinish.current) {
        window.speechSynthesis.cancel();
        finishActiveSpeech();
      }
    };
  }, []);
  if (!supported) return null;
  const label = baamCopy(locale, speaking ? "stopSpeaking" : "listen");
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-secondary focus-visible:outline focus-visible:outline-2"
      onClick={() => {
        finishActiveSpeech?.();
        window.speechSynthesis.cancel();
        if (speaking) {
          setSpeaking(false);
          return;
        }
        const utterance = new SpeechSynthesisUtterance(text.slice(0, 10000));
        utterance.lang = locale === "kg" ? "ky-KG" : locale === "en" ? "en-US" : "ru-RU";
        const voice = window.speechSynthesis
          .getVoices()
          .find((value) => value.lang.startsWith(utterance.lang.split("-")[0]));
        if (voice) utterance.voice = voice;
        const finish = () => {
          setSpeaking(false);
          if (finishActiveSpeech === finish) finishActiveSpeech = undefined;
          if (ownFinish.current === finish) ownFinish.current = undefined;
        };
        ownFinish.current = finish;
        finishActiveSpeech = finish;
        utterance.onend = utterance.onerror = finish;
        setSpeaking(true);
        window.speechSynthesis.speak(utterance);
      }}
    >
      {speaking ? <Stop size={15} /> : <SpeakerHigh size={15} />}
      {label}
    </button>
  );
}
