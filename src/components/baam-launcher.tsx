"use client";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useLocale } from "next-intl";
import { ArrowUpRight } from "@phosphor-icons/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { hasPermission, type RoleAccess } from "@/lib/roleAccess";
import { baamCopy } from "@/lib/baam/copy";
import { BaamIcon } from "@/components/icons";

export const canShowBaamLauncher = (access: RoleAccess, pathname: string) =>
  hasPermission(access, "viewReports") && !pathname.startsWith("/printing/");

export function BaamLauncher({
  access,
  pathname,
  children,
}: {
  access: RoleAccess;
  pathname: string;
  children: ReactNode;
}) {
  const locale = useLocale();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [bottom, setBottom] = useState(24);
  const [viewport, setViewport] = useState<{ height: number; top: number }>();
  useEffect(() => setMounted(true), []);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!mounted) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const mobile = window.innerWidth < 768;
      let space = mobile ? 96 : 24;
      // Only explicitly marked fixed action bars affect the anchor. Table cells never do.
      document.querySelectorAll<HTMLElement>("[data-baam-obstacle]").forEach((el) => {
        if (getComputedStyle(el).position !== "fixed") return;
        const box = el.getBoundingClientRect();
        if (box.top < innerHeight && box.bottom > 0)
          space = Math.max(space, innerHeight - box.top + 12);
      });
      setBottom(Math.min(space, window.innerHeight - 116));
      const visual = window.visualViewport;
      setViewport(visual ? { height: visual.height, top: visual.offsetTop } : undefined);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    const mutation = new MutationObserver(schedule);
    document.querySelectorAll("[data-baam-obstacle]").forEach((el) => observer.observe(el));
    mutation.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("transitionend", schedule);
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    schedule();
    return () => {
      observer.disconnect();
      mutation.disconnect();
      cancelAnimationFrame(frame);
      document.removeEventListener("transitionend", schedule);
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
    };
  }, [mounted, pathname]);
  if (!mounted || !canShowBaamLauncher(access, pathname)) return null;
  const launcher = (
    <button
      type="button"
      data-baam-launcher
      aria-label={baamCopy(locale, "open")}
      style={{ bottom: `calc(${bottom}px + env(safe-area-inset-bottom, 0px))` }}
      className="button-focus-ring fixed right-[max(1rem,env(safe-area-inset-right,0px))] z-40 flex h-12 items-center gap-2 rounded-2xl border border-primary-foreground/15 bg-primary px-3 text-primary-foreground shadow-lg shadow-black/15 transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 md:right-6 [body:has([role=alertdialog][data-state=open])_&]:invisible [body:has([role=dialog][data-state=open])_&]:invisible"
      onClick={
        pathname === "/baam"
          ? () => {
              const input = document.querySelector<HTMLTextAreaElement>(
                "[data-baam-input]:not(:disabled)",
              );
              const target = input ?? document.querySelector<HTMLElement>("[data-baam-workspace]");
              target?.focus({ preventScroll: true });
              target?.scrollIntoView({ block: "nearest" });
            }
          : undefined
      }
    >
      <BaamIcon className="h-8 w-8" />
      <span className="text-xs font-bold tracking-[0.06em]">{baamCopy(locale, "name")}</span>
    </button>
  );
  if (pathname === "/baam") return createPortal(launcher, document.body);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {createPortal(<DialogTrigger asChild>{launcher}</DialogTrigger>, document.body)}
      <DialogContent
        data-baam-drawer
        style={
          viewport && typeof window !== "undefined" && window.innerWidth < 640
            ? { height: viewport.height, maxHeight: viewport.height, top: viewport.top }
            : undefined
        }
        className="bottom-0 left-0 right-0 top-auto h-[100dvh] max-h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 rounded-none pb-[env(safe-area-inset-bottom,0px)] sm:bottom-4 sm:left-auto sm:right-4 sm:h-[min(48rem,calc(100dvh-2rem))] sm:max-h-[calc(100dvh-2rem)] sm:max-w-[29rem] sm:rounded-2xl"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          requestAnimationFrame(() =>
            document
              .querySelector<HTMLTextAreaElement>("[data-baam-drawer] [data-baam-input]")
              ?.focus({ preventScroll: true }),
          );
        }}
      >
        <DialogHeader className="py-3">
          <DialogTitle className="flex items-center gap-2">
            <BaamIcon className="h-8 w-8 text-primary" />
            <span>{baamCopy(locale, "name")}</span>
          </DialogTitle>
          <DialogDescription className="sr-only">{baamCopy(locale, "subtitle")}</DialogDescription>
          <Link
            href="/baam"
            prefetch={false}
            onClick={() => setOpen(false)}
            className="button-focus-ring inline-flex min-h-7 items-center gap-1 rounded text-xs text-muted-foreground hover:text-primary"
          >
            {baamCopy(locale, "workspace")}
            <ArrowUpRight size={13} />
          </Link>
        </DialogHeader>
        <div className="min-h-0 flex-1">{open ? children : null}</div>
      </DialogContent>
    </Dialog>
  );
}
