"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { BaamAssistant } from "@/components/baam-assistant";
import { baamCopy } from "@/lib/baam/copy";
import { PageHeader } from "@/components/page-header";
import { BackIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { baamWorkspaceReturnHref } from "@/lib/baam/workspaceNavigation";
import { isIOS } from "@/lib/native/platform";
import { cn } from "@/lib/utils";
import styles from "@/components/baam-native-workspace.module.css";

export default function BaamPage() {
  const t = useTranslations("baam");
  const common = useTranslations("common");
  const locale = useLocale();
  const search = useSearchParams();
  const [nativeIOS, setNativeIOS] = useState(false);
  const [shortViewport, setShortViewport] = useState(false);
  const workspace = useRef<HTMLDivElement>(null);
  useEffect(() => setNativeIOS(isIOS()), []);
  useEffect(() => {
    const element = workspace.current;
    if (!nativeIOS || !element) return;
    const root = document.documentElement;
    const measure = () => {
      const top = Math.max(0, element.getBoundingClientRect().top);
      const navHeight = document.querySelector<HTMLElement>("[data-native-bottom-nav]")?.getBoundingClientRect().height ?? 0;
      element.style.setProperty("--baam-workspace-top", `${top}px`);
      element.style.setProperty("--baam-workspace-bottom", navHeight > 0 ? `${navHeight + 8}px`
        : root.dataset.nativeKeyboard === "visible" ? "8px" : "max(8px, env(safe-area-inset-bottom))");
      // Read the fitted workspace, not orientation or the unresized screen.
      // Keep the composer and navigation usable when keyboard leaves little room.
      const height = element.clientHeight;
      setShortViewport(height > 0 && height < 320);
    };
    measure();
    window.addEventListener("resize", measure, { passive: true });
    window.addEventListener("scroll", measure, { passive: true });
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", measure, { passive: true });
    viewport?.addEventListener("scroll", measure, { passive: true });
    const mutations = new MutationObserver(measure);
    mutations.observe(root, { attributes: true, attributeFilter: ["data-native-keyboard", "style", "class"] });
    const resize = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : undefined;
    if (element.parentElement) resize?.observe(element.parentElement);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure);
      viewport?.removeEventListener("resize", measure);
      viewport?.removeEventListener("scroll", measure);
      mutations.disconnect();
      resize?.disconnect();
      element.style.removeProperty("--baam-workspace-top");
      element.style.removeProperty("--baam-workspace-bottom");
    };
  }, [nativeIOS]);
  const back = nativeIOS ? (
      <Button asChild variant="secondary" size="icon" className={shortViewport ? "h-11 w-11 shrink-0" : undefined} aria-label={common("back")} title={common("back")}>
        <Link href={baamWorkspaceReturnHref(search.get("returnTo"))} replace prefetch={false}>
          <BackIcon aria-hidden />
        </Link>
      </Button>
  ) : undefined;
  const compact = nativeIOS && shortViewport;
  const workspaceHeader = compact ? <header data-baam-short-header className="flex min-h-11 shrink-0 items-center justify-between gap-3 px-3">
    <h1 className="text-base font-semibold text-foreground">{t("title")}</h1>
    {back}
  </header> : undefined;
  return <div ref={workspace} className={cn("mx-auto min-w-0 max-w-4xl", nativeIOS ? styles.workspace : "space-y-5")} data-testid="baam-page" data-baam-workspace data-baam-short-viewport={compact ? "true" : undefined} tabIndex={-1}>
    {!compact ? <PageHeader title={t("title")} subtitle={baamCopy(locale, "subtitle")} actionClassName={nativeIOS ? "w-auto" : undefined} action={back} /> : null}
    <div className={cn("overflow-hidden rounded-lg border border-border/80 bg-card shadow-sm", nativeIOS && styles.surface)}>
      <BaamAssistant nativeViewport={nativeIOS} compactViewport={compact} workspaceHeader={workspaceHeader} />
    </div>
  </div>;
}
