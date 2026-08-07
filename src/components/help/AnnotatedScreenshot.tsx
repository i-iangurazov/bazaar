"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";

import type { HelpLocale, HelpMedia } from "@/content/help/types";
import { localize, localizedUi } from "@/content/help/ui";
import styles from "./help.module.css";

export const AnnotatedScreenshot = ({
  media,
  locale,
}: {
  media: HelpMedia;
  locale: HelpLocale;
}) => {
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const ui = useMemo(() => localizedUi(locale), [locale]);
  const source = mobile && media.mobileSrc ? media.mobileSrc : media.src;
  const isPortrait = source.includes("mobile");

  useEffect(() => {
    if (!media.mobileSrc) return;
    const query = window.matchMedia("(max-width: 640px)");
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [media.mobileSrc]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const image = (fullscreen = false) => (
    <div
      className={`${styles.annotatedCanvas} ${isPortrait ? styles.annotatedPortrait : ""} ${fullscreen ? styles.annotatedFullscreen : ""}`}
    >
      <Image
        src={source}
        alt={localize(media.alt, locale)}
        fill
        sizes={fullscreen ? "95vw" : "(max-width: 768px) 94vw, 840px"}
        className={styles.annotatedImage}
      />
      {media.annotations.map((item) => (
        <span
          key={item.number}
          className={styles.annotationMarker}
          style={{ left: `${item.x}%`, top: `${item.y}%` }}
          aria-hidden
        >
          {item.number}
        </span>
      ))}
      {media.annotations
        .filter((item) => item.width && item.height)
        .map((item) => (
          <span
            key={`spotlight-${item.number}`}
            className={styles.annotationSpotlight}
            style={{
              left: `${item.x - 2}%`,
              top: `${item.y - 2}%`,
              width: `${item.width}%`,
              height: `${item.height}%`,
            }}
            aria-hidden
          />
        ))}
    </div>
  );

  return (
    <figure className={styles.annotatedFigure}>
      <button type="button" className={styles.annotatedTrigger} onClick={() => setOpen(true)}>
        {image()}
        <span className={styles.zoomHint}>{ui.imageHint}</span>
        <span className={styles.srOnly}>{ui.zoomImage}</span>
      </button>
      <figcaption className={styles.annotationList}>
        {media.annotations.map((item) => (
          <span key={item.number}>
            <b>{item.number}</b>
            {localize(item.label, locale)}
          </span>
        ))}
      </figcaption>
      <dialog
        ref={dialogRef}
        className={styles.zoomDialog}
        aria-label={localize(media.alt, locale)}
        onClose={() => setOpen(false)}
        onCancel={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}
      >
        <button type="button" className={styles.zoomClose} onClick={() => setOpen(false)}>
          <span aria-hidden>×</span>
          <span className={styles.srOnly}>{ui.closeImage}</span>
        </button>
        {image(true)}
        <div className={styles.zoomCallouts}>
          {media.annotations.map((item) => (
            <span key={item.number}>
              <b>{item.number}</b> {localize(item.label, locale)}
            </span>
          ))}
        </div>
      </dialog>
    </figure>
  );
};
