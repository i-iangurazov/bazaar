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
import { mobileShellMediaQuery, phoneWorkspaceMediaQuery } from "@/hooks/useIsMobile";
import { cn } from "@/lib/utils";
import styles from "@/components/baam-native-workspace.module.css";

export default function BaamPage() {
  const t = useTranslations("baam");
  const common = useTranslations("common");
  const locale = useLocale();
  const search = useSearchParams();
  const [viewportMode, setViewportMode] = useState<"native" | "mobile">();
  const nativeIOS = viewportMode === "native";
  const [shortViewport, setShortViewport] = useState(false);
  const workspace = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isIOS()) {
      setViewportMode("native");
      return;
    }
    const mobile = window.matchMedia?.(phoneWorkspaceMediaQuery);
    if (!mobile) return;
    const measure = () => setViewportMode(mobile.matches ? "mobile" : undefined);
    measure();
    mobile.addEventListener("change", measure);
    return () => mobile.removeEventListener("change", measure);
  }, []);
  useEffect(() => {
    const element = workspace.current;
    if (!viewportMode || !element) return;
    const root = document.documentElement;
    const viewport = window.visualViewport;
    const nativePhone = nativeIOS ? window.matchMedia?.(mobileShellMediaQuery) : undefined;
    const nav = document.querySelector<HTMLElement>("[data-native-bottom-nav]");
    if (nativeIOS) root.classList.add(styles.nativeWorkspace);
    const measure = () => {
      const viewportTop = nativeIOS ? 0 : viewport?.offsetTop ?? 0;
      // The iOS phone shell fits one viewport. Its height must not grow if
      // WebKit briefly moves the document while focusing or returning to chat.
      const documentOffset = nativePhone?.matches ? window.scrollY : 0;
      const top = Math.max(0, element.getBoundingClientRect().top + documentOffset - viewportTop);
      const navBounds = nav?.getBoundingClientRect();
      const height = viewport?.height ?? window.innerHeight;
      const navHeight = nativeIOS
        ? navBounds?.height ?? 0
        : navBounds ? Math.max(0, Math.min(navBounds.bottom, viewportTop + height) -
          Math.max(navBounds.top, viewportTop)) : 0;
      if (!nativeIOS) element.style.setProperty("--baam-visible-height", `${height}px`);
      element.style.setProperty("--baam-workspace-top", `${top}px`);
      element.style.setProperty("--baam-workspace-bottom", navHeight > 0 ? `${navHeight + 8}px`
        : root.dataset.nativeKeyboard === "visible" ? "8px" : "max(8px, env(safe-area-inset-bottom))");
      // Read the fitted workspace, not orientation or the unresized screen.
      // Keep the composer and navigation usable when keyboard leaves little room.
      const workspaceHeight = element.clientHeight;
      setShortViewport(workspaceHeight > 0 && workspaceHeight < 320);
    };
    measure();
    window.addEventListener("resize", measure, { passive: true });
    window.addEventListener("scroll", measure, { passive: true });
    viewport?.addEventListener("resize", measure, { passive: true });
    viewport?.addEventListener("scroll", measure, { passive: true });
    const mutations = new MutationObserver(measure);
    mutations.observe(root, { attributes: true, attributeFilter: ["data-native-keyboard", "style", "class"] });
    const resize = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : undefined;
    if (element.parentElement) resize?.observe(element.parentElement);
    if (nav) resize?.observe(nav);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure);
      viewport?.removeEventListener("resize", measure);
      viewport?.removeEventListener("scroll", measure);
      mutations.disconnect();
      resize?.disconnect();
      if (nativeIOS) root.classList.remove(styles.nativeWorkspace);
      element.style.removeProperty("--baam-visible-height");
      element.style.removeProperty("--baam-workspace-top");
      element.style.removeProperty("--baam-workspace-bottom");
    };
  }, [nativeIOS, viewportMode]);
  const returnTo = search.get("returnTo");
  const back = nativeIOS || (viewportMode === "mobile" && returnTo) ? (
      <Button asChild variant="secondary" size="icon" className={shortViewport ? "h-11 w-11 shrink-0" : undefined} aria-label={common("back")} title={common("back")}>
        <Link href={baamWorkspaceReturnHref(returnTo)} replace prefetch={false}>
          <BackIcon aria-hidden />
        </Link>
      </Button>
  ) : undefined;
  const compact = Boolean(viewportMode) && shortViewport;
  const workspaceHeader = compact ? <header data-baam-short-header className="flex min-h-11 shrink-0 items-center justify-between gap-3 px-3">
    <h1 className="text-base font-semibold text-foreground">{t("title")}</h1>
    {back}
  </header> : undefined;
  return <div ref={workspace} className={cn("mx-auto min-w-0 max-w-4xl", viewportMode ? styles.workspace : "space-y-5")} data-testid="baam-page" data-baam-workspace data-baam-short-viewport={compact ? "true" : undefined} tabIndex={-1}>
    {!compact ? (
      <PageHeader
        title={t("title")}
        subtitle={baamCopy(locale, "subtitle")}
        compactMobile={!nativeIOS}
        actionClassName={back ? "w-auto justify-end" : undefined}
        action={back}
      />
    ) : null}
    <div className={cn("overflow-hidden rounded-lg border border-border/80 bg-card shadow-sm", viewportMode && styles.surface)}>
      <BaamAssistant nativeViewport={Boolean(viewportMode)} compactViewport={compact} workspaceHeader={workspaceHeader} />
    </div>
  </div>;
}
